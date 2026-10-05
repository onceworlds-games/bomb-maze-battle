import test from 'node:test';
import assert from 'node:assert/strict';
import { COLS, ROWS, N, idx, HALF, speedOf } from '../game/rules.js';
import { makeBody, stepBody, overlapsTile, prunePass, tileOf } from '../game/move.js';
import { Sim } from '../game/sim.js';

const DT = 1 / 60;
const empty = () => new Sim({ map: 'classic', seed: 1, roster: [{ id: 'a' }, { id: 'b' }], crates: new Uint8Array(N) });

/** Holds a direction for `n` fixed steps. */
function walk(sim, b, dx, dy, n, speed = 4.5) {
  for (let i = 0; i < n; i++) stepBody(b, dx, dy, DT, speed, (x, y) => sim.codeAt(x, y, b.pass));
}

test('a bomber covers speed x time along an open lane, and stops flush against the wall', () => {
  const sim = empty();
  const b = makeBody(1.5, 1.5);
  walk(sim, b, 0, 1, 30); // half a second down column 1
  assert.ok(Math.abs(b.y - (1.5 + 4.5 * 0.5)) < 0.02, `y=${b.y}`);
  assert.ok(Math.abs(b.x - 1.5) < 1e-9);
  assert.equal(b.dir, 2);
  assert.equal(b.moving, 1);
  walk(sim, b, 0, 1, 200);
  assert.ok(Math.abs(b.y - (ROWS - 1 - HALF)) < 1e-3, `flush with the bottom wall at ${b.y}`);
  assert.equal(b.moving, 0, 'not walking once it is against the wall');
  walk(sim, b, -1, 0, 100);
  assert.ok(b.x >= 0.5 + HALF - 1e-3 && b.x < 1.6, `and the left wall: ${b.x}`);
});

test('speed power-ups make it faster, three at most', () => {
  const sim = empty();
  const slow = makeBody(1.5, 1.5);
  const fast = makeBody(1.5, 1.5);
  walk(sim, slow, 1, 0, 40, speedOf({ s: 0 }));
  walk(sim, fast, 1, 0, 40, speedOf({ s: 3 }));
  assert.ok(fast.x - 1.5 > (slow.x - 1.5) * 1.35, `${fast.x} vs ${slow.x}`);
});

test('pillars block; a bomber never ends up inside one', () => {
  const sim = empty();
  const b = makeBody(1.5, 2.5); // row 2: pillars at x = 2, 4, ...
  walk(sim, b, 1, 0, 60);
  assert.ok(b.x <= 2 - HALF + 1e-6, `stopped at ${b.x}`);
  for (let k = 0; k < 20; k++) {
    walk(sim, b, k % 2 ? 1 : 0, k % 2 ? 0 : 1, 7);
    assert.equal(sim.codeAt(Math.floor(b.x - HALF + 1e-3), Math.floor(b.y - HALF + 1e-3), b.pass) === 1 && false, false);
  }
});

test('corner assist: holding down just beside a corridor slides you onto its lane', () => {
  const sim = empty();
  // column 1 runs down the left edge, but this bomber is 0.3 tile to the right of its centre: its box would clip the pillar at (2, 2)
  const b = makeBody(1.8, 1.5);
  walk(sim, b, 0, 1, 90);
  assert.ok(b.y > 4, `went down the corridor (y=${b.y})`);
  assert.ok(Math.abs(b.x - 1.5) <= 1 - 2 * HALF + 1e-6, `and is on the lane, as far as it takes to fit (x=${b.x})`);
  // the same from the other side, going up
  const c = makeBody(3.2, 7.5); // 0.3 left of column 3's lane: its box would clip the pillar at (2, 6)
  walk(sim, c, 0, -1, 90);
  assert.ok(c.y < 3 && Math.abs(c.x - 3.5) <= 1 - 2 * HALF + 1e-6, `up: ${c.x},${c.y}`);
  // and sideways into a row
  const d = makeBody(1.5, 2.8); // between rows 2 and 3, mostly row 2 (pillars)... lane is row 2 (y=2.5)? the open row is 3
  walk(sim, d, 1, 0, 60);
  assert.ok(d.x > 1.5, `moved right at all (x=${d.x})`);
});

test('no corner assist when too far from the lane: the pillar just stops you', () => {
  const sim = empty();
  const b = makeBody(1.97, 1.5); // 0.47 off the lane's centre
  walk(sim, b, 0, 1, 90);
  assert.ok(b.y <= 1.61, `held up at ${b.y}`);
  assert.ok(Math.abs(b.x - 1.97) < 1e-6, 'and not slid anywhere');
});

test('turning at an intersection: pressing into a side corridor while a little past it still turns', () => {
  const sim = empty();
  const b = makeBody(1.5, 1.5);
  walk(sim, b, 1, 0, 25); // along row 1 past x = 3 (the corridor down column 3)
  assert.ok(b.x > 3.3 && b.x < 3.5, `x=${b.x}`);
  const before = b.x;
  walk(sim, b, 0, 1, 40); // down column 3, while x is somewhere in it
  assert.ok(b.y > 2.5, `turned down (y=${b.y})`);
  assert.ok(b.x >= 3 + HALF - 1e-3 && b.x <= 4 - HALF + 1e-3, `inside the corridor (x=${b.x}, was ${before})`);
});

test('a bomb under you can be walked out of, then it is a wall; running into it reports it for kicking', () => {
  const sim = empty();
  const b = makeBody(3.5, 1.5);
  sim.bodies.set('a', b);
  sim.stats.get('a').b = 2;
  const bomb = sim.placeBomb('a', 3, 1);
  assert.ok(bomb);
  assert.deepEqual(b.pass, [idx(3, 1)], 'standing in it');
  walk(sim, b, 1, 0, 30);
  prunePass(b);
  assert.deepEqual(b.pass, [], 'stepped off it');
  assert.ok(b.x > 4, 'walked away from it');
  walk(sim, b, -1, 0, 60);
  assert.ok(b.x >= 4 + HALF - 1e-3, `a wall now: ${b.x}`);
  assert.equal(b.bump, idx(3, 1), 'the bomb it ran into');
  assert.equal(tileOf(b), idx(4, 1));
  // not aligned: no bump
  const c = makeBody(5.5, 1.25);
  sim.bodies.set('b', c);
  walk(sim, c, -1, 0, 60);
  assert.ok(c.x < 6);
});

test('a bomber wedged into something (a pillar dropped on a corner) can always walk out', () => {
  const sim = empty();
  const b = makeBody(2.1, 2.2); // overlaps the pillar at (2, 2)
  assert.ok(overlapsTile(b, idx(2, 2)));
  walk(sim, b, 1, 0, 5);
  assert.ok(b.x <= 2.1 + 1e-9, `no deeper into it (${b.x})`);
  walk(sim, b, -1, 0, 20);
  assert.ok(b.x < 1.5, `got out (${b.x})`);
  const c = makeBody(1.5, 1.5);
  const into = makeBody(0.7, 1.5); // wedged into the border wall
  walk(sim, into, -1, 0, 20);
  assert.ok(into.x >= 0.7 - 1e-9, `the wall does not take it in (${into.x})`);
  walk(sim, into, 1, 0, 10);
  assert.ok(into.x > 1.2 && c.x === 1.5);
});

test('nothing goes wrong with a zero, huge or negative step, or two directions at once', () => {
  const sim = empty();
  const b = makeBody(1.5, 1.5);
  const blocked = (x, y) => sim.codeAt(x, y, b.pass);
  stepBody(b, 1, 0, 0, 4.5, blocked);
  stepBody(b, 1, 0, -1, 4.5, blocked);
  stepBody(b, 1, 0, NaN, 4.5, blocked);
  stepBody(b, 1, 1, DT, 4.5, blocked);
  stepBody(b, 0, 0, DT, 4.5, blocked);
  stepBody(b, 1, 0, DT, NaN, blocked);
  assert.equal(b.x, 1.5);
  assert.equal(b.moving, 0);
  stepBody(b, 1, 0, 5, 4.5, blocked); // a five-second stall in one step
  assert.ok(Number.isFinite(b.x) && b.x < COLS - 1, `x=${b.x}`);
  for (let i = 0; i < 2000; i++) {
    const r = (i * 7919) % 5;
    stepBody(b, [0, 1, -1, 0, 0][r], [0, 0, 0, 1, -1][r], DT * (1 + (i % 3)), 4.5 + (i % 4) * 0.6, blocked);
    assert.ok(b.x > 0.5 && b.x < COLS - 0.5 && b.y > 0.5 && b.y < ROWS - 0.5, `inside the arena at step ${i}: ${b.x},${b.y}`);
  }
});

test('the walk phase advances only while moving', () => {
  const sim = empty();
  const b = makeBody(1.5, 1.5);
  walk(sim, b, 1, 0, 10);
  const w = b.walk;
  assert.ok(w > 0);
  walk(sim, b, 0, 0, 10);
  assert.equal(b.walk, w);
});
