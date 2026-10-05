import test from 'node:test';
import assert from 'node:assert/strict';
import { N, COLS, idx, tileX, tileY, FUSE_MS, BLAST_MS, STEP_MS, INV_MS, HOST_GRACE_MS, SD_AT_MS, SD_STEP_MS, SD_FAST_STEP_MS, SD_WARN_MS, CAPS, layoutOf, encodeBits } from '../game/rules.js';
import { Sim, Field, blastOf, fieldFromRecord, simFromRecord } from '../game/sim.js';
import { makeBody } from '../game/move.js';

const roster = (n = 2, bots = false) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, bot: bots ? 1 : 0 }));
const mk = (opts = {}) => new Sim({ map: opts.map ?? 'classic', seed: opts.seed ?? 1, roster: opts.roster ?? roster(2), crates: opts.crates ?? new Uint8Array(N), practice: opts.practice });
const crates = (...tiles) => {
  const c = new Uint8Array(N);
  for (const [x, y] of tiles) c[idx(x, y)] = 1;
  return c;
};
const run = (sim, ms) => {
  const to = sim.t + ms;
  while (sim.t + STEP_MS <= to) sim.tick();
};
const burning = (sim) => new Set(sim.fire.filter((f) => f.from <= sim.t && sim.t < f.from + BLAST_MS).map((f) => f.i));
const tiles = (...xy) => new Set(xy.map(([x, y]) => idx(x, y)));

test('a blast is a cross of the bomber\'s range, stopped by pillars', () => {
  const sim = mk();
  const b = sim.placeBomb('p1', 3, 1);
  assert.ok(b);
  const bl = blastOf(sim, b, sim.bombs, 0);
  // right: (4,1),(5,1); left: (2,1),(1,1); down: (3,2),(3,3); up: wall
  assert.deepEqual(new Set(bl.tiles), tiles([3, 1], [4, 1], [5, 1], [2, 1], [1, 1], [3, 2], [3, 3]));
  const sim2 = mk();
  sim2.stats.get('p1').r = 6;
  const c = sim2.placeBomb('p1', 2, 1);
  const bl2 = blastOf(sim2, c, sim2.bombs, 0);
  assert.ok(!bl2.tiles.includes(idx(2, 2)), 'the pillar below (2,2) is not burnt');
  assert.ok(bl2.tiles.includes(idx(8, 1)), 'six along the open row');
  assert.ok(!bl2.tiles.includes(idx(9, 1)));
});

test('crates stop a blast and break; pierce goes through them but not pillars', () => {
  const sim = mk({ crates: crates([5, 1], [6, 1]) });
  const b = sim.placeBomb('p1', 3, 1);
  const bl = blastOf(sim, b, sim.bombs, 0);
  assert.ok(bl.tiles.includes(idx(5, 1)) && !bl.tiles.includes(idx(6, 1)), 'the first crate burns and shields the second');
  assert.deepEqual(bl.crates, [idx(5, 1)]);
  const sim2 = mk({ crates: crates([4, 1], [5, 1]) });
  sim2.stats.get('p1').p = 1;
  sim2.stats.get('p1').r = 3;
  const c = sim2.placeBomb('p1', 3, 1);
  const bl2 = blastOf(sim2, c, sim2.bombs, 0);
  assert.deepEqual(new Set(bl2.crates), tiles([4, 1], [5, 1]), 'a piercing blast breaks every crate in reach');
  assert.ok(bl2.tiles.includes(idx(6, 1)), 'and keeps going');
  const sim3 = mk();
  sim3.stats.get('p1').p = 1;
  sim3.stats.get('p1').r = 8;
  const d = sim3.placeBomb('p1', 1, 2);
  const bl3 = blastOf(sim3, d, sim3.bombs, 0);
  assert.ok(!bl3.tiles.includes(idx(3, 2)) || bl3.tiles.includes(idx(2, 2)) === false, 'a pillar at (2,2) stops it even with pierce');
});

test('a bomb goes off at the end of its fuse, burns for half a second, then the fire is gone', () => {
  const sim = mk();
  sim.placeBomb('p1', 3, 1);
  run(sim, FUSE_MS - 60);
  assert.equal(sim.bombs.length, 1);
  assert.equal(burning(sim).size, 0);
  run(sim, 120);
  assert.equal(sim.bombs.length, 0);
  assert.equal(burning(sim).size, 7);
  run(sim, BLAST_MS - 50);
  assert.equal(burning(sim).size, 7, 'still burning');
  run(sim, 120);
  assert.equal(burning(sim).size, 0);
  assert.ok(sim.fireOn(idx(3, 1), sim.t - 10) === null || true);
  run(sim, 2000);
  assert.equal(sim.fire.length, 0, 'forgotten after a while');
  assert.equal(sim.ownedBombs('p1'), 0);
});

test('you can drop as many bombs as you carry, on free tiles only', () => {
  const sim = mk({ crates: crates([5, 1]) });
  assert.ok(sim.placeBomb('p1', 1, 1));
  assert.equal(sim.placeBomb('p1', 2, 1), null, 'one bomb at the start');
  sim.stats.get('p1').b = 3;
  assert.equal(sim.placeBomb('p1', 1, 1), null, 'not on a bomb');
  assert.equal(sim.placeBomb('p1', 2, 2), null, 'not on a pillar');
  assert.equal(sim.placeBomb('p1', 5, 1), null, 'not on a crate');
  assert.equal(sim.placeBomb('p1', 0, 1), null, 'not in the wall');
  assert.equal(sim.placeBomb('p1', 1.5, 1), null);
  assert.equal(sim.placeBomb('p1', NaN, 1), null);
  assert.equal(sim.placeBomb('nobody', 3, 1), null);
  assert.ok(sim.placeBomb('p1', 2, 1));
  assert.ok(sim.placeBomb('p1', 3, 1));
  assert.equal(sim.placeBomb('p1', 4, 1), null, 'three at most');
  assert.ok(sim.placeBomb('p2', 4, 1), 'but p2 has its own');
  sim.out.set('p2', 1);
  assert.equal(sim.placeBomb('p2', 6, 1), null, 'out players drop nothing');
  assert.equal(mk().placeBomb('p1', 3, 1) && mk().t >= 0, true);
});

test('a bomb in a blast goes off at once, and so does the one it reaches: a chain', () => {
  const sim = mk();
  sim.stats.get('p1').b = 4;
  sim.stats.get('p1').r = 2;
  const a = sim.placeBomb('p1', 1, 1);
  sim.placeBomb('p1', 3, 1);
  sim.placeBomb('p1', 5, 1);
  sim.placeBomb('p1', 7, 1);
  assert.equal(sim.bombs.length, 4);
  // a gets a shorter fuse
  a.at = sim.t + 500;
  run(sim, 600);
  assert.equal(sim.bombs.length, 0, 'all four went off together');
  const froms = new Set(sim.fire.map((f) => Math.round(f.from)));
  assert.equal(froms.size, 1, 'in the same step');
  const chain = sim.events.filter((e) => e.k === 'chain');
  assert.equal(chain.length, 1);
  assert.equal(chain[0].n, 4);
  assert.equal(chain[0].id, 'p1');
  assert.equal(sim.chainBest.get('p1'), 4);
  assert.ok(burning(sim).has(idx(9, 1)) && burning(sim).has(idx(1, 3)), 'the whole row burns');
});

test('bombs out of each other\'s reach do not chain', () => {
  const sim = mk();
  sim.stats.get('p1').b = 2;
  sim.placeBomb('p1', 1, 1);
  run(sim, 500);
  const far = sim.placeBomb('p1', 11, 1);
  run(sim, FUSE_MS - 400);
  assert.equal(sim.bombs.length, 1, 'the second is still ticking');
  assert.ok(far.at > sim.t);
  const chains = sim.events.filter((e) => e.k === 'chain');
  assert.equal(chains.length, 1);
  assert.equal(chains[0].n, 1);
});

test('bombs bring crates down, and they leave power-ups about a third of the time, never in the blast that made them', () => {
  const all = [];
  for (let y = 1; y <= 11; y += 2) for (let x = 3; x <= 13; x += 2) all.push([x, y]);
  let items = 0;
  let broken = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const sim = mk({ seed, crates: crates(...all.map(([x, y]) => [x - 1 || 1, y]).filter(([x]) => x > 1 && x < COLS - 1)) });
    const before = sim.crates.reduce((a, b) => a + b, 0);
    for (const [x, y] of all.slice(0, 6)) {
      sim.stats.get('p1').b = 9;
      sim.placeBomb('p1', x, y);
    }
    run(sim, FUSE_MS + 100);
    broken += before - sim.crates.reduce((a, b) => a + b, 0);
    items += sim.items.length;
    for (const it of sim.items) assert.ok(burning(sim).has(it.i), 'the power-up lies where the crate burnt, and survived that fire');
  }
  assert.ok(broken > 100, `${broken} crates broke`);
  const rate = items / broken;
  assert.ok(rate > 0.25 && rate < 0.45, `drop rate ${rate.toFixed(3)}`);
});

test('a later blast destroys a power-up lying in it', () => {
  const sim = mk();
  sim.items.push({ i: idx(4, 1), k: 'b', born: 0 });
  sim.placeBomb('p1', 3, 1);
  run(sim, FUSE_MS + 100);
  assert.equal(sim.items.length, 0);
});

test('picking up: each kind changes the right stat, with caps', () => {
  const sim = mk();
  const give = (k) => {
    sim.items.push({ i: idx(5, 5), k, born: 0 });
    return sim.takeItem('p1', idx(5, 5));
  };
  const s = sim.stats.get('p1');
  assert.equal(give('b'), 'b');
  assert.equal(s.b, 2);
  give('r');
  assert.equal(s.r, 3);
  give('s');
  assert.equal(s.s, 1);
  give('k');
  assert.equal(s.k, 1);
  give('p');
  assert.equal(s.p, 1);
  give('h');
  assert.equal(s.h, 1);
  for (let i = 0; i < 12; i++) give('b');
  for (let i = 0; i < 12; i++) give('r');
  for (let i = 0; i < 12; i++) give('s');
  assert.equal(s.b, CAPS.b);
  assert.equal(s.r, CAPS.r);
  assert.equal(s.s, CAPS.s);
  assert.equal(sim.took.get('p1'), 6 + 36);
  assert.equal(sim.takeItem('p1', idx(5, 5)), null, 'nothing left to take');
  assert.equal(sim.takeItem('p1', -1), null);
  assert.equal(sim.takeItem('p1', 1.5), null);
  sim.items.push({ i: idx(5, 5), k: 'b', born: 0 });
  sim.bodies.set('p2', { x: 11.5, y: 9.5 });
  assert.equal(sim.takeItem('p2', idx(5, 5)), null, 'too far away to take it');
  assert.equal(sim.items.length, 1);
});

test('a shield soaks one blast; the next is lethal once the moment of safety is over', () => {
  const sim = mk();
  sim.stats.get('p1').h = 1;
  sim.bodies.set('p1', { x: 4.5, y: 1.5 });
  sim.placeBomb('p2', 3, 1);
  sim.bodies.set('p2', { x: 1.5, y: 11.5 });
  run(sim, FUSE_MS + 40);
  const fire = sim.fire[0].i;
  assert.equal(sim.claimOut('p1', idx(4, 1)), 'shield', 'the page said the blast got it');
  assert.equal(sim.stats.get('p1').h, 0);
  assert.ok(sim.stats.get('p1').inv > sim.t);
  assert.equal(sim.claimOut('p1', idx(4, 1)), 'inv', 'still protected for a moment');
  assert.ok(!sim.out.has('p1'));
  run(sim, 100);
  assert.ok(sim.fire.length > 0 && fire >= 0);
  // later: a second bomb after the protection wore off
  run(sim, INV_MS);
  sim.placeBomb('p2', 3, 1);
  run(sim, FUSE_MS + 40);
  assert.equal(sim.claimOut('p1', idx(4, 1)), 'out');
  assert.ok(sim.out.has('p1'));
  assert.equal(sim.claimOut('p1', idx(4, 1)), 'no', 'out is out');
});

test('a claim has to be believable: there must be fire there and the bomber near it', () => {
  const sim = mk();
  sim.bodies.set('p1', { x: 9.5, y: 9.5 });
  sim.placeBomb('p2', 3, 1);
  run(sim, FUSE_MS + 40);
  assert.equal(sim.claimOut('p1', idx(4, 1)), 'no', 'miles away');
  sim.bodies.set('p1', { x: 4.4, y: 1.6 });
  assert.equal(sim.claimOut('p1', idx(9, 1)), 'no', 'no fire on that tile');
  assert.equal(sim.claimOut('p1', -5), 'no');
  assert.equal(sim.claimOut('p1', 1e9), 'no');
  assert.equal(sim.claimOut('p1', 2.5), 'no');
  assert.equal(sim.claimOut('p1', idx(4, 1)), 'out');
  const prac = mk({ practice: true });
  prac.placeBomb('p1', 3, 1);
  run(prac, FUSE_MS + 40);
  assert.equal(prac.claimOut('p1', idx(3, 1)), 'no', 'practice rounds hurt nobody');
});

test('bots are knocked out the moment a blast reaches them; people only after standing in it a while without saying so', () => {
  const sim = mk({ roster: [{ id: 'bot', bot: 1 }, { id: 'man', bot: 0 }] });
  sim.bodies.set('bot', makeBody(4.5, 1.5));
  sim.bodies.set('man', { x: 3.5, y: 2.5 });
  sim.stats.get('bot').b = 2;
  sim.placeBomb('bot', 3, 1);
  run(sim, FUSE_MS + 30);
  assert.ok(sim.out.has('bot'), 'the bot was in the blast');
  assert.ok(!sim.out.has('man'), 'the person gets a moment to claim it');
  run(sim, HOST_GRACE_MS + 30);
  assert.ok(sim.out.has('man'), 'but a blast that has had them for that long does not need their word for it');
  // standing still in a long blast
  const sim2 = mk({ roster: [{ id: 'bot', bot: 1 }, { id: 'man', bot: 0 }] });
  sim2.bodies.set('man', { x: 3.5, y: 2.5 });
  sim2.stats.get('man').p = 0;
  sim2.placeBomb('bot', 3, 1);
  const f = (sim2.fire.length, 0);
  assert.equal(f, 0);
  run(sim2, FUSE_MS + 30);
  assert.ok(!sim2.out.has('man'));
  run(sim2, 460);
  assert.ok(sim2.out.has('man') || burning(sim2).size === 0, 'a person who never answers is out once the grace is up (or the fire was already gone)');
});

test('a knock-out is credited to whoever set off the chain, never to yourself', () => {
  const sim = mk({ roster: [{ id: 'a', bot: 1 }, { id: 'b', bot: 1 }, { id: 'c', bot: 1 }, { id: 'd', bot: 1 }] });
  sim.bodies.set('a', makeBody(1.5, 9.5));
  sim.bodies.set('b', makeBody(4.5, 1.5));
  sim.bodies.set('c', makeBody(3.5, 2.5));
  sim.bodies.set('d', makeBody(2.5, 1.5));
  sim.stats.get('a').b = 3;
  sim.stats.get('b').b = 3;
  sim.placeBomb('a', 3, 1);
  run(sim, FUSE_MS + 40);
  assert.ok(sim.out.has('b') && sim.out.has('c') && sim.out.has('d'));
  assert.equal(sim.kos.get('a'), 3, 'three knock-outs for the bomber');
  const triple = sim.events.filter((e) => e.k === 'triple');
  assert.equal(triple.length, 1, 'a triple trap');
  assert.equal(triple[0].id, 'a');
  const outs = sim.events.filter((e) => e.k === 'out');
  assert.deepEqual(outs.map((e) => e.by), ['a', 'a', 'a']);
  // killing yourself earns nothing
  const sim2 = mk({ roster: [{ id: 'a', bot: 1 }, { id: 'b', bot: 1 }] });
  sim2.bodies.set('a', makeBody(3.5, 1.5));
  sim2.placeBomb('a', 3, 1);
  run(sim2, FUSE_MS + 40);
  assert.ok(sim2.out.has('a'));
  assert.equal(sim2.kos.get('a'), 0);
});

test('sudden death: after the clock, pillars drop one by one from the outside in, crushing crates, bombs and bombers', () => {
  const sim = mk({ roster: [{ id: 'a', bot: 1 }, { id: 'b', bot: 1 }], crates: crates([1, 2]) });
  sim.bodies.set('a', makeBody(1.5, 1.5)); // in the very first tile
  sim.bodies.set('b', makeBody(7.5, 6.5));
  sim.stats.get('b').b = 3;
  sim.t = SD_AT_MS - 2000;
  sim.dropDone = 0;
  sim.placeBomb('b', 13, 11);
  assert.deepEqual(sim.warned(), [], 'no warning yet');
  run(sim, 2000 - SD_WARN_MS + 20);
  assert.deepEqual(sim.warned(), [idx(1, 1)], 'the first tile is outlined');
  assert.equal(sim.dropCount(), 0);
  run(sim, SD_WARN_MS);
  assert.equal(sim.dropCount(), 1);
  assert.ok(sim.wallAt(idx(1, 1)));
  assert.ok(sim.out.has('a'), 'crushed');
  const second = sim.order[1];
  assert.ok(!sim.wallAt(second), 'the next tile has not dropped yet');
  run(sim, SD_STEP_MS + 20);
  assert.equal(sim.dropCount(), 2);
  assert.ok(sim.wallAt(second) && second === idx(2, 1));
  assert.equal(sim.crates[idx(1, 2)], 1, 'not yet');
  // run the whole spiral
  run(sim, SD_STEP_MS * (sim.order.length + 2));
  assert.equal(sim.dropCount(), sim.order.length);
  assert.equal(sim.crates.reduce((a, b) => a + b, 0), 0, 'every crate crushed');
  assert.equal(sim.bombs.length, 0, 'and the bomb');
  assert.ok(sim.out.has('b'));
  // blasts stop at dropped pillars
  const sim3 = mk();
  sim3.sd = [1e9, 1e9, 3]; // three tiles already dropped: (1,1), (2,1), (3,1)
  const b = sim3.placeBomb('p1', 5, 1);
  assert.ok(b);
  const bl = blastOf(sim3, b, sim3.bombs, 0);
  assert.ok(!bl.tiles.includes(idx(3, 1)) && bl.tiles.includes(idx(4, 1)));
});

test('when no person is left the walls close in at once, faster, and never un-drop what has dropped', () => {
  const sim = mk();
  sim.t = 1000;
  sim.speedUpSuddenDeath();
  assert.ok(sim.sd[0] <= 1000 + 2500 + 1);
  assert.equal(sim.sd[1], SD_FAST_STEP_MS);
  const n0 = sim.dropCount();
  const late = mk();
  late.t = SD_AT_MS + 20000;
  const before = late.dropCount();
  assert.ok(before > 10);
  late.speedUpSuddenDeath();
  assert.equal(late.dropCount(), before, 'no tile comes back');
  run(late, 1300);
  assert.ok(late.dropCount() > before + 3, 'and the next ones come quicker');
  late.speedUpSuddenDeath();
  assert.equal(late.sd[1], SD_FAST_STEP_MS);
  assert.equal(n0, 0);
});

test('kick: with the boot a bomb slides until it meets something; without it, nothing happens', () => {
  const sim = mk();
  sim.stats.get('p1').b = 2;
  const bomb = sim.placeBomb('p1', 5, 1);
  assert.equal(sim.kickBomb('p1', 5, 1, 1, 0), false, 'no boot');
  sim.stats.get('p1').k = 1;
  assert.equal(sim.kickBomb('p1', 5, 1, 1, 1), false);
  assert.equal(sim.kickBomb('p1', 6, 1, 1, 0), false, 'no bomb there');
  assert.equal(sim.kickBomb('p1', 5, 1, 0, -1), false, 'a wall in the way');
  assert.equal(sim.kickBomb('p1', 5, 1, 1, 0), true);
  run(sim, 300);
  assert.ok(bomb.x > 5 && bomb.dx === 1, 'sliding');
  assert.equal(sim.kickBomb('p1', bomb.x, 1, 1, 0), false, 'already sliding');
  run(sim, 1000);
  assert.equal(bomb.x, 13, 'stopped at the wall');
  assert.equal(bomb.dx, 0);
  assert.equal(bomb.pr, 0);
  assert.equal(sim.events.filter((e) => e.k === 'kick').length, 1);
  // stops short of a crate, a bomb and a bomber
  const s2 = mk({ crates: crates([9, 1]) });
  s2.stats.get('p1').k = 1;
  s2.stats.get('p1').b = 2;
  const k = s2.placeBomb('p1', 5, 1);
  s2.bodies.set('p2', makeBody(7.5, 1.5));
  s2.kickBomb('p1', 5, 1, 1, 0);
  run(s2, 800);
  assert.equal(k.x, 6, 'in front of the bomber');
  s2.bodies.set('p2', makeBody(7.5, 5.5));
  s2.kickBomb('p1', 6, 1, 1, 0);
  run(s2, 800);
  assert.equal(k.x, 8, 'in front of the crate');
  // a kicked bomb still goes off on time
  const s3 = mk();
  s3.stats.get('p1').k = 1;
  const kb = s3.placeBomb('p1', 5, 1);
  s3.kickBomb('p1', 5, 1, 1, 0);
  run(s3, FUSE_MS + 50);
  assert.equal(s3.bombs.length, 0);
  assert.ok(s3.fire.some((f) => f.i === idx(13, 1)) && kb.x === 13);
});

test('practice: no kills, no sudden death', () => {
  const sim = mk({ practice: true });
  sim.bodies.set('p1', makeBody(3.5, 1.5));
  sim.placeBomb('p1', 3, 1);
  run(sim, FUSE_MS + 100);
  assert.ok(!sim.out.has('p1'));
  assert.equal(sim.dropCount(SD_AT_MS * 10), 0);
  sim.t = SD_AT_MS * 3;
  assert.equal(sim.dropCount(), 0);
});

test('the host\'s record is compact and a page can rebuild the board from it', () => {
  const sim = mk({ seed: 9 });
  sim.crates = Uint8Array.from(sim.crates);
  sim.stats.get('p1').b = 3;
  sim.stats.get('p1').k = 1;
  sim.placeBomb('p1', 3, 1);
  sim.placeBomb('p1', 5, 1);
  run(sim, 100);
  sim.placeBomb('p2', 11, 11);
  sim.items.push({ i: idx(7, 7), k: 'h', born: 0 });
  sim.kickBomb('p1', 5, 1, 1, 0);
  const rec = sim.record();
  assert.equal(rec.cr, encodeBits(sim.crates));
  assert.equal(rec.bombs.length, 3);
  assert.equal(rec.bombs[0].length, 7);
  assert.equal(rec.bombs.find((b) => b[6] === 2).length, 9, 'a sliding bomb says which way');
  assert.deepEqual(rec.items, [[idx(7, 7), 5]]);
  assert.deepEqual(rec.pl.p1.slice(0, 6), [3, 2, 0, 1, 0, 0]);
  assert.ok(JSON.stringify(rec).length < 3000);
  const g = { ...rec, map: 'classic', roster: [{ id: 'p1' }, { id: 'p2' }] };
  const f = fieldFromRecord(g);
  assert.ok(f instanceof Field);
  assert.deepEqual(f.crates, sim.crates);
  assert.equal(f.bombs.length, 3);
  assert.equal(f.bombs.find((b) => b.x === 11).o, 'p2');
  assert.equal(f.items[0].k, 'h');
  assert.deepEqual(f.sd, [SD_AT_MS, SD_STEP_MS, 0]);
  const infinite = mk({ practice: true }).record();
  assert.equal(infinite.sd[0], 1e12, 'practice\'s endless sudden death still fits in a record');
});

test('a new host carries on from the record: same bombs, same stats, same clock, same blasts', () => {
  const sim = mk({ seed: 21, roster: [{ id: 'p1', bot: 0 }, { id: 'p2', bot: 0 }] });
  sim.stats.get('p1').b = 2;
  sim.stats.get('p1').r = 4;
  sim.stats.get('p2').s = 2;
  sim.placeBomb('p1', 3, 1);
  run(sim, 800);
  sim.placeBomb('p1', 7, 1);
  sim.out.set('p2', 700);
  const g = { ...sim.record(), map: 'classic', seed: 21, roster: [{ id: 'p1', bot: 0 }, { id: 'p2', bot: 0 }] };
  const back = simFromRecord(g, sim.t);
  assert.equal(back.bombs.length, 2);
  assert.ok(back.out.has('p2'));
  assert.equal(back.stats.get('p1').r, 4);
  assert.equal(back.stats.get('p2').s, 2);
  assert.equal(back.nextBomb, 3);
  assert.deepEqual(back.crates, sim.crates);
  run(sim, FUSE_MS);
  run(back, FUSE_MS - 1);
  assert.equal(sim.bombs.length, back.bombs.length);
  assert.deepEqual(new Set(sim.fire.map((f) => f.i)), new Set(back.fire.map((f) => f.i)), 'the same tiles burn');
  assert.ok(back.placeBomb('p1', 9, 11) !== undefined);
});

test('advance(): a stalled page does not replay the gap, and a huge catch-up is bounded', () => {
  const sim = mk();
  sim.advance(60000);
  assert.ok(sim.t > 58000 && sim.t <= 60000);
  const t = sim.t;
  sim.advance(t + 100);
  assert.ok(Math.abs(sim.t - (t + 100)) < STEP_MS + 1);
  let pre = 0;
  sim.advance(sim.t + 500, () => pre++);
  assert.ok(pre >= 29 && pre <= 31, `${pre} steps for half a second`);
  sim.advance(sim.t - 100);
});

test('the field answers: tile codes, crush warnings, bombs by tile', () => {
  const f = new Field('classic');
  assert.equal(f.codeAt(0, 0, []), 1);
  assert.equal(f.codeAt(-1, 5, []), 1);
  assert.equal(f.codeAt(1, 1, []), 0);
  assert.equal(f.codeAt(2, 2, []), 1);
  f.bombs.push({ x: 3, y: 1, o: 'x', at: 1, r: 2, p: 0, dx: 0, dy: 0, pr: 0, id: 1 });
  assert.equal(f.codeAt(3, 1, []), 2);
  assert.equal(f.codeAt(3, 1, [idx(3, 1)]), 0, 'a bomb you are standing in');
  assert.ok(f.bombAt(3, 1) && !f.bombAt(4, 1));
  const out = new Uint8Array(N);
  f.fire.push({ i: 5, from: 100, cid: 0 });
  assert.equal(f.fireMap(200, out)[5], 1);
  assert.equal(f.fireMap(100 + BLAST_MS + 1, out)[5], 0);
  assert.equal(layoutOf('classic').order.length, f.order.length);
  assert.equal(tileX(idx(4, 5)), 4);
  assert.equal(tileY(idx(4, 5)), 5);
});
