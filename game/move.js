// How a bomber moves: smooth, sub-tile, four directions, with corner assist. Pure: nothing here touches the page.
//
// A bomber is a box of half-size HALF tiles centred on (x, y) (tile units: tile 3 spans 3..4). `blocked(tx, ty)` says what a tile is:
// 0 free, 1 a wall or crate, 2 a bomb. Holding a direction into a corridor whose mouth is within ASSIST of your lane slides you onto
// the lane first, then you go in: this is what makes the movement forgiving.

import { COLS, ROWS, HALF, ASSIST, idx } from './rules.js';

const EPS = 1e-4;

export function makeBody(x, y) {
  return { x, y, dir: 2, moving: 0, walk: 0, pass: [], bump: -1 };
}

/** Does the bomber's box overlap tile i? */
export function overlapsTile(b, i) {
  const tx = i % COLS;
  const ty = Math.floor(i / COLS);
  return b.x - HALF + EPS < tx + 1 && b.x + HALF - EPS > tx && b.y - HALF + EPS < ty + 1 && b.y + HALF - EPS > ty;
}

/** Bombs the bomber is still standing in can be walked out of; this forgets the ones it has left. */
export function prunePass(b) {
  if (b.pass.length === 0) return;
  b.pass = b.pass.filter((i) => overlapsTile(b, i));
}

/** The first non-free tile code under the box at (x, y), or 0. */
function boxHit(x, y, blocked) {
  const x0 = Math.floor(x - HALF + EPS);
  const x1 = Math.floor(x + HALF - EPS);
  const y0 = Math.floor(y - HALF + EPS);
  const y1 = Math.floor(y + HALF - EPS);
  let code = 0;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const c = blocked(tx, ty);
      if (c === 1) return 1;
      if (c > code) code = c;
    }
  }
  return code;
}

/** How far the box at (x, y) sinks into tile (tx, ty): positive when they overlap. */
function sink(x, y, tx, ty) {
  return Math.min(HALF + 0.5 - Math.abs(x - (tx + 0.5)), HALF + 0.5 - Math.abs(y - (ty + 0.5)));
}

/** Would moving the box from where it is to (nx, ny) sink it deeper into any blocked tile? */
function pushesDeeper(b, nx, ny, blocked) {
  const x0 = Math.floor(nx - HALF + EPS);
  const x1 = Math.floor(nx + HALF - EPS);
  const y0 = Math.floor(ny - HALF + EPS);
  const y1 = Math.floor(ny + HALF - EPS);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (blocked(tx, ty) === 0) continue;
      if (sink(nx, ny, tx, ty) > sink(b.x, b.y, tx, ty) + 1e-9) return true;
    }
  }
  return false;
}

/** Moves along one axis by `d` tiles; returns how far the bomber actually went (sliding sideways counts). */
function axisMove(b, dx, dy, d, blocked) {
  const horiz = dx !== 0;
  const sign = horiz ? dx : dy;
  const nx = horiz ? b.x + sign * d : b.x;
  const ny = horiz ? b.y : b.y + sign * d;
  if (boxHit(nx, ny, blocked) === 0) {
    b.x = nx;
    b.y = ny;
    return d;
  }
  // already wedged into something (a pillar dropped on a corner, a bomb appeared under us): walking out is always allowed,
  // as long as the move doesn't push any deeper into anything
  if (boxHit(b.x, b.y, blocked) !== 0) {
    if (!pushesDeeper(b, nx, ny, blocked)) {
      b.x = nx;
      b.y = ny;
      return d;
    }
    return 0;
  }
  // blocked ahead. Which lane are we in, and is the mouth of that lane open?
  const lane = horiz ? Math.floor(b.y) : Math.floor(b.x); // the row (or column) holding our centre
  const off = (horiz ? b.y : b.x) - (lane + 0.5);
  const edge = (horiz ? nx : ny) + sign * HALF;
  const ahead = Math.floor(edge);
  const code = horiz ? blocked(ahead, lane) : blocked(lane, ahead);
  if (code === 0 && Math.abs(off) <= ASSIST) {
    const s = Math.min(Math.abs(off), d);
    const px = horiz ? b.x : b.x - Math.sign(off) * s;
    const py = horiz ? b.y - Math.sign(off) * s : b.y;
    if (boxHit(px, py, blocked) === 0) {
      b.x = px;
      b.y = py;
      return s;
    }
  }
  if (code === 2 && Math.abs(off) <= 0.3) b.bump = horiz ? ahead + lane * COLS : lane + ahead * COLS;
  // flush against what is in the way
  const flush = sign > 0 ? ahead - HALF : ahead + 1 + HALF;
  const from = horiz ? b.x : b.y;
  const to = sign > 0 ? Math.max(from, Math.min(flush, horiz ? nx : ny)) : Math.min(from, Math.max(flush, horiz ? nx : ny));
  if (horiz) b.x = to;
  else b.y = to;
  return Math.abs(to - from);
}

/**
 * One fixed step. (dx, dy) is the direction held (one of them 0, or both 0), `speed` is in tiles per second.
 * Sets b.dir (0 up, 1 right, 2 down, 3 left), b.moving, b.walk (a phase for the walk bob) and b.bump (a bomb it ran into, or -1).
 */
export function stepBody(b, dx, dy, dt, speed, blocked) {
  b.bump = -1;
  if (!(dt > 0) || !Number.isFinite(speed) || (dx === 0 && dy === 0) || (dx !== 0 && dy !== 0)) {
    b.moving = 0;
    return;
  }
  b.dir = dx > 0 ? 1 : dx < 0 ? 3 : dy > 0 ? 2 : 0;
  const dist = Math.min(Math.max(0, speed * dt), 0.5);
  const n = Math.max(1, Math.ceil(dist / 0.2));
  const d = dist / n;
  let moved = 0;
  for (let i = 0; i < n; i++) moved += axisMove(b, dx, dy, d, blocked);
  b.moving = moved > 1e-6 ? 1 : 0;
  if (b.moving) b.walk = (b.walk + moved * 7.5) % (Math.PI * 4);
  if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) {
    b.x = Math.min(COLS - 1.5, Math.max(1.5, Number.isFinite(b.x) ? b.x : 1.5));
    b.y = Math.min(ROWS - 1.5, Math.max(1.5, Number.isFinite(b.y) ? b.y : 1.5));
  }
}

/** The tile index under a bomber's centre. */
export const tileOf = (b) => idx(Math.min(COLS - 1, Math.max(0, Math.floor(b.x))), Math.min(ROWS - 1, Math.max(0, Math.floor(b.y))));
