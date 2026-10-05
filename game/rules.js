// Bomb Maze Battle: the numbers, the arenas and the pure rules. No DOM, no platform: node tests run this file.
//
// The grid is 15 x 13 tiles; the outer ring is wall, the 13 x 11 inside is the arena. Tile i = y * COLS + x. Times are milliseconds;
// "round time" (rt) counts from the moment play begins in a round.

export const COLS = 15;
export const ROWS = 13;
export const N = COLS * ROWS;
export const idx = (x, y) => y * COLS + x;
export const tileX = (i) => i % COLS;
export const tileY = (i) => Math.floor(i / COLS);
export const inside = (x, y) => x >= 1 && y >= 1 && x <= COLS - 2 && y <= ROWS - 2;

export const TABLE_SIZE = 4; // bots fill a table to this many
export const MAX_PLAYERS = 8;

export const WINS_OPTIONS = [2, 3, 5];
export const MAP_OPTIONS = [
  { value: 'classic', label: 'Classic' },
  { value: 'cross', label: 'Crossroads' },
  { value: 'rings', label: 'Rings' },
];
export const MAP_IDS = MAP_OPTIONS.map((o) => o.value);
export const SETTINGS = [
  { id: 'wins', label: 'Wins needed', options: WINS_OPTIONS, default: 3 },
  { id: 'map', label: 'Arena', options: MAP_OPTIONS, default: 'classic' },
];
export const MAP_ACCENT = { classic: '#33e6ff', cross: '#ff4fe0', rings: '#ffb42a' };
export const MAP_LABEL = { classic: 'CLASSIC', cross: 'CROSSROADS', rings: 'RINGS' };

// ---- timing (ms)
export const T = {
  bannerMs: 2600, // "LAST ONE STANDING"
  openingMs: 800, // the first round of a match starts with a GO
  settleMs: 650, // once one or none is left, wait for late claims before the round is decided
  endMs: 2000, // the arena stays live for the winner's moment
  scoreMs: 4200,
  finalMs: 9000,
  resultsAfterMs: 7000, // the results card stays over the lobby (page-local, performance.now)
  hardCapMs: 70000, // a round never runs longer than this after sudden death starts
};
export const FUSE_MS = 2400;
export const BLAST_MS = 500;
export const SLIDE_SPEED = 8; // tiles per second for a kicked bomb
export const SD_AT_MS = 90000; // sudden death
export const SD_STEP_MS = 350;
export const SD_FAST_STEP_MS = 160;
export const SD_WARN_MS = 600;
export const INV_MS = 1300; // after a shield pops
export const HOST_GRACE_MS = 450; // a person standing in a blast for this long without saying so is knocked out by the host
export const CLAIM_GRACE_MS = 450;

// ---- movement (tiles, seconds)
export const HALF = 0.4; // the bomber's half-size
export const ASSIST = 0.35; // corner assist: slide onto a lane when within this of its centre
export const BASE_SPEED = 4.5;
export const SPEED_STEP = 0.6;
export const SPEED_MAX = 3;
export const STEP_MS = 1000 / 60;

// ---- power-ups
export const START_STATS = { b: 1, r: 2, s: 0, k: 0, p: 0, h: 0 };
export const CAPS = { b: 6, r: 8, s: SPEED_MAX };
export const ITEM_KINDS = ['b', 'r', 's', 'k', 'p', 'h'];
export const ITEM_WEIGHTS = [30, 30, 15, 10, 7, 8];
export const ITEM_NAMES = { b: '+BOMB', r: '+RANGE', s: 'SPEED', k: 'KICK', p: 'PIERCE', h: 'SHIELD' };
export const DROP_CHANCE = 0.35;
export const CRATE_RATE = 0.7;

export const PLAYER_COLORS = [
  { name: 'Blue', main: '#2f8dff', light: '#8cc4ff', dark: '#103f8c', shape: 'circle' },
  { name: 'Red', main: '#ff3b4a', light: '#ff9aa2', dark: '#8c1020', shape: 'square' },
  { name: 'Green', main: '#34df68', light: '#9af2b2', dark: '#0b6a2a', shape: 'triangle' },
  { name: 'Yellow', main: '#ffc61a', light: '#ffe58c', dark: '#8a6200', shape: 'diamond' },
  { name: 'Pink', main: '#ff45d2', light: '#ff9fe8', dark: '#8a1171', shape: 'star' },
  { name: 'Orange', main: '#ff7a1a', light: '#ffbb80', dark: '#8f3a00', shape: 'cross' },
  { name: 'Violet', main: '#9b6bff', light: '#cbb3ff', dark: '#4a2a99', shape: 'hex' },
  { name: 'Cyan', main: '#19e3e3', light: '#90f6f6', dark: '#046a6a', shape: 'bar' },
];
export const BOT_NAMES = ['Nova', 'Echo', 'Blaze', 'Pixel', 'Rook', 'Vex', 'Kai', 'Juno', 'Orbit', 'Zed', 'Mika', 'Rio', 'Ace', 'Sol'];
export const BADGES = new Set(['first-win', 'chain-reaction', 'triple-trap', 'untouched']);

// ---- small helpers
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const isNum = (v, lo = -Infinity, hi = Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
export const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s) {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function roundSeed(matchSeed, n) {
  const base = Number.isFinite(matchSeed) ? matchSeed >>> 0 : 1;
  return (Math.imul(base ^ 0x9e3779b9, 2654435761) + Math.imul(n + 1, 40503)) >>> 0;
}

export const ordinal = (n) => {
  const m = n % 100;
  if (m >= 11 && m <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

export const speedOf = (stats) => BASE_SPEED + SPEED_STEP * clamp(stats?.s | 0, 0, SPEED_MAX);

// ---- the arenas
export const SPAWNS = [
  [1, 1],
  [13, 11],
  [13, 1],
  [1, 11],
  [7, 1],
  [7, 11],
  [1, 6],
  [13, 6],
];
export const spawnOf = (i) => SPAWNS[clamp(i | 0, 0, SPAWNS.length - 1)];

const layouts = new Map();

/** The permanent pillars of an arena (1 = wall or pillar), the tiles kept free of crates, and the order sudden death takes tiles in. */
export function layoutOf(map) {
  const id = MAP_IDS.includes(map) ? map : 'classic';
  let L = layouts.get(id);
  if (L) return L;
  const pillars = new Uint8Array(N);
  const open = new Uint8Array(N);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) pillars[idx(x, y)] = 1;
  const grid = () => {
    for (let y = 2; y <= ROWS - 3; y += 2) for (let x = 2; x <= COLS - 3; x += 2) pillars[idx(x, y)] = 1;
  };
  const ring = (x0, y0, x1, y1, gaps) => {
    for (let x = x0; x <= x1; x++) {
      pillars[idx(x, y0)] = 1;
      pillars[idx(x, y1)] = 1;
    }
    for (let y = y0; y <= y1; y++) {
      pillars[idx(x0, y)] = 1;
      pillars[idx(x1, y)] = 1;
    }
    for (const [gx, gy] of gaps) pillars[idx(gx, gy)] = 0;
  };
  if (id === 'classic') grid();
  else if (id === 'cross') {
    grid();
    const cy = (ROWS - 1) / 2;
    const cx = (COLS - 1) / 2;
    for (let x = 1; x <= COLS - 2; x++) {
      pillars[idx(x, cy)] = 0;
      open[idx(x, cy)] = 1;
    }
    for (let y = 1; y <= ROWS - 2; y++) open[idx(cx, y)] = 1;
  } else {
    const cx = (COLS - 1) / 2;
    const cy = (ROWS - 1) / 2;
    ring(2, 2, COLS - 3, ROWS - 3, [
      [cx, 2],
      [cx, ROWS - 3],
    ]);
    ring(4, 4, COLS - 5, ROWS - 5, [
      [4, cy],
      [COLS - 5, cy],
    ]);
    pillars[idx(cx, cy)] = 1;
  }
  const order = spiralOrder(pillars);
  const rank = new Int16Array(N).fill(-1);
  order.forEach((i, k) => (rank[i] = k));
  L = { id, pillars, open, order, rank };
  layouts.set(id, L);
  return L;
}

/** Every open tile of the arena, from the outer ring inwards, clockwise: the order sudden death drops pillars in. */
export function spiralOrder(pillars) {
  const out = [];
  let x0 = 1;
  let y0 = 1;
  let x1 = COLS - 2;
  let y1 = ROWS - 2;
  const push = (x, y) => {
    const i = idx(x, y);
    if (!pillars[i]) out.push(i);
  };
  while (x0 <= x1 && y0 <= y1) {
    for (let x = x0; x <= x1; x++) push(x, y0);
    for (let y = y0 + 1; y <= y1; y++) push(x1, y);
    if (y1 > y0) for (let x = x1 - 1; x >= x0; x--) push(x, y1);
    if (x1 > x0) for (let y = y1 - 1; y > y0; y--) push(x0, y);
    x0++;
    y0++;
    x1--;
    y1--;
  }
  return out;
}

/** Tiles within `dist` steps of any spawn over open lanes (a bomb dropped at a spawn can always be escaped from). */
export function spawnZone(pillars, spawns, dist = 3) {
  const zone = new Uint8Array(N);
  for (const [sx, sy] of spawns) {
    const seen = new Map([[idx(sx, sy), 0]]);
    const queue = [idx(sx, sy)];
    while (queue.length) {
      const i = queue.shift();
      const d = seen.get(i);
      zone[i] = 1;
      if (d >= dist) continue;
      const x = tileX(i);
      const y = tileY(i);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inside(nx, ny)) continue;
        const j = idx(nx, ny);
        if (pillars[j] || seen.has(j)) continue;
        seen.set(j, d + 1);
        queue.push(j);
      }
    }
  }
  return zone;
}

/** The crates a round starts with: about 70% of the free tiles, none near a spawn and none in a crossroads' open centre. */
export function makeCrates(map, seed, players = TABLE_SIZE, rate = CRATE_RATE) {
  const L = layoutOf(map);
  const rng = mulberry32(seed);
  const zone = spawnZone(L.pillars, SPAWNS.slice(0, clamp(players | 0, 1, MAX_PLAYERS)), 3);
  const crates = new Uint8Array(N);
  for (let y = 1; y <= ROWS - 2; y++) {
    for (let x = 1; x <= COLS - 2; x++) {
      const i = idx(x, y);
      if (L.pillars[i] || zone[i] || L.open[i]) continue;
      if (rng() < rate) crates[i] = 1;
    }
  }
  return crates;
}

const HEX = '0123456789abcdef';
/** A tile set as hex, four tiles to a digit. */
export function encodeBits(arr) {
  let s = '';
  for (let i = 0; i < N; i += 4) {
    s += HEX[(arr[i] ? 1 : 0) | (arr[i + 1] ? 2 : 0) | (arr[i + 2] ? 4 : 0) | (arr[i + 3] ? 8 : 0)];
  }
  return s;
}

/** The tile set from its hex, or null if it isn't one. */
export function decodeBits(s) {
  if (typeof s !== 'string' || s.length !== Math.ceil(N / 4) || !/^[0-9a-f]+$/.test(s)) return null;
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) out[i] = (parseInt(s[i >> 2], 16) >> (i & 3)) & 1;
  return out;
}

/** What a destroyed crate leaves: nothing (65%) or a power-up kind. */
export function rollItem(rng) {
  if (rng() >= DROP_CHANCE) return null;
  let r = rng() * ITEM_WEIGHTS.reduce((a, b) => a + b, 0);
  for (let k = 0; k < ITEM_KINDS.length; k++) {
    r -= ITEM_WEIGHTS[k];
    if (r < 0) return ITEM_KINDS[k];
  }
  return ITEM_KINDS[0];
}

// ---- the table
/** Humans first (their order is their colour and their corner), then bots up to `seats`. */
export function buildRoster(humanIds, seed, seats = TABLE_SIZE) {
  const humans = [...new Set(humanIds.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 80))].slice(0, MAX_PLAYERS);
  const botCount = Math.max(0, Math.min(seats, MAX_PLAYERS) - humans.length);
  const rng = mulberry32((seed >>> 0) ^ 0xb07b07);
  const names = [...BOT_NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  const roster = humans.map((id, i) => ({ id, bot: 0, c: i }));
  for (let k = 0; k < botCount; k++) roster.push({ id: `bot${k + 1}`, bot: 1, name: names[k % names.length], c: humans.length + k });
  return roster;
}

/** Ids best first: most round wins, then most knock-outs, then seat order. */
export function ranking(ids, wins, kos) {
  return ids
    .map((id, i) => ({ id, i }))
    .sort((a, b) => (wins[b.id] ?? 0) - (wins[a.id] ?? 0) || (kos[b.id] ?? 0) - (kos[a.id] ?? 0) || a.i - b.i)
    .map((o) => o.id);
}

/** 1-based places for a ranking; players equal on wins and knock-outs share one. */
export function places(ranked, wins, kos) {
  const out = [];
  ranked.forEach((id, i) => {
    const prev = ranked[i - 1];
    const same = i > 0 && (wins[prev] ?? 0) === (wins[id] ?? 0) && (kos[prev] ?? 0) === (kos[id] ?? 0);
    out.push(same ? out[i - 1] : i + 1);
  });
  return out;
}

/** The knock-out and chain awards for the results. */
export function awardsOf(ids, kos, chain) {
  const best = (m) => {
    let id = null;
    let v = 0;
    for (const i of ids) if ((m[i] ?? 0) > v) {
      v = m[i];
      id = i;
    }
    return id;
  };
  return { kos: best(kos), chain: best(chain) };
}

/** How many round wins end the match, from the setting. */
export const winsOf = (v) => (WINS_OPTIONS.includes(v) ? v : 3);
export const mapOf = (v) => (MAP_IDS.includes(v) ? v : 'classic');
/** A match that keeps drawing still ends: after this many rounds the leader wins. */
export const roundCap = (need) => need * 3 + 2;

/** Names are drawn with fillText only, but keep them short and printable. */
export function cleanName(name, fallback = 'Player') {
  const s = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim() : '';
  return (s || fallback).slice(0, 14);
}
