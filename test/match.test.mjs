import test from 'node:test';
import assert from 'node:assert/strict';
import { COLS, ROWS, N, MAP_IDS, T, STEP_MS, SD_AT_MS, SD_FAST_STEP_MS, idx, roundCap } from '../game/rules.js';
import { MatchCore } from '../game/match.js';
import { simFromRecord } from '../game/sim.js';
import { tileOf } from '../game/move.js';

/** A whole match of bots only, straight through the pure rules: the same flow the host runs, minus the network. */
function playMatch({ seed, need = 2, map = 'classic', seats = 4 }) {
  const core = new MatchCore({ seed, need, map, seats });
  const problems = [];
  const rounds = [];
  for (;;) {
    const sim = core.beginRound();
    let guard = 0;
    while (!core.result) {
      core.advance(sim.t + STEP_MS * 6);
      if (++guard % 8 === 0) {
        for (const r of core.runner.bots) {
          const b = r.body;
          if (![b.x, b.y].every(Number.isFinite)) problems.push(`NaN for ${r.id} at ${Math.round(sim.t)}`);
          else if (b.x < 0.5 || b.x > COLS - 0.5 || b.y < 0.5 || b.y > ROWS - 0.5) problems.push(`${r.id} out of the arena at ${b.x},${b.y}`);
          else if (sim.alive(r.id) && (sim.pillars[tileOf(b)] || sim.crates[tileOf(b)])) problems.push(`${r.id} inside a pillar or crate at ${b.x},${b.y}`);
        }
        for (const s of sim.stats.values()) if (![s.b, s.r, s.s, s.k, s.p, s.h].every((v) => Number.isFinite(v) && v >= 0)) problems.push('a bad stat');
      }
      if (sim.t > 400000) {
        problems.push(`round ${core.n} ran for ${Math.round(sim.t)} ms`);
        break;
      }
    }
    const out = core.finishRound();
    rounds.push({ winner: out.winner, ms: Math.round(sim.t), alive: sim.aliveIds().length });
    sim.events.length = 0;
    if (out.matchOver || problems.length) return { core, rounds, problems };
  }
}

test('twenty seeds, every arena: matches end, everyone is ranked, nothing is NaN or out of bounds', () => {
  let draws = 0;
  let total = 0;
  let longest = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const map = MAP_IDS[seed % MAP_IDS.length];
    const { core, rounds, problems } = playMatch({ seed: seed * 977, need: 2, map });
    assert.deepEqual(problems, [], `seed ${seed} (${map})`);
    assert.ok(rounds.length >= 2 && rounds.length <= roundCap(2), `${rounds.length} rounds`);
    const st = core.standings();
    assert.equal(st.ranked.length, 4);
    assert.deepEqual([...st.ranked].sort(), [...core.ids].sort(), 'everyone ranked once');
    assert.equal(st.places[0], 1);
    const top = Math.max(...Object.values(core.wins));
    assert.ok(top >= 2 || rounds.length >= roundCap(2), 'someone reached the target (or the cap stopped it)');
    assert.equal(core.wins[st.ranked[0]], top, 'the first place has the most wins');
    const wins = Object.values(core.wins).reduce((a, b) => a + b, 0);
    const drew = rounds.filter((r) => !r.winner).length;
    assert.equal(wins + drew, rounds.length, 'every round gave a point or was drawn');
    for (const r of rounds) {
      assert.ok(r.ms < SD_AT_MS + T.hardCapMs + 1000, `a round took ${r.ms} ms`);
      if (r.winner) assert.equal(r.alive, 1, 'a winner is the last one standing');
      longest = Math.max(longest, r.ms);
    }
    draws += drew;
    total += rounds.length;
    for (const id of core.ids) {
      assert.ok(core.kos[id] >= 0 && core.chain[id] >= 0 && core.wins[id] >= 0);
    }
  }
  assert.ok(draws / total < 0.35, `${draws} draws in ${total} rounds`);
});

test('bots-only matches of 3 wins, with 8 seats and with 2, also finish', () => {
  for (const seats of [2, 4, 8]) {
    const { core, rounds, problems } = playMatch({ seed: 4242 + seats, need: 3, map: 'rings', seats });
    assert.deepEqual(problems, []);
    assert.ok(rounds.length >= 3);
    assert.equal(core.roster.length, seats);
    assert.equal(core.standings().ranked.length, seats);
  }
});

test('the round ends when one is left, after a moment for late claims; if the last two fall together it is a draw', () => {
  const core = new MatchCore({ seed: 5, need: 2, humans: ['h1', 'h2'], seats: 4 });
  const sim = core.beginRound();
  core.advance(1000);
  assert.equal(core.result, null);
  sim.out.set('bot1', 1100);
  sim.out.set('bot2', 1200);
  sim.out.set('h2', 1300);
  core.check();
  assert.equal(core.result, null, 'one left, but the round waits');
  assert.ok(core.settleAt > sim.t);
  core.advance(sim.t + T.settleMs + 100);
  assert.deepEqual(core.result, { winner: 'h1' });
  assert.ok(sim.sd[0] >= 1e12, 'the walls stop closing in once the round is decided');
  const out = core.finishRound();
  assert.equal(out.winner, 'h1');
  assert.equal(core.wins.h1, 1);
  assert.equal(out.matchOver, false);

  const draw = new MatchCore({ seed: 6, need: 2, humans: ['h1', 'h2'], seats: 2 });
  const s2 = draw.beginRound();
  draw.advance(500);
  s2.out.set('h1', 600);
  draw.check();
  assert.equal(draw.result, null);
  s2.out.set('h2', 700); // the other's claim arrived during the wait
  draw.advance(s2.t + T.settleMs + 100);
  assert.deepEqual(draw.result, { winner: null }, 'nobody left: a draw');
  const r = draw.finishRound();
  assert.equal(r.winner, null);
  assert.deepEqual(Object.values(draw.wins), [0, 0], 'nobody scores');
});

test('with no person left in, sudden death comes sooner and faster', () => {
  const core = new MatchCore({ seed: 7, need: 2, humans: ['h1'], seats: 4 });
  const sim = core.beginRound();
  core.advance(3000);
  assert.equal(core.sped, false);
  assert.equal(sim.sd[0], SD_AT_MS);
  sim.out.set('h1', 3100);
  core.advance(sim.t + 100);
  assert.equal(core.sped, true);
  assert.ok(sim.sd[0] < SD_AT_MS && sim.sd[1] === SD_FAST_STEP_MS);
  const before = sim.sd[0];
  core.advance(sim.t + 100);
  assert.equal(sim.sd[0], before, 'only once');
  // all bots: nothing is sped up
  const bots = new MatchCore({ seed: 7, need: 2, seats: 4 });
  const s2 = bots.beginRound();
  bots.advance(3000);
  assert.equal(bots.sped, false);
  assert.equal(s2.sd[0], SD_AT_MS);
});

test('a match that keeps drawing ends at the round cap; the first to the target ends it early', () => {
  const core = new MatchCore({ seed: 9, need: 2, seats: 2 });
  for (let n = 1; n < roundCap(2); n++) {
    core.beginRound();
    core.result = { winner: null };
    assert.equal(core.finishRound().matchOver, false, `round ${n}`);
  }
  core.beginRound();
  core.result = { winner: null };
  assert.equal(core.finishRound().matchOver, true, 'the cap');
  const quick = new MatchCore({ seed: 9, need: 2, seats: 2 });
  quick.beginRound();
  quick.result = { winner: 'bot1' };
  assert.equal(quick.finishRound().matchOver, false);
  quick.beginRound();
  quick.result = { winner: 'bot1' };
  assert.equal(quick.finishRound().matchOver, true);
  assert.equal(quick.wins.bot1, 2);
  assert.equal(quick.standings().ranked[0], 'bot1');
});

test('knock-outs and chains are added up across rounds; the awards go to the right bombers', () => {
  const core = new MatchCore({ seed: 11, need: 3, seats: 4 });
  for (let r = 0; r < 2; r++) {
    const sim = core.beginRound();
    sim.kos.set('bot2', 2 + r);
    sim.chainBest.set('bot3', 4 - r);
    core.result = { winner: 'bot2' };
    core.finishRound();
  }
  assert.equal(core.kos.bot2, 5);
  assert.equal(core.chain.bot3, 4);
  const st = core.standings();
  assert.equal(st.awards.kos, 'bot2');
  assert.equal(st.awards.chain, 'bot3');
  assert.equal(st.ranked[0], 'bot2');
});

test('a new host adopts a round in play: same world, bots where they were', () => {
  const core = new MatchCore({ seed: 31, need: 2, humans: ['h1'], seats: 4 });
  const sim = core.beginRound();
  core.advance(20000);
  const snap = core.runner.bots.map((b) => [b.body.x, b.body.y, b.body.dir, 0]);
  const g = { ...sim.record(), map: core.map, seed: core.rseed, rn: core.n, roster: core.roster };
  const next = new MatchCore({ roster: g.roster, seed: 31, need: 2, map: core.map });
  const adopted = next.adoptRound(g, sim.t, snap);
  assert.equal(adopted.bombs.length, sim.bombs.length);
  assert.deepEqual(adopted.crates, sim.crates);
  assert.equal(next.n, core.n);
  core.runner.bots.forEach((b, i) => {
    const mine = next.runner.byId(b.id);
    assert.ok(Math.abs(mine.body.x - snap[i][0]) < 1e-9);
  });
  for (const id of core.ids) assert.equal(adopted.alive(id), sim.alive(id), `${id} still ${sim.alive(id) ? 'in' : 'out'}`);
  next.advance(sim.t + 15000);
  assert.ok(Number.isFinite(adopted.t));
  assert.equal(simFromRecord(g, sim.t).t, sim.t);
  assert.ok(N > 0 && idx(1, 1) === COLS + 1);
});
