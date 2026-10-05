import test from 'node:test';
import assert from 'node:assert/strict';
import { N, COLS, ROWS, idx, tileX, tileY, FUSE_MS, BLAST_MS, STEP_MS, MAP_IDS, makeCrates } from '../game/rules.js';
import { Sim } from '../game/sim.js';
import { Brain, BotRunner, SKILLS, skillFor, botSpecs, computeDanger, makeDanger } from '../game/bots.js';
import { makeBody, tileOf } from '../game/move.js';

const solo = (map, seed, skill = SKILLS.perfect, crates) => {
  const sim = new Sim({ map, seed, roster: [{ id: 'bot1', bot: 1 }], crates: crates ?? makeCrates(map, seed, 1) });
  const runner = new BotRunner(sim, [{ id: 'bot1', seed: seed * 7 + 1, skill, x: 1.5, y: 1.5 }]);
  return { sim, runner, bot: runner.bots[0] };
};
const run = (sim, runner, ms, each) => {
  const to = sim.t + ms;
  while (sim.t + STEP_MS <= to && sim.alive('bot1')) {
    runner.step();
    sim.tick();
    each?.();
  }
};

test('the danger map knows when and where blasts will be, chains included, and what already burns', () => {
  const sim = new Sim({ map: 'classic', seed: 1, roster: [{ id: 'a', bot: 1 }, { id: 'b', bot: 1 }], crates: new Uint8Array(N) });
  const d = makeDanger();
  computeDanger(sim, null, d);
  assert.ok(d.start.every((v) => v === Infinity), 'an empty arena is safe');
  sim.stats.get('a').b = 2;
  const first = sim.placeBomb('a', 3, 1);
  const T0 = sim.t;
  sim.t += 1500;
  const second = sim.placeBomb('a', 5, 1); // inside the first one's blast, with a later fuse
  computeDanger(sim, null, d);
  assert.equal(d.start[idx(3, 1)], first.at);
  assert.equal(d.start[idx(4, 1)], first.at);
  assert.equal(d.start[idx(3, 2)], first.at);
  assert.equal(d.start[idx(5, 1)], first.at, 'the bomb it reaches goes off with it');
  assert.equal(d.start[idx(7, 1)], first.at, 'and its blast too, so the far end is dangerous early');
  assert.ok(second.at > first.at);
  assert.equal(d.start[idx(9, 1)], Infinity);
  assert.equal(d.end[idx(3, 1)], first.at + BLAST_MS);
  assert.equal(d.start[idx(6, 2)], Infinity, 'a pillar is never in a blast');
  assert.ok(T0 === 0);
  // fire that is already burning
  sim.fire.push({ i: idx(9, 1), from: sim.t - 100, cid: 1 });
  computeDanger(sim, null, d);
  assert.equal(d.start[idx(9, 1)], sim.t - 100);
  assert.equal(d.end[idx(9, 1)], sim.t - 100 + BLAST_MS);
  // an extra (imagined) bomb
  computeDanger(sim, [{ x: 11, y: 11, r: 2, p: 0, at: sim.t + FUSE_MS, dx: 0, dy: 0, id: -1, o: 'a' }], d);
  assert.equal(d.start[idx(11, 11)], sim.t + FUSE_MS);
  assert.equal(d.start[idx(13, 11)], sim.t + FUSE_MS);
});

test('sudden death shows up as danger before it drops', () => {
  const sim = new Sim({ map: 'classic', seed: 1, roster: [{ id: 'a', bot: 1 }], crates: new Uint8Array(N) });
  const d = makeDanger();
  sim.t = sim.sd[0] - 700;
  computeDanger(sim, null, d);
  assert.ok(d.start[idx(1, 1)] < Infinity && d.end[idx(1, 1)] === Infinity);
  assert.equal(d.start[idx(7, 6)], Infinity);
  const prac = new Sim({ map: 'classic', seed: 1, roster: [{ id: 'a', bot: 1 }], crates: new Uint8Array(N), practice: true });
  prac.t = 1e6;
  computeDanger(prac, null, d);
  assert.ok(d.start.every((v) => v === Infinity), 'no sudden death in practice');
});

test('a lone perfect bot never dies, drops bombs, breaks crates and stays inside the arena (every arena, 24 seeds)', () => {
  let bombs = 0;
  let broken = 0;
  for (const map of MAP_IDS) {
    for (let seed = 1; seed <= 8; seed++) {
      const { sim, runner, bot } = solo(map, seed);
      const before = sim.crates.reduce((a, b) => a + b, 0);
      run(sim, runner, 70000, () => {
        const b = bot.body;
        assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), 'a number');
        assert.ok(b.x >= 0.5 && b.x <= COLS - 0.5 && b.y >= 0.5 && b.y <= ROWS - 0.5, `${map}/${seed}: out of the arena at ${b.x},${b.y}`);
        assert.ok(!sim.pillars[tileOf(b)] && !sim.crates[tileOf(b)], `${map}/${seed}: standing inside something at ${b.x},${b.y}`);
      });
      assert.ok(sim.alive('bot1'), `${map}/${seed}: the bot died at ${Math.round(sim.t)} (out: ${[...sim.out]})`);
      bombs += sim.nextBomb - 1;
      broken += before - sim.crates.reduce((a, b) => a + b, 0);
    }
  }
  assert.ok(bombs > 24 * 8, `${bombs} bombs: it does play`);
  assert.ok(broken > 24 * 20, `${broken} crates broke`);
});

test('a bot that can see no way out does not drop a bomb', () => {
  const crates = new Uint8Array(N);
  crates[idx(2, 1)] = 1;
  crates[idx(1, 2)] = 1;
  const { sim, runner, bot } = solo('classic', 3, SKILLS.perfect, crates);
  assert.equal(bot.brain.escapable(sim, tileOf(bot.body), sim.stats.get('bot1'), 4.5), false, 'walled in by crates: a bomb here is the end of it');
  run(sim, runner, 8000);
  assert.equal(sim.nextBomb, 1, 'no bomb');
  assert.ok(sim.alive('bot1'));
  // with room to run it is happy to
  const open = solo('classic', 3, SKILLS.perfect, new Uint8Array(N));
  assert.equal(open.bot.brain.escapable(open.sim, tileOf(open.bot.body), open.sim.stats.get('bot1'), 4.5), true);
});

test('it runs from a bomb along the shortest safe path, and does not run into blasts', () => {
  const sim = new Sim({ map: 'classic', seed: 1, roster: [{ id: 'bot1', bot: 1 }, { id: 'x', bot: 0 }], crates: new Uint8Array(N) });
  const runner = new BotRunner(sim, [{ id: 'bot1', seed: 5, skill: SKILLS.perfect, x: 7.5, y: 1.5 }]);
  sim.stats.get('x').b = 3;
  // the person puts bombs on both sides of the bot's row with different fuses
  sim.placeBomb('x', 6, 1);
  sim.t += 300;
  sim.placeBomb('x', 8, 1);
  run(sim, runner, FUSE_MS + 1200);
  assert.ok(sim.alive('bot1'), `boxed between two bombs in a corridor, it found the way down column 7 (out at ${sim.out.get('bot1')})`);
  assert.ok(sim.fire.length > 0 || sim.t > FUSE_MS);
});

test('a rookie takes longer to react than a sharp bot', () => {
  assert.ok(SKILLS.rookie.react > SKILLS.avg.react && SKILLS.avg.react > SKILLS.sharp.react && SKILLS.sharp.react > SKILLS.perfect.react);
  assert.ok(SKILLS.rookie.slip > SKILLS.sharp.slip && SKILLS.perfect.slip === 0);
  const seen = new Set([0, 1, 2, 3, 4, 5].map((i) => skillFor(i)));
  assert.ok(seen.size >= 3, 'a mix of skills at one table');
  assert.equal(skillFor(-1), SKILLS.sharp);
});

test('a bot places bombs only where it stands, on a free tile, within its limit', () => {
  const { sim, runner, bot } = solo('cross', 4, SKILLS.avg);
  sim.stats.get('bot1').b = 2;
  let placed = 0;
  const seen = new Set();
  run(sim, runner, 40000, () => {
    if (sim.events.length) {
      for (const e of sim.events.splice(0)) {
        if (e.k !== 'place') continue;
        placed++;
        assert.ok(!seen.has(`${e.bomb.x},${e.bomb.y}@${Math.round(e.bomb.at)}`));
        seen.add(`${e.bomb.x},${e.bomb.y}@${Math.round(e.bomb.at)}`);
      }
    }
    assert.ok(sim.ownedBombs('bot1') <= sim.stats.get('bot1').b);
  });
  assert.ok(placed > 3);
  assert.ok(tileX(tileOf(bot.body)) >= 1 && tileY(tileOf(bot.body)) >= 1);
});

test('bots pick up power-ups on the way, and a bot with a record in one seat does not disturb another', () => {
  const sim = new Sim({ map: 'classic', seed: 2, roster: [{ id: 'bot1', bot: 1 }, { id: 'bot2', bot: 1 }], crates: new Uint8Array(N) });
  const specs = botSpecs([{ id: 'bot1', bot: 1 }, { id: 'bot2', bot: 1 }], 2);
  assert.equal(specs.length, 2);
  assert.deepEqual([specs[0].x, specs[0].y, specs[1].x, specs[1].y], [1.5, 1.5, 13.5, 11.5], 'their corners');
  const runner = new BotRunner(sim, specs);
  sim.items.push({ i: idx(5, 1), k: 'b', born: 0 });
  run(sim, runner, 6000);
  assert.equal(sim.items.length, 0, 'taken');
  assert.ok(sim.stats.get('bot1').b === 2 || sim.stats.get('bot2').b === 2);
  runner.place('bot1', 4.5, 4.5, 1);
  assert.equal(runner.byId('bot1').body.x, 4.5);
  runner.place('nobody', 1, 1, 0);
  runner.place('bot2', NaN, 3, 9);
  assert.ok(Number.isFinite(runner.byId('bot2').body.x));
  assert.equal(runner.byId('zzz'), null);
});

test('brains are deterministic for a seed', () => {
  const play = () => {
    const { sim, runner } = solo('rings', 11, SKILLS.avg);
    run(sim, runner, 20000);
    return JSON.stringify([sim.nextBomb, [...sim.out], runner.bots[0].body.x.toFixed(3), runner.bots[0].body.y.toFixed(3), sim.crates.reduce((a, b) => a + b, 0)]);
  };
  assert.equal(play(), play());
  const b = new Brain('x', 1);
  const body = makeBody(1.5, 1.5);
  const sim = new Sim({ map: 'classic', seed: 1, roster: [{ id: 'y', bot: 1 }] });
  assert.deepEqual({ ...b.think(sim, body) }, { dx: 0, dy: 0, bomb: false }, 'a brain for someone not in the round does nothing');
});
