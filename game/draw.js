// The arena renderer: a tilted top-down board where pillars, crates and walls are boxes with a front face, lit blasts, bombs, power-ups and
// armoured bombers. Static pieces are drawn once into sprites (rebuilt when the size or the arena changes); everything that moves is drawn
// each frame. Positions are in tile units (a bomber at x = 3.5 stands in the middle of tile 3); `view` turns them into pixels.

import { COLS, ROWS, N, idx, tileX, tileY, PLAYER_COLORS, BLAST_MS, clamp, hashStr } from './rules.js';

export const FONT = '"Oxanium", "Segoe UI", system-ui, sans-serif';
const TAU = Math.PI * 2;

export const ITEM_COLORS = { b: '#7aa2ff', r: '#ff8a1f', s: '#ffe14a', k: '#3de0ff', p: '#ff5cd6', h: '#5bffb0' };

export function makeView() {
  return { W: 0, H: 0, pr: 1, S: 32, ox: 0, oy: 0, fh: 9, sprites: null, quality: 2, reduced: false };
}

/** Fits the board between `top` and `bottom` pixels of the window. */
export function layoutBoard(v, W, H, top, bottom) {
  const availH = Math.max(80, H - top - bottom);
  const S = Math.floor(clamp(Math.min(W / (COLS + 0.3), availH / (ROWS + 0.34)), 12, 110));
  v.W = W;
  v.H = H;
  v.S = S;
  v.fh = Math.round(S * 0.3);
  const boardH = ROWS * S + v.fh;
  v.ox = Math.round((W - COLS * S) / 2);
  v.oy = Math.round(top + (availH - boardH) / 2 + v.fh);
}

// ------------------------------------------------------------------ text and shapes
export function label(ctx, text, x, y, size, o = {}) {
  ctx.font = `${o.weight ?? 800} ${Math.max(6, Math.round(size))}px ${FONT}`;
  ctx.textAlign = o.align ?? 'center';
  ctx.textBaseline = o.base ?? 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  try {
    ctx.letterSpacing = `${o.spacing ?? 0}px`;
  } catch {
    // an older browser: no tracking
  }
  const ol = o.outline ?? 0.17;
  if (ol > 0) {
    ctx.lineWidth = Math.max(2, size * ol);
    ctx.strokeStyle = o.stroke ?? 'rgba(5,8,15,0.92)';
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = o.fill ?? '#ffffff';
  ctx.fillText(text, x, y);
}

/** A rounded rectangle path. */
export function rr(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** A rectangle with its corners cut (a flat, sporty panel). */
export function chamfer(ctx, x, y, w, h, c) {
  c = Math.max(0, Math.min(c, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + c, y);
  ctx.lineTo(x + w - c, y);
  ctx.lineTo(x + w, y + c);
  ctx.lineTo(x + w, y + h - c);
  ctx.lineTo(x + w - c, y + h);
  ctx.lineTo(x + c, y + h);
  ctx.lineTo(x, y + h - c);
  ctx.lineTo(x, y + c);
  ctx.closePath();
}

// ------------------------------------------------------------------ sprites
function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

function hazard(g, x, y, w, h, size) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = '#ffc61a';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#12151c';
  for (let k = -h; k < w + h; k += size * 2) {
    g.beginPath();
    g.moveTo(x + k, y + h);
    g.lineTo(x + k + size, y + h);
    g.lineTo(x + k + size + h, y);
    g.lineTo(x + k + h, y);
    g.closePath();
    g.fill();
  }
  g.restore();
}

function lin(g, x0, y0, x1, y1, a, b) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, a);
  gr.addColorStop(1, b);
  return gr;
}

function makeFloor(S, pr, accent) {
  const k = canvasOf(COLS * S * pr, ROWS * S * pr);
  if (!k) return null;
  const g = k.g;
  g.scale(pr, pr);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const px = x * S;
      const py = y * S;
      g.fillStyle = (x + y) % 2 ? '#1a2131' : '#1e2638';
      g.fillRect(px, py, S, S);
      g.fillStyle = 'rgba(255,255,255,0.045)';
      g.fillRect(px, py, S, 1);
      g.fillRect(px, py, 1, S);
      g.fillStyle = 'rgba(0,0,0,0.38)';
      g.fillRect(px, py + S - 1, S, 1);
      g.fillRect(px + S - 1, py, 1, S);
      // corner marks, like panel fixings
      g.fillStyle = 'rgba(255,255,255,0.07)';
      const m = S * 0.1;
      const l = S * 0.12;
      for (const [cx, cy, sx, sy] of [[px + m, py + m, 1, 1], [px + S - m, py + m, -1, 1], [px + m, py + S - m, 1, -1], [px + S - m, py + S - m, -1, -1]]) {
        g.fillRect(cx, cy, l * sx, 1);
        g.fillRect(cx, cy, 1, l * sy);
      }
      // a faint grille in the middle of every other tile
      if ((x * 3 + y * 5) % 4 === 0) {
        g.fillStyle = 'rgba(0,0,0,0.16)';
        for (let i = 0; i < 4; i++) g.fillRect(px + S * 0.34, py + S * (0.36 + i * 0.075), S * 0.32, Math.max(1, S * 0.03));
      }
    }
  }
  // the arena's colour bleeds onto the floor along the walls
  const edge = S * 0.9;
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [
    [0, S, 0, S + edge, 0, S, COLS * S, edge],
    [0, (ROWS - 1) * S, 0, (ROWS - 1) * S - edge, 0, (ROWS - 1) * S - edge, COLS * S, edge],
    [S, 0, S + edge, 0, S, 0, edge, ROWS * S],
    [(COLS - 1) * S, 0, (COLS - 1) * S - edge, 0, (COLS - 1) * S - edge, 0, edge, ROWS * S],
  ]) {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, hexA(accent, 0.2));
    gr.addColorStop(1, hexA(accent, 0));
    g.fillStyle = gr;
    g.fillRect(rx, ry, rw, rh);
  }
  const vg = g.createRadialGradient((COLS * S) / 2, (ROWS * S) / 2, S * 3, (COLS * S) / 2, (ROWS * S) / 2, S * 10);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.38)');
  g.fillStyle = vg;
  g.fillRect(0, 0, COLS * S, ROWS * S);
  return k.c;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function makePillar(S, fh, pr) {
  const k = canvasOf(S * pr, (S + fh) * pr);
  if (!k) return null;
  const g = k.g;
  g.scale(pr, pr);
  // front face
  g.fillStyle = lin(g, 0, S, 0, S + fh, '#707c91', '#363f50');
  g.fillRect(0, S, S, fh);
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.fillRect(0, S, S, 1);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(S * 0.5 - 1, S + 1, 2, fh - 1);
  g.fillRect(S * 0.18, S + 1, 1, fh - 1);
  g.fillRect(S * 0.82, S + 1, 1, fh - 1);
  hazard(g, 0, S + fh * 0.7, S, fh * 0.3, Math.max(2, S * 0.06));
  // top face
  g.fillStyle = lin(g, 0, 0, S, S, '#d3dcea', '#8996ab');
  g.fillRect(0, 0, S, S);
  const m = S * 0.05;
  const rw = S * 0.14;
  g.save();
  g.beginPath();
  g.rect(m, m, S - 2 * m, S - 2 * m);
  g.rect(m + rw, m + rw, S - 2 * (m + rw), S - 2 * (m + rw));
  g.clip('evenodd');
  hazard(g, m, m, S - 2 * m, S - 2 * m, Math.max(2, S * 0.085));
  g.restore();
  const ix = m + rw + 1;
  const iw = S - 2 * ix;
  g.fillStyle = lin(g, ix, ix, ix + iw, ix + iw, '#aeb9cb', '#74829a');
  g.fillRect(ix, ix, iw, iw);
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fillRect(ix, ix, iw, 1);
  g.fillRect(ix, ix, 1, iw);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(ix, ix + iw - 1, iw, 1);
  g.fillRect(ix + iw - 1, ix, 1, iw);
  g.fillStyle = '#4c566a';
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.075, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.beginPath();
  g.arc(S / 2 - S * 0.02, S / 2 - S * 0.02, S * 0.03, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.fillRect(0, 0, S, 1);
  g.fillRect(0, 0, 1, S);
  return k.c;
}

const CRATE_DECAL = ['#ff7a1a', '#19d3c5', '#f1f4fa'];

function makeCrate(S, fh, pr, variant) {
  const k = canvasOf(S * pr, (S + fh) * pr);
  if (!k) return null;
  const g = k.g;
  g.scale(pr, pr);
  // front face: planks and a metal strap
  g.fillStyle = lin(g, 0, S, 0, S + fh, '#a07038', '#6a4522');
  g.fillRect(0, S, S, fh);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(S * 0.33, S, 1.5, fh);
  g.fillRect(S * 0.66, S, 1.5, fh);
  g.fillStyle = '#2a303c';
  g.fillRect(0, S + fh * 0.32, S, fh * 0.26);
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.fillRect(0, S + fh * 0.32, S, 1);
  g.fillStyle = '#6b7488';
  for (const bx of [S * 0.14, S * 0.86]) {
    g.beginPath();
    g.arc(bx, S + fh * 0.45, Math.max(1, S * 0.025), 0, TAU);
    g.fill();
  }
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(0, S, S, 1);
  // top face
  g.fillStyle = lin(g, 0, 0, S, S, '#dcb274', '#bb8a4e');
  g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(70,40,12,0.4)';
  for (let i = 1; i < 4; i++) g.fillRect(S * 0.1, S * (i / 4) - 0.5, S * 0.8, 1.2);
  const f = S * 0.1;
  g.fillStyle = '#91612f';
  g.fillRect(0, 0, S, f);
  g.fillRect(0, S - f, S, f);
  g.fillRect(0, 0, f, S);
  g.fillRect(S - f, 0, f, S);
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.fillRect(0, 0, S, 1);
  g.fillRect(0, 0, 1, S);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(f, f, S - 2 * f, 1);
  g.fillRect(f, f, 1, S - 2 * f);
  // metal corner brackets
  g.fillStyle = '#2b313d';
  const b = S * 0.19;
  for (const [bx, by] of [[0, 0], [S - b, 0], [0, S - b], [S - b, S - b]]) g.fillRect(bx, by, b, b);
  g.fillStyle = '#7d879b';
  for (const [bx, by] of [[b / 2, b / 2], [S - b / 2, b / 2], [b / 2, S - b / 2], [S - b / 2, S - b / 2]]) {
    g.beginPath();
    g.arc(bx, by, Math.max(1, S * 0.03), 0, TAU);
    g.fill();
  }
  // a stencilled mark
  const c = CRATE_DECAL[variant % 3];
  g.save();
  g.translate(S / 2, S / 2);
  g.strokeStyle = c;
  g.fillStyle = c;
  g.lineWidth = Math.max(1.5, S * 0.07);
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
  if (variant % 3 === 0) {
    for (const dx of [-S * 0.1, S * 0.08]) {
      g.beginPath();
      g.moveTo(dx - S * 0.08, -S * 0.16);
      g.lineTo(dx + S * 0.06, 0);
      g.lineTo(dx - S * 0.08, S * 0.16);
      g.stroke();
    }
  } else if (variant % 3 === 1) {
    g.beginPath();
    g.arc(0, 0, S * 0.17, 0, TAU);
    g.stroke();
    g.beginPath();
    g.moveTo(-S * 0.17, 0);
    g.lineTo(S * 0.17, 0);
    g.moveTo(0, -S * 0.17);
    g.lineTo(0, S * 0.17);
    g.stroke();
  } else {
    g.beginPath();
    g.moveTo(-S * 0.14, -S * 0.14);
    g.lineTo(S * 0.14, S * 0.14);
    g.moveTo(S * 0.14, -S * 0.14);
    g.lineTo(-S * 0.14, S * 0.14);
    g.stroke();
  }
  g.restore();
  return k.c;
}

/** Border wall pieces: `mask` says which edges (1 N, 2 E, 4 S, 8 W) face the arena and carry the neon trim. */
function makeWall(S, fh, pr, accent, mask) {
  const k = canvasOf(S * pr, (S + fh) * pr);
  if (!k) return null;
  const g = k.g;
  g.scale(pr, pr);
  g.fillStyle = lin(g, 0, S, 0, S + fh, '#1d2434', '#0e121c');
  g.fillRect(0, S, S, fh);
  g.fillStyle = 'rgba(255,255,255,0.1)';
  g.fillRect(0, S, S, 1);
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.fillRect(S * 0.5 - 1, S + 1, 2, fh - 1);
  g.fillStyle = hexA(accent, 0.55);
  g.fillRect(0, S + fh - Math.max(2, S * 0.05), S, Math.max(2, S * 0.05));
  g.fillStyle = lin(g, 0, 0, S, S, '#2b3550', '#182032');
  g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(255,255,255,0.07)';
  g.fillRect(0, 0, S, 1);
  g.fillRect(0, 0, 1, S);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(S * 0.5 - 0.5, 0, 1, S);
  g.fillRect(0, S * 0.5 - 0.5, S, 1);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  for (const [bx, by] of [[S * 0.2, S * 0.2], [S * 0.8, S * 0.2], [S * 0.2, S * 0.8], [S * 0.8, S * 0.8]]) {
    g.beginPath();
    g.arc(bx, by, Math.max(1, S * 0.03), 0, TAU);
    g.fill();
  }
  const t = Math.max(2, S * 0.07);
  const trims = [];
  if (mask & 1) trims.push([0, 0, S, t]);
  if (mask & 2) trims.push([S - t, 0, t, S]);
  if (mask & 4) trims.push([0, S - t, S, t]);
  if (mask & 8) trims.push([0, 0, t, S]);
  for (const [x, y, w, h] of trims) {
    g.save();
    g.shadowColor = accent;
    g.shadowBlur = S * 0.3;
    g.fillStyle = accent;
    g.fillRect(x, y, w, h);
    g.restore();
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillRect(x + (w > h ? 0 : w * 0.3), y + (w > h ? h * 0.3 : 0), w > h ? w : w * 0.4, w > h ? h * 0.4 : h);
  }
  return k.c;
}

/** (Re)builds the sprites when the size, the pixel ratio or the arena's colour changed. */
export function ensureSprites(v, accent) {
  const key = `${v.S}|${v.pr}|${accent}`;
  if (v.sprites && v.sprites.key === key) return v.sprites;
  let sp = null;
  try {
    sp = {
      key,
      accent,
      floor: makeFloor(v.S, v.pr, accent),
      pillar: makePillar(v.S, v.fh, v.pr),
      crates: [makeCrate(v.S, v.fh, v.pr, 0), makeCrate(v.S, v.fh, v.pr, 1), makeCrate(v.S, v.fh, v.pr, 2)],
      walls: new Map(),
    };
    if (!sp.floor || !sp.pillar || sp.crates.some((c) => !c)) sp = { key, accent, floor: null, pillar: null, crates: [], walls: new Map() };
  } catch {
    sp = { key, accent, floor: null, pillar: null, crates: [], walls: new Map() };
  }
  v.sprites = sp;
  return sp;
}

function wallMask(x, y) {
  let m = 0;
  if (y === 0) m |= 4; // the top row: its lower edge faces the arena
  if (y === ROWS - 1) m |= 1;
  if (x === 0) m |= 2;
  if (x === COLS - 1) m |= 8;
  return m;
}

function wallSprite(v, mask) {
  const sp = v.sprites;
  let w = sp.walls.get(mask);
  if (w === undefined) {
    try {
      w = makeWall(v.S, v.fh, v.pr, sp.accent, mask);
    } catch {
      w = null;
    }
    sp.walls.set(mask, w);
  }
  return w;
}

/** A box on the ground at pixel (px, py) (its top-left corner): the sprite, or flat rectangles if sprites are unavailable. */
function box(ctx, v, spr, px, py, top, front, offY = 0) {
  const S = v.S;
  if (spr) {
    ctx.drawImage(spr, px, py - v.fh + offY, S, S + v.fh);
    return;
  }
  ctx.fillStyle = front;
  ctx.fillRect(px, py - v.fh + S + offY, S, v.fh);
  ctx.fillStyle = top;
  ctx.fillRect(px, py - v.fh + offY, S, S);
}

// ------------------------------------------------------------------ the ground
/**
 * Draws the floor and everything lying on it. `sc`: { field, t, danger (a Float64Array of blast start times or null), pads: [{ x, y, c }] }.
 * `scratch`: { fire: Uint8Array(N), warn: [] }.
 */
export function drawGround(ctx, v, sc, now, scratch) {
  const S = v.S;
  const sp = ensureSprites(v, sc.accent);
  const f = sc.field;
  const t = sc.t;
  if (sp.floor) ctx.drawImage(sp.floor, v.ox, v.oy, COLS * S, ROWS * S);
  else {
    ctx.fillStyle = '#1b2231';
    ctx.fillRect(v.ox, v.oy, COLS * S, ROWS * S);
  }
  // spawn pads
  if (sc.pads) {
    for (const p of sc.pads) {
      const col = PLAYER_COLORS[p.c % PLAYER_COLORS.length];
      const px = v.ox + p.x * S;
      const py = v.oy + p.y * S;
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = col.main;
      ctx.lineWidth = Math.max(1.5, S * 0.05);
      rr(ctx, px - S * 0.4, py - S * 0.4, S * 0.8, S * 0.8, S * 0.12);
      ctx.stroke();
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = col.main;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  // tiles a blast is about to reach
  if (sc.danger) {
    const d = sc.danger;
    for (let i = 0; i < N; i++) {
      const s = d[i];
      if (!(s < Infinity)) continue;
      const left = s - t;
      if (left > 900 || left < -BLAST_MS) continue;
      if (left <= 0) continue;
      const k = 1 - clamp(left / 900, 0, 1);
      ctx.globalAlpha = 0.07 + 0.2 * k * (v.reduced ? 0.85 : 0.7 + 0.3 * Math.sin(now * 22));
      ctx.fillStyle = '#ff4630';
      ctx.fillRect(v.ox + tileX(i) * S + 1, v.oy + tileY(i) * S + 1, S - 2, S - 2);
    }
    ctx.globalAlpha = 1;
  }
  // sudden death: tiles about to drop
  const warn = f.warned(t, scratch.warn);
  for (const i of warn) {
    const x = v.ox + tileX(i) * S;
    const y = v.oy + tileY(i) * S;
    const k = v.reduced ? 0.6 : 0.5 + 0.5 * Math.sin(now * 16);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, S, S);
    ctx.clip();
    ctx.globalAlpha = 0.22 + 0.2 * k;
    ctx.fillStyle = '#ff2d2d';
    ctx.fillRect(x, y, S, S);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = Math.max(2, S * 0.12);
    for (let q = -S; q < S * 2; q += S * 0.36) {
      ctx.beginPath();
      ctx.moveTo(x + q, y + S);
      ctx.lineTo(x + q + S, y);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#ff5a4a';
    ctx.lineWidth = Math.max(2, S * 0.06);
    ctx.strokeRect(x + 1.5, y + 1.5, S - 3, S - 3);
    ctx.globalAlpha = 1;
  }
  drawItems(ctx, v, f.items, now);
  drawFire(ctx, v, f, t, scratch.fire, now);
}

function drawItems(ctx, v, items, now) {
  const S = v.S;
  for (let n = 0; n < items.length; n++) {
    const it = items[n];
    const col = ITEM_COLORS[it.k] ?? '#ffffff';
    const px = v.ox + (tileX(it.i) + 0.5) * S;
    const bob = Math.sin(now * 3 + it.i) * S * 0.03;
    const py = v.oy + (tileY(it.i) + 0.5) * S - S * 0.03 + bob;
    const pulse = 0.5 + 0.5 * Math.sin(now * 4 + it.i * 1.3);
    // glow on the floor
    ctx.globalCompositeOperation = 'lighter';
    const gr = ctx.createRadialGradient(px, py + S * 0.1, S * 0.05, px, py + S * 0.1, S * 0.75);
    gr.addColorStop(0, hexA(col, 0.35 + 0.15 * pulse));
    gr.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = gr;
    ctx.fillRect(px - S * 0.8, py - S * 0.7, S * 1.6, S * 1.6);
    ctx.globalCompositeOperation = 'source-over';
    // the plate
    const w = S * 0.66;
    rr(ctx, px - w / 2, py - w / 2, w, w, S * 0.12);
    ctx.fillStyle = '#0d1320';
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, S * 0.05);
    ctx.strokeStyle = col;
    ctx.stroke();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = col;
    rr(ctx, px - w / 2 + 2, py - w / 2 + 2, w - 4, w * 0.45, S * 0.1);
    ctx.fill();
    ctx.globalAlpha = 1;
    drawIcon(ctx, it.k, px, py, S * 0.21, col);
  }
}

/** The power-up symbols, crisp and simple: each reads at a glance and by shape, not only by colour. */
export function drawIcon(ctx, kind, cx, cy, r, col) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (kind === 'b') {
    // a bomb with a plus
    ctx.fillStyle = '#e8eefc';
    ctx.beginPath();
    ctx.arc(-r * 0.12, r * 0.18, r * 0.72, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#10151f';
    ctx.beginPath();
    ctx.arc(-r * 0.12, r * 0.18, r * 0.58, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#cdb88a';
    ctx.lineWidth = Math.max(1.2, r * 0.18);
    ctx.beginPath();
    ctx.moveTo(r * 0.2, -r * 0.35);
    ctx.quadraticCurveTo(r * 0.5, -r * 0.7, r * 0.7, -r * 0.55);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.4, r * 0.24);
    ctx.beginPath();
    ctx.moveTo(r * 0.52, -r * 0.1);
    ctx.lineTo(r * 1.0, -r * 0.1);
    ctx.moveTo(r * 0.76, -r * 0.34);
    ctx.lineTo(r * 0.76, r * 0.14);
    ctx.stroke();
  } else if (kind === 'r') {
    // a flame
    ctx.fillStyle = '#ff8a1f';
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.bezierCurveTo(r * 0.2, -r * 0.5, r * 0.85, -r * 0.2, r * 0.7, r * 0.35);
    ctx.bezierCurveTo(r * 0.6, r * 0.85, -r * 0.6, r * 0.85, -r * 0.7, r * 0.3);
    ctx.bezierCurveTo(-r * 0.8, -r * 0.1, -r * 0.2, -r * 0.35, 0, -r);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffe27a';
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.1);
    ctx.bezierCurveTo(r * 0.12, r * 0.12, r * 0.42, r * 0.2, r * 0.32, r * 0.52);
    ctx.bezierCurveTo(r * 0.2, r * 0.8, -r * 0.3, r * 0.8, -r * 0.34, r * 0.5);
    ctx.bezierCurveTo(-r * 0.36, r * 0.25, -r * 0.1, r * 0.1, 0, -r * 0.1);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 's') {
    // a lightning bolt
    ctx.fillStyle = '#ffe14a';
    ctx.beginPath();
    ctx.moveTo(r * 0.25, -r);
    ctx.lineTo(-r * 0.62, r * 0.18);
    ctx.lineTo(-r * 0.04, r * 0.18);
    ctx.lineTo(-r * 0.3, r);
    ctx.lineTo(r * 0.65, -r * 0.24);
    ctx.lineTo(r * 0.06, -r * 0.24);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#fff6b0';
    ctx.lineWidth = Math.max(1, r * 0.09);
    ctx.stroke();
  } else if (kind === 'k') {
    // a boot with speed lines
    ctx.fillStyle = '#3de0ff';
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, -r * 0.9);
    ctx.lineTo(r * 0.45, -r * 0.9);
    ctx.lineTo(r * 0.45, r * 0.0);
    ctx.lineTo(r * 1.0, r * 0.3);
    ctx.lineTo(r * 1.0, r * 0.85);
    ctx.lineTo(-r * 0.2, r * 0.85);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#0d1320';
    ctx.fillRect(-r * 0.2, r * 0.6, r * 1.2, r * 0.25);
    ctx.strokeStyle = '#baf4ff';
    ctx.lineWidth = Math.max(1.2, r * 0.16);
    for (const y of [-r * 0.45, -r * 0.05, r * 0.35]) {
      ctx.beginPath();
      ctx.moveTo(-r * 1.0, y);
      ctx.lineTo(-r * 0.5, y);
      ctx.stroke();
    }
  } else if (kind === 'p') {
    // an arrow through a block
    ctx.strokeStyle = '#ff5cd6';
    ctx.lineWidth = Math.max(1.4, r * 0.2);
    ctx.strokeRect(-r * 0.2, -r * 0.7, r * 0.8, r * 1.4);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.6, r * 0.24);
    ctx.beginPath();
    ctx.moveTo(-r * 1.0, 0);
    ctx.lineTo(r * 0.85, 0);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(r * 1.1, 0);
    ctx.lineTo(r * 0.55, -r * 0.42);
    ctx.lineTo(r * 0.55, r * 0.42);
    ctx.closePath();
    ctx.fill();
  } else {
    // a shield
    ctx.fillStyle = '#5bffb0';
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.85, -r * 0.62);
    ctx.lineTo(r * 0.78, r * 0.15);
    ctx.quadraticCurveTo(r * 0.55, r * 0.7, 0, r);
    ctx.quadraticCurveTo(-r * 0.55, r * 0.7, -r * 0.78, r * 0.15);
    ctx.lineTo(-r * 0.85, -r * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.8);
    ctx.lineTo(r * 0.6, -r * 0.5);
    ctx.lineTo(r * 0.02, r * 0.0);
    ctx.lineTo(-r * 0.02, r * 0.0);
    ctx.lineTo(-r * 0.6, -r * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#0d5a3b';
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.1);
    ctx.lineTo(0, r * 0.75);
    ctx.stroke();
  }
  ctx.restore();
  void col;
}

/** Blasts: glowing beams with a white-hot core, drawn as capsules that join up across tiles. */
export function drawFire(ctx, v, f, t, map, now) {
  const fire = f.fire;
  if (fire.length === 0) return;
  const S = v.S;
  map.fill(0);
  let any = false;
  for (let n = 0; n < fire.length; n++) {
    const e = fire[n];
    if (e.from <= t && t < e.from + BLAST_MS) {
      map[e.i] = 1;
      any = true;
    }
  }
  if (!any) return;
  const glow = v.quality > 0;
  for (let layer = 0; layer < 3; layer++) {
    ctx.globalCompositeOperation = layer < 2 && glow ? 'lighter' : 'source-over';
    for (let n = 0; n < fire.length; n++) {
      const e = fire[n];
      const age = t - e.from;
      if (age < 0 || age >= BLAST_MS) continue;
      const i = e.i;
      const x = tileX(i);
      const y = tileY(i);
      const grow = clamp(age / 90, 0, 1);
      const fade = age > 340 ? clamp(1 - (age - 340) / 160, 0, 1) : 1;
      const flick = v.reduced ? 1 : 0.92 + 0.08 * Math.sin(now * 38 + i * 1.7);
      const k = (0.4 + 0.6 * grow) * fade * flick;
      const cx = v.ox + (x + 0.5) * S;
      const cy = v.oy + (y + 0.5) * S;
      const w = [0.94, 0.68, 0.4][layer] * k * S;
      const r = w / 2;
      if (r < 0.5) continue;
      ctx.fillStyle = layer === 0 ? 'rgba(255,70,18,0.62)' : layer === 1 ? 'rgba(255,196,60,0.9)' : 'rgba(255,252,232,1)';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fill();
      const l = x > 0 && map[i - 1] === 1;
      const rt = x < COLS - 1 && map[i + 1] === 1;
      const u = y > 0 && map[i - COLS] === 1;
      const d = y < ROWS - 1 && map[i + COLS] === 1;
      if (l || rt) ctx.fillRect(l ? cx - S / 2 : cx - r, cy - r, (l ? S / 2 : r) + (rt ? S / 2 : r), w);
      if (u || d) ctx.fillRect(cx - r, u ? cy - S / 2 : cy - r, w, (u ? S / 2 : r) + (d ? S / 2 : r));
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** A soft light from the blasts over the whole scene (after the boxes, so they glow too). */
export function drawFireLight(ctx, v, f, t) {
  if (v.quality === 0 || f.fire.length === 0) return;
  const S = v.S;
  ctx.globalCompositeOperation = 'lighter';
  for (let n = 0; n < f.fire.length; n++) {
    const e = f.fire[n];
    const age = t - e.from;
    if (age < 0 || age >= BLAST_MS) continue;
    const fade = age > 300 ? clamp(1 - (age - 300) / 200, 0, 1) : clamp(age / 60, 0, 1);
    const cx = v.ox + (tileX(e.i) + 0.5) * S;
    const cy = v.oy + (tileY(e.i) + 0.5) * S;
    const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 1.25);
    gr.addColorStop(0, `rgba(255,150,60,${0.2 * fade})`);
    gr.addColorStop(1, 'rgba(255,100,30,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(cx - S * 1.3, cy - S * 1.3, S * 2.6, S * 2.6);
  }
  ctx.globalCompositeOperation = 'source-over';
}

// ------------------------------------------------------------------ boxes, bombs and bombers, back to front
/**
 * Pillars, crates and walls row by row, with bombs and bombers between them by their feet's depth.
 * `bombs`: the first `nb` of [{ x, y, phase (0..1 of the fuse), c, key }]; `bombers`: the first `ne` of those described at drawBomber.
 */
const drawList = [];
export function drawStanding(ctx, v, sc, bombs, nb, bombers, ne, now) {
  const S = v.S;
  const f = sc.field;
  const sp = v.sprites;
  const t = sc.t;
  drawList.length = 0;
  for (let i = 0; i < nb; i++) drawList.push({ key: bombs[i].y + 0.3, kind: 0, d: bombs[i] });
  for (let i = 0; i < ne; i++) drawList.push({ key: bombers[i].y + 0.34, kind: 1, d: bombers[i] });
  drawList.sort((a, b) => a.key - b.key);
  let next = 0;
  const count = f.dropCount(t);
  const base = f.sd[2];
  for (let y = 0; y < ROWS; y++) {
    while (next < drawList.length && drawList[next].key < y + 1) drawEntity(ctx, v, drawList[next++], now);
    for (let x = 0; x < COLS; x++) {
      const i = idx(x, y);
      const px = v.ox + x * S;
      const py = v.oy + y * S;
      if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) {
        box(ctx, v, wallSprite(v, wallMask(x, y)), px, py, '#232c40', '#12171f');
      } else if (f.pillars[i]) {
        box(ctx, v, sp.pillar, px, py, '#9aa6b8', '#4a5468');
      } else if (f.rank[i] >= 0 && f.rank[i] < count) {
        // a dropped pillar: it falls in, with a flash where it lands
        const k = f.rank[i];
        const age = k >= base ? t - f.dropTime(k) : 1e9;
        const fall = clamp(age / 220, 0, 1);
        if (age < 0) continue;
        if (fall < 1) {
          ctx.globalAlpha = 0.35 * fall;
          ctx.fillStyle = '#000';
          ctx.fillRect(px + 2, py + 2, S - 4, S - 4);
          ctx.globalAlpha = 1;
        }
        box(ctx, v, sp.pillar, px, py, '#9aa6b8', '#4a5468', -(1 - fall) * (1 - fall) * S * 3);
        if (age < 140) {
          ctx.globalAlpha = 0.5 * (1 - age / 140);
          ctx.fillStyle = '#ffd1b0';
          ctx.fillRect(px, py, S, S);
          ctx.globalAlpha = 1;
        }
      } else if (f.crates[i]) {
        box(ctx, v, sp.crates[hashStr(i) % sp.crates.length || 0], px, py, '#c79a5e', '#7d5430');
      }
    }
  }
  while (next < drawList.length) drawEntity(ctx, v, drawList[next++], now);
}

function drawEntity(ctx, v, e, now) {
  if (e.kind === 0) drawBomb(ctx, v, e.d, now);
  else drawBomber(ctx, v, e.d, now);
}

export function drawBomb(ctx, v, b, now) {
  const S = v.S;
  const col = PLAYER_COLORS[b.c % PLAYER_COLORS.length];
  const px = v.ox + b.x * S;
  const py = v.oy + b.y * S + S * 0.04;
  const phase = clamp(b.phase, 0, 1);
  const freq = 2.2 + 9 * phase * phase;
  const pulse = 1 + 0.075 * Math.sin(now * TAU * freq + b.key);
  const r = S * 0.335 * pulse;
  // shadow
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(px, py + S * 0.3, S * 0.3, S * 0.11, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  // the sphere
  const gr = ctx.createRadialGradient(px - r * 0.35, py - r * 0.4, r * 0.05, px, py, r * 1.15);
  gr.addColorStop(0, '#4a5062');
  gr.addColorStop(0.45, '#171a22');
  gr.addColorStop(1, '#07080c');
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, TAU);
  ctx.fill();
  // the glowing band in the owner's colour
  ctx.save();
  ctx.beginPath();
  ctx.arc(px, py, r, 0, TAU);
  ctx.clip();
  const glow = 0.65 + 0.35 * Math.sin(now * TAU * freq + 1.3);
  if (v.quality > 0) {
    ctx.shadowColor = col.main;
    ctx.shadowBlur = S * 0.28 * glow;
  }
  ctx.strokeStyle = col.main;
  ctx.lineWidth = Math.max(2, S * 0.085);
  ctx.beginPath();
  ctx.ellipse(px, py + r * 0.08, r * 1.04, r * 0.36, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(px - r * 0.38, py - r * 0.48, r * 0.2, r * 0.11, -0.7, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  // about to go: a white flash
  if (phase > 0.86) {
    const flash = clamp((phase - 0.86) / 0.14, 0, 1) * (v.reduced ? 0.6 : 0.5 + 0.5 * Math.sin(now * 55));
    ctx.globalAlpha = flash * 0.55;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px, py, r, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // cap and a fuse with a spark
  ctx.fillStyle = '#2c313d';
  rr(ctx, px - S * 0.06, py - r - S * 0.045, S * 0.15, S * 0.085, S * 0.02);
  ctx.fill();
  const fx = px + S * 0.2;
  const fyy = py - r - S * 0.15;
  ctx.strokeStyle = '#d2bd8f';
  ctx.lineWidth = Math.max(1.4, S * 0.04);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(px + S * 0.02, py - r - S * 0.03);
  ctx.quadraticCurveTo(px + S * 0.04, py - r - S * 0.17, fx, fyy);
  ctx.stroke();
  const sz = S * (0.1 + 0.05 * Math.sin(now * 41 + b.key * 3)) * (1 + phase * 0.6);
  ctx.globalCompositeOperation = 'lighter';
  const sg = ctx.createRadialGradient(fx, fyy, 0, fx, fyy, sz * 1.6);
  sg.addColorStop(0, 'rgba(255,255,230,1)');
  sg.addColorStop(0.35, 'rgba(255,200,70,0.85)');
  sg.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(fx - sz * 1.7, fyy - sz * 1.7, sz * 3.4, sz * 3.4);
  ctx.strokeStyle = 'rgba(255,230,150,0.9)';
  ctx.lineWidth = 1.2;
  for (let k = 0; k < 4; k++) {
    const a = now * 9 + k * 1.6 + b.key;
    ctx.beginPath();
    ctx.moveTo(fx + Math.cos(a) * sz * 0.5, fyy + Math.sin(a) * sz * 0.5);
    ctx.lineTo(fx + Math.cos(a) * sz * (1.1 + 0.4 * Math.sin(now * 30 + k)), fyy + Math.sin(a) * sz * (1.1 + 0.4 * Math.sin(now * 30 + k)));
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** A bomber's face in the visor: the platform avatar (or an initial) in a circle. */
export function face(ctx, head, ax, ay, r, initial, col) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(ax, ay, r, 0, TAU);
  ctx.clip();
  ctx.fillStyle = '#18202e';
  ctx.fillRect(ax - r, ay - r, r * 2, r * 2);
  if (head) {
    try {
      ctx.drawImage(head, ax - r, ay - r, r * 2, r * 2);
    } catch {
      // an image that failed to decode: the initial shows instead
      head = null;
    }
  }
  if (!head) {
    ctx.fillStyle = lin(ctx, ax, ay - r, ax, ay + r, col.main, col.dark);
    ctx.fillRect(ax - r, ay - r, r * 2, r * 2);
    if (initial) label(ctx, initial, ax, ay + r * 0.06, r * 1.25, { outline: 0.1, stroke: 'rgba(0,0,0,0.5)' });
    else {
      // no name to show: two glowing eye slits
      ctx.fillStyle = '#ffffff';
      rr(ctx, ax - r * 0.52, ay - r * 0.32, r * 0.34, r * 0.78, r * 0.17);
      ctx.fill();
      rr(ctx, ax + r * 0.18, ay - r * 0.32, r * 0.34, r * 0.78, r * 0.17);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * An armoured bomber seen from above and slightly in front. `d`: { x, y, dir (0 up 1 right 2 down 3 left), moving, walk, c (colour),
 * head (Image|null), initial, alpha, blink, shield, scale, ring (your own: a ring under the feet) }.
 */
export function drawBomber(ctx, v, d, now) {
  const S = v.S;
  const col = PLAYER_COLORS[d.c % PLAYER_COLORS.length];
  const px = v.ox + d.x * S;
  const fy = v.oy + d.y * S + S * 0.36;
  const sx = d.dir === 1 ? 1 : d.dir === 3 ? -1 : 0;
  const back = d.dir === 0;
  const bob = d.moving ? Math.abs(Math.sin(d.walk)) * S * 0.055 : Math.sin(now * 2.4 + d.c) * S * 0.012;
  const stride = d.moving ? Math.sin(d.walk) : 0;
  const alpha = (d.alpha ?? 1) * (d.blink ? (v.reduced ? 0.6 : Math.floor(now * 14) % 2 ? 0.45 : 1) : 1);
  const sc = d.scale ?? 1;
  ctx.save();
  ctx.translate(px, fy);
  ctx.scale(sc, sc);
  // you: a ring on the floor
  if (d.ring) {
    ctx.globalAlpha = 0.9 * alpha;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.5, S * 0.045);
    ctx.beginPath();
    ctx.ellipse(0, S * 0.02, S * 0.42, S * 0.17, 0, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = col.main;
    ctx.lineWidth = Math.max(1.5, S * 0.03);
    ctx.beginPath();
    ctx.ellipse(0, S * 0.02, S * 0.47, S * 0.2, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.42 * alpha;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, S * 0.02, S * 0.34, S * 0.12, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = alpha;
  // boots
  const bw = S * 0.17;
  const bh = S * 0.11;
  const boot = (cx, by) => {
    ctx.fillStyle = '#1b2232';
    rr(ctx, cx - bw * 0.32, by - bh - S * 0.1, bw * 0.64, S * 0.13, S * 0.03);
    ctx.fill();
    ctx.fillStyle = '#0f131c';
    rr(ctx, cx - bw / 2, by - bh, bw, bh, S * 0.04);
    ctx.fill();
    ctx.fillStyle = col.main;
    ctx.fillRect(cx - bw / 2 + S * 0.015, by - bh * 0.45, bw - S * 0.03, Math.max(1, S * 0.025));
  };
  if (sx !== 0) {
    boot(-S * 0.1 + stride * S * 0.13, -S * 0.0);
    boot(S * 0.1 - stride * S * 0.13, -S * 0.0);
  } else {
    boot(-S * 0.13, -S * 0.0 + stride * S * 0.05);
    boot(S * 0.13, -S * 0.0 - stride * S * 0.05);
  }
  // torso
  const tw = sx !== 0 ? S * 0.42 : S * 0.52;
  const ty = -S * 0.6 - bob;
  ctx.fillStyle = lin(ctx, 0, ty, 0, ty + S * 0.44, '#3a455e', '#1a2030');
  rr(ctx, -tw / 2, ty, tw, S * 0.44, S * 0.12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(200,215,240,0.25)';
  ctx.lineWidth = Math.max(1, S * 0.02);
  ctx.stroke();
  ctx.fillStyle = back ? '#0f1420' : col.main;
  rr(ctx, -S * 0.12 + sx * S * 0.03, ty + S * 0.09, S * 0.24, S * 0.13, S * 0.04);
  ctx.fill();
  if (!back) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(-S * 0.1 + sx * S * 0.03, ty + S * 0.1, S * 0.2, Math.max(1, S * 0.02));
  }
  ctx.fillStyle = '#0c1018';
  ctx.fillRect(-tw / 2 + S * 0.03, ty + S * 0.32, tw - S * 0.06, S * 0.04);
  // shoulder pads in the player's colour
  const pad = (cx, cy, w, h, dark) => {
    ctx.fillStyle = lin(ctx, cx, cy - h / 2, cx, cy + h / 2, dark ? col.main : col.light, dark ? col.dark : col.main);
    rr(ctx, cx - w / 2, cy - h / 2, w, h, S * 0.08);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = Math.max(1, S * 0.02);
    ctx.stroke();
  };
  const py = ty + S * 0.07 + S * 0.02;
  if (sx !== 0) {
    pad(-sx * S * 0.2, py, S * 0.14, S * 0.2, true);
    pad(sx * S * 0.02, py + S * 0.01, S * 0.22, S * 0.23, false);
  } else {
    pad(-S * 0.34, py, S * 0.2, S * 0.22, false);
    pad(S * 0.34, py, S * 0.2, S * 0.22, false);
  }
  // helmet
  const hy = -S * 0.86 - bob;
  const hr = S * 0.3;
  const hg = ctx.createRadialGradient(-hr * 0.35, hy - hr * 0.4, hr * 0.1, 0, hy, hr * 1.1);
  hg.addColorStop(0, '#8693b0');
  hg.addColorStop(0.5, '#38425a');
  hg.addColorStop(1, '#171c29');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.arc(0, hy, hr, 0, TAU);
  ctx.fill();
  // crest
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, hy, hr, 0, TAU);
  ctx.clip();
  ctx.fillStyle = col.main;
  if (sx === 0) ctx.fillRect(-S * 0.045, hy - hr, S * 0.09, hr * 0.85);
  else {
    ctx.strokeStyle = col.main;
    ctx.lineWidth = S * 0.09;
    ctx.beginPath();
    ctx.arc(0, hy, hr * 0.86, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(190,205,235,0.55)';
  ctx.lineWidth = Math.max(1, S * 0.022);
  ctx.beginPath();
  ctx.arc(0, hy, hr, 0, TAU);
  ctx.stroke();
  // visor with the player's face
  if (!back) {
    const vx = sx * S * 0.095;
    const vy = hy + S * 0.045;
    const vrx = sx !== 0 ? S * 0.17 : S * 0.215;
    const vry = S * 0.185;
    ctx.fillStyle = '#080c15';
    ctx.beginPath();
    ctx.ellipse(vx, vy, vrx, vry, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = col.main;
    ctx.lineWidth = Math.max(1.2, S * 0.028);
    ctx.stroke();
    ctx.save();
    ctx.translate(vx + sx * S * 0.01, vy);
    if (sx !== 0) ctx.scale(0.84, 1);
    face(ctx, d.head, 0, 0, S * 0.145, d.initial ?? '?', col);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(vx, vy, vrx, vry, 0, 0, TAU);
    ctx.clip();
    ctx.globalAlpha = 0.14 * alpha;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(vx - vrx, vy - vry * 0.2);
    ctx.lineTo(vx - vrx * 0.1, vy - vry);
    ctx.lineTo(vx + vrx * 0.35, vy - vry);
    ctx.lineTo(vx - vrx * 0.6, vy + vry * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  } else {
    ctx.strokeStyle = '#0c111b';
    ctx.lineWidth = Math.max(1.2, S * 0.03);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-S * 0.12, hy + S * (0.02 + i * 0.06));
      ctx.lineTo(S * 0.12, hy + S * (0.02 + i * 0.06));
      ctx.stroke();
    }
  }
  // a shield bubble
  if (d.shield) {
    const k = 0.5 + 0.5 * Math.sin(now * 7);
    ctx.globalAlpha = (0.12 + 0.07 * k) * alpha;
    ctx.fillStyle = '#6fd6ff';
    ctx.beginPath();
    ctx.ellipse(0, -S * 0.5 - bob, S * 0.55, S * 0.66, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = (0.7 + 0.2 * k) * alpha;
    ctx.strokeStyle = '#a9ecff';
    ctx.lineWidth = Math.max(1.5, S * 0.035);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** A name over a bomber, and an arrow over you for a few seconds. */
export function drawTag(ctx, v, d, now) {
  const S = v.S;
  const px = v.ox + d.x * S;
  const top = v.oy + d.y * S + S * 0.36 - S * 1.2;
  const col = PLAYER_COLORS[d.c % PLAYER_COLORS.length];
  if (d.name) label(ctx, d.name, px, top - S * 0.17, clamp(S * 0.3, 11, 19), { fill: d.ring ? '#ffffff' : '#e8eef9', weight: 700 });
  if (d.arrow) {
    const bob = Math.sin(now * 6) * S * 0.07;
    const ay = top - S * 0.66 + bob;
    ctx.fillStyle = col.main;
    ctx.strokeStyle = '#05080f';
    ctx.lineWidth = Math.max(2, S * 0.07);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(px, ay + S * 0.2);
    ctx.lineTo(px - S * 0.2, ay - S * 0.08);
    ctx.lineTo(px + S * 0.2, ay - S * 0.08);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
  }
  if (d.ready) {
    const rx = px + S * 0.38;
    const ry = top + S * 0.2;
    ctx.fillStyle = '#34df68';
    ctx.beginPath();
    ctx.arc(rx, ry, S * 0.19, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#05080f';
    ctx.lineWidth = Math.max(1.5, S * 0.04);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, S * 0.06);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(rx - S * 0.09, ry);
    ctx.lineTo(rx - S * 0.02, ry + S * 0.07);
    ctx.lineTo(rx + S * 0.1, ry - S * 0.07);
    ctx.stroke();
  }
}

/** The platform's colour-blind-friendly shapes: a small symbol beside every colour that matters. */
export function drawGlyph(ctx, shape, cx, cy, r, fill, stroke = '#05080f') {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(1, r * 0.22);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (shape) {
    case 'circle':
      ctx.arc(cx, cy, r, 0, TAU);
      break;
    case 'square':
      ctx.rect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7);
      break;
    case 'triangle':
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r * 1.0, cy + r * 0.8);
      ctx.lineTo(cx - r * 1.0, cy + r * 0.8);
      ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo(cx, cy - r * 1.1);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r * 1.1);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 ? r * 0.5 : r * 1.1;
        if (i === 0) ctx.moveTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
        else ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
      }
      ctx.closePath();
      break;
    case 'cross':
      ctx.moveTo(cx - r * 0.35, cy - r);
      ctx.lineTo(cx + r * 0.35, cy - r);
      ctx.lineTo(cx + r * 0.35, cy - r * 0.35);
      ctx.lineTo(cx + r, cy - r * 0.35);
      ctx.lineTo(cx + r, cy + r * 0.35);
      ctx.lineTo(cx + r * 0.35, cy + r * 0.35);
      ctx.lineTo(cx + r * 0.35, cy + r);
      ctx.lineTo(cx - r * 0.35, cy + r);
      ctx.lineTo(cx - r * 0.35, cy + r * 0.35);
      ctx.lineTo(cx - r, cy + r * 0.35);
      ctx.lineTo(cx - r, cy - r * 0.35);
      ctx.lineTo(cx - r * 0.35, cy - r * 0.35);
      ctx.closePath();
      break;
    case 'hex':
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        if (i === 0) ctx.moveTo(cx + Math.cos(a) * r * 1.05, cy + Math.sin(a) * r * 1.05);
        else ctx.lineTo(cx + Math.cos(a) * r * 1.05, cy + Math.sin(a) * r * 1.05);
      }
      ctx.closePath();
      break;
    default:
      ctx.rect(cx - r * 1.1, cy - r * 0.45, r * 2.2, r * 0.9);
  }
  ctx.stroke();
  ctx.fill();
}

