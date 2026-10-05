import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLS,
  ROWS,
  N,
  idx,
  tileX,
  tileY,
  inside,
  MAP_IDS,
  SPAWNS,
  layoutOf,
  spiralOrder,
  spawnZone,
  makeCrates,
  encodeBits,
  decodeBits,
  rollItem,
  buildRoster,
  ranking,
  places,
  awardsOf,
  roundSeed,
  mulberry32,
  ordinal,
  speedOf,
  ITEM_KINDS,
  ITEM_WEIGHTS,
  DROP_CHANCE,
  SETTINGS,
  winsOf,
  mapOf,
  roundCap,
  cleanName,
} from '../game/rules.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function reach(pillars, from) {
  const seen = new Set([from]);
  const q = [from];
  while (q.length) {
    const i = q.shift();
    for (const [dx, dy] of DIRS) {
      const x = tileX(i) + dx;
      const y = tileY(i) + dy;
      if (!inside(x, y) || pillars[idx(x, y)] || seen.has(idx(x, y))) continue;
      seen.add(idx(x, y));
      q.push(idx(x, y));
    }
  }
  return seen;
}

test('every arena: a walled border, free spawns, all open tiles connected', () => {
  for (const map of MAP_IDS) {
    const L = layoutOf(map);
    for (let x = 0; x < COLS; x++) assert.ok(L.pillars[idx(x, 0)] && L.pillars[idx(x, ROWS - 1)], `${map}: top and bottom wall`);
    for (let y = 0; y < ROWS; y++) assert.ok(L.pillars[idx(0, y)] && L.pillars[idx(COLS - 1, y)], `${map}: side walls`);
    for (const [sx, sy] of SPAWNS) assert.ok(!L.pillars[idx(sx, sy)], `${map}: spawn ${sx},${sy} is open`);
    let open = 0;
    for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) if (!L.pillars[idx(x, y)]) open++;
    const seen = reach(L.pillars, idx(1, 1));
    assert.equal(seen.size, open, `${map}: every open tile can be reached`);
    for (const [sx, sy] of SPAWNS) assert.ok(seen.has(idx(sx, sy)), `${map}: spawn reachable`);
    assert.ok(open >= 80 && open <= 143, `${map}: ${open} open tiles`);
  }
});

test('classic has pillars on every even row and column; crossroads opens the middle; rings are concentric with gaps', () => {
  const c = layoutOf('classic').pillars;
  assert.ok(c[idx(2, 2)] && c[idx(12, 10)] && c[idx(6, 6)] && !c[idx(3, 2)] && !c[idx(2, 3)] && !c[idx(7, 7)]);
  const x = layoutOf('cross');
  assert.ok(!x.pillars[idx(6, 6)] && !x.pillars[idx(8, 6)] && x.pillars[idx(6, 4)], 'the middle row has no pillars, the rest of the grid does');
  assert.ok(x.open[idx(7, 3)] && x.open[idx(3, 6)] && !x.open[idx(3, 3)]);
  const r = layoutOf('rings').pillars;
  assert.ok(r[idx(2, 5)] && r[idx(5, 4)] && r[idx(7, 6)], 'rings and the centre pillar');
  assert.ok(!r[idx(7, 2)] && !r[idx(4, 6)], 'gaps in the rings');
});

test('sudden death takes every open tile exactly once, from the outside in', () => {
  for (const map of MAP_IDS) {
    const L = layoutOf(map);
    let open = 0;
    for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) if (!L.pillars[idx(x, y)]) open++;
    assert.equal(L.order.length, open);
    assert.equal(new Set(L.order).size, open);
    const ring = (i) => Math.min(tileX(i) - 1, tileY(i) - 1, COLS - 2 - tileX(i), ROWS - 2 - tileY(i));
    for (let k = 1; k < L.order.length; k++) assert.ok(ring(L.order[k]) >= ring(L.order[k - 1]), `${map}: rings in order`);
    L.order.forEach((i, k) => assert.equal(L.rank[i], k));
  }
  assert.equal(spiralOrder(layoutOf('classic').pillars)[0], idx(1, 1));
});

test('crates cover about 70% of the free tiles and keep clear of every spawn and the crossroads centre', () => {
  for (const map of MAP_IDS) {
    const L = layoutOf(map);
    for (const players of [4, 8]) {
      const zone = spawnZone(L.pillars, SPAWNS.slice(0, players), 3);
      let crates = 0;
      let eligible = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const c = makeCrates(map, seed, players);
        for (let i = 0; i < N; i++) {
          if (c[i]) {
            crates++;
            assert.ok(!L.pillars[i] && !zone[i] && !L.open[i], `${map}: a crate on a pillar, near a spawn or in the open centre`);
          }
          if (!L.pillars[i] && !zone[i] && !L.open[i] && inside(tileX(i), tileY(i))) eligible++;
        }
      }
      const rate = crates / eligible;
      assert.ok(rate > 0.66 && rate < 0.74, `${map}/${players}: ${rate.toFixed(3)} of the free tiles`);
    }
  }
  assert.deepEqual(makeCrates('classic', 77), makeCrates('classic', 77), 'the same seed, the same crates');
  assert.notDeepEqual(makeCrates('classic', 77), makeCrates('classic', 78));
});

test('a bomb dropped on any spawn (range 2) can be escaped on foot well inside the fuse', () => {
  for (const map of MAP_IDS) {
    const L = layoutOf(map);
    for (const [sx, sy] of SPAWNS) {
      // the first tile out of the cross within 4 steps
      const inBlast = new Set([idx(sx, sy)]);
      for (const [dx, dy] of DIRS) for (let k = 1; k <= 2; k++) {
        const x = sx + dx * k;
        const y = sy + dy * k;
        if (!inside(x, y) || L.pillars[idx(x, y)]) break;
        inBlast.add(idx(x, y));
      }
      const dist = new Map([[idx(sx, sy), 0]]);
      const q = [idx(sx, sy)];
      let found = -1;
      while (q.length && found < 0) {
        const i = q.shift();
        for (const [dx, dy] of DIRS) {
          const x = tileX(i) + dx;
          const y = tileY(i) + dy;
          if (!inside(x, y) || L.pillars[idx(x, y)] || dist.has(idx(x, y))) continue;
          dist.set(idx(x, y), dist.get(i) + 1);
          if (!inBlast.has(idx(x, y))) {
            found = dist.get(idx(x, y));
            break;
          }
          q.push(idx(x, y));
        }
      }
      assert.ok(found > 0 && found <= 4, `${map} ${sx},${sy}: out of the blast in ${found} steps`);
      assert.ok(found / 4.5 < 1.2, 'in a second or so');
    }
  }
});

test('crate sets round-trip through hex; junk is refused', () => {
  const c = makeCrates('rings', 5);
  const s = encodeBits(c);
  assert.equal(s.length, Math.ceil(N / 4));
  assert.deepEqual(decodeBits(s), c);
  assert.equal(decodeBits('xyz'), null);
  assert.equal(decodeBits(s.slice(1)), null);
  assert.equal(decodeBits(null), null);
  assert.equal(decodeBits(s.replace(/./, 'g')), null);
});

test('crates drop a power-up 35% of the time, by the published odds', () => {
  const rng = mulberry32(99);
  const n = 40000;
  const got = Object.fromEntries(ITEM_KINDS.map((k) => [k, 0]));
  let none = 0;
  for (let i = 0; i < n; i++) {
    const k = rollItem(rng);
    if (k === null) none++;
    else got[k]++;
  }
  assert.ok(Math.abs(1 - none / n - DROP_CHANCE) < 0.012, `drop chance ${(1 - none / n).toFixed(3)}`);
  const total = ITEM_WEIGHTS.reduce((a, b) => a + b, 0);
  ITEM_KINDS.forEach((k, i) => {
    const want = ITEM_WEIGHTS[i] / total;
    assert.ok(Math.abs(got[k] / (n - none) - want) < 0.015, `${k}: ${(got[k] / (n - none)).toFixed(3)} vs ${want}`);
  });
});

test('the table: people first, bots up to four, none when five or more come', () => {
  const r1 = buildRoster(['a'], 5);
  assert.deepEqual(r1.map((r) => r.id), ['a', 'bot1', 'bot2', 'bot3']);
  assert.deepEqual(r1.map((r) => r.bot), [0, 1, 1, 1]);
  assert.deepEqual(r1.map((r) => r.c), [0, 1, 2, 3], 'distinct colours');
  assert.equal(new Set(r1.filter((r) => r.bot).map((r) => r.name)).size, 3, 'distinct bot names');
  assert.equal(buildRoster(['a', 'b', 'c', 'd'], 5).length, 4);
  const big = buildRoster(['a', 'b', 'c', 'd', 'e', 'f'], 5);
  assert.equal(big.length, 6);
  assert.ok(big.every((r) => !r.bot));
  assert.equal(buildRoster(Array.from({ length: 12 }, (_, i) => `p${i}`), 5).length, 8, 'at most eight');
  assert.equal(buildRoster(['a', 'a', 'b'], 5).filter((r) => !r.bot).length, 2, 'no duplicates');
  assert.deepEqual(buildRoster(['a'], 9), buildRoster(['a'], 9), 'the same seed, the same names');
  assert.equal(buildRoster([], 1).length, 4);
});

test('ranking: wins, then knock-outs, then seat; ties share a place', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const wins = { a: 1, b: 3, c: 3, d: 0 };
  const kos = { a: 5, b: 1, c: 4, d: 0 };
  const r = ranking(ids, wins, kos);
  assert.deepEqual(r, ['c', 'b', 'a', 'd']);
  assert.deepEqual(places(r, wins, kos), [1, 2, 3, 4]);
  const tie = ranking(ids, { a: 2, b: 2, c: 0, d: 0 }, { a: 1, b: 1, c: 0, d: 0 });
  assert.deepEqual(tie, ['a', 'b', 'c', 'd']);
  assert.deepEqual(places(tie, { a: 2, b: 2, c: 0, d: 0 }, { a: 1, b: 1, c: 0, d: 0 }), [1, 1, 3, 3]);
  const aw = awardsOf(ids, { a: 2, b: 5, c: 0, d: 0 }, { a: 0, b: 0, c: 0, d: 0 });
  assert.equal(aw.kos, 'b');
  assert.equal(aw.chain, null, 'nobody set off a chain: no award');
});

test('settings, seeds and small helpers', () => {
  assert.deepEqual(SETTINGS.map((s) => s.id), ['wins', 'map']);
  assert.equal(winsOf(5), 5);
  assert.equal(winsOf(7), 3);
  assert.equal(mapOf('rings'), 'rings');
  assert.equal(mapOf('x'), 'classic');
  assert.equal(roundCap(3), 11);
  assert.notEqual(roundSeed(10, 1), roundSeed(10, 2));
  assert.equal(roundSeed(10, 1), roundSeed(10, 1));
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 102, 111].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '102nd', '111th']);
  assert.equal(speedOf({ s: 0 }), 4.5);
  assert.ok(Math.abs(speedOf({ s: 3 }) - 6.3) < 1e-9);
  assert.ok(Math.abs(speedOf({ s: 9 }) - 6.3) < 1e-9, 'speed stacks stop at three');
  assert.equal(cleanName('  Ann\n  Lee  '), 'Ann Lee');
  assert.equal(cleanName('', 'Guest'), 'Guest');
  assert.equal(cleanName('x'.repeat(40)).length, 14);
});
