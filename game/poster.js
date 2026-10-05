// Store art from the game itself: `?poster=<name>` draws ONE staged, deterministic frame with the real renderer (no room, no SDK), sets
// `document.body.dataset.ready = '1'` and stops. Posters: cover, action, win (1280 x 720), icon (512), badge-<id> (256).

import { N, idx, MAP_ACCENT, STEP_MS, makeCrates, tileX, tileY } from './rules.js';
import { Sim } from './sim.js';
import { Fx } from './fx.js';
import { makeView, ensureSprites, drawGround, drawStanding, drawFireLight, drawFire, drawBomb, label, FONT } from './draw.js';
import { drawVignette, ACCENT } from './ui.js';

const TAU = Math.PI * 2;
const NOW = 1.37; // the animation clock of the frozen frame: fixed, so every capture is the same picture

function stage(W, H, S, cx, cy, tx, ty) {
  const v = makeView();
  v.W = W;
  v.H = H;
  v.pr = 1;
  v.quality = 2;
  v.S = S;
  v.fh = Math.round(S * 0.3);
  v.ox = Math.round(cx - (tx + 0.5) * S);
  v.oy = Math.round(cy - (ty + 0.5) * S);
  return v;
}

function bomber(x, y, dir, c, o = {}) {
  return { x, y, dir, moving: o.moving ?? 1, walk: o.walk ?? 1, c, head: null, initial: o.initial ?? '', alpha: 1, blink: false, shield: Boolean(o.shield), scale: o.scale ?? 1, ring: false, name: '', arrow: false, ready: false };
}

const roster4 = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

/** Sets bombs with the given range at tiles, the first going off at `first` ms and the rest later (they go in its chain). */
function plant(sim, id, range, tiles, first = 1000) {
  const s = sim.stats.get(id);
  s.b = 20;
  s.r = range;
  s.p = 0;
  tiles.forEach(([x, y], i) => {
    const b = sim.placeBomb(id, x, y);
    b.at = i === 0 ? first : first + 2500;
  });
}

function emitBlast(fx, sim) {
  for (const f of sim.fire) {
    const x = tileX(f.i) + 0.5;
    const y = tileY(f.i) + 0.5;
    fx.sparks(x, y, 5, '#ffc15a', 4.2, 0.3);
    if (fx.rnd() < 0.55) fx.smoke(x, y, 1, 0.3);
  }
}

/** Runs the world's fixed steps up to round time `to`. */
function runTo(sim, to) {
  while (sim.t + STEP_MS <= to) sim.tick();
}

function ageFx(fx, secs) {
  for (let t = 0; t < secs; t += 0.03) fx.update(0.03);
}

function draw(ctx, v, sim, accent, bombers, fx, o = {}) {
  const sc = { field: sim, t: sim.t, accent, danger: null, pads: null };
  const scratch = { fire: new Uint8Array(N), warn: [] };
  ctx.fillStyle = '#070a12';
  ctx.fillRect(0, 0, v.W, v.H);
  drawGround(ctx, v, sc, NOW, scratch);
  o.afterGround?.();
  const bombs = sim.bombs.map((b) => ({ x: b.x + 0.5, y: b.y + 0.5, phase: 1 - (b.at - sim.t) / 2400, c: sim.index.get(b.o) ?? 0, key: b.id }));
  drawStanding(ctx, v, sc, bombs, bombs.length, bombers, bombers.length, NOW);
  drawFireLight(ctx, v, sim, sim.t);
  fx.draw(ctx, v);
}

function scrimTop(ctx, W, H, to) {
  const g = ctx.createLinearGradient(0, 0, 0, to);
  g.addColorStop(0, 'rgba(4,6,12,0.94)');
  g.addColorStop(0.75, 'rgba(4,6,12,0.72)');
  g.addColorStop(1, 'rgba(4,6,12,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, to);
}

function vignette(ctx, W, H, a) {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.78);
  g.addColorStop(0, 'rgba(3,5,10,0)');
  g.addColorStop(1, `rgba(3,5,10,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// ------------------------------------------------------------------ cover
function cover(ctx, W, H) {
  const sim = new Sim({ map: 'classic', seed: 31, roster: roster4, crates: makeCrates('classic', 31, 4) });
  const fx = new Fx(77);
  // the lanes of the big chain are open; crates at the ends of the side beams will break
  for (let k = 1; k <= 11; k++) {
    for (const lane of [3, 7, 11]) {
      sim.crates[idx(k, lane)] = 0;
      sim.crates[idx(lane, k)] = 0;
    }
  }
  for (const [x, y] of [[5, 3], [9, 3], [5, 11], [9, 11], [3, 5], [3, 9], [11, 5], [11, 9]]) sim.crates[idx(x, y)] = 1;
  for (const [x, y] of [[2, 7], [1, 7], [12, 7], [13, 7], [7, 2], [7, 1], [5, 5], [9, 5], [5, 9], [9, 9], [1, 5], [13, 9]]) sim.crates[idx(x, y)] = 0;
  const breaking = [[5, 3], [9, 3], [5, 11], [9, 11], [3, 5], [3, 9], [11, 5], [11, 9]];
  plant(sim, 'a', 4, [[7, 7], [7, 3], [7, 11], [3, 7], [11, 7]]);
  plant(sim, 'b', 2, [[1, 3]], 2100); // two more still ticking, elsewhere
  plant(sim, 'c', 2, [[13, 3]], 2300);
  sim.items.push(
    { i: idx(5, 5), k: 'b', born: 0 },
    { i: idx(9, 5), k: 'r', born: 0 },
    { i: idx(5, 9), k: 's', born: 0 },
    { i: idx(9, 9), k: 'k', born: 0 },
    { i: idx(1, 5), k: 'h', born: 0 },
    { i: idx(13, 9), k: 'p', born: 0 },
  );
  runTo(sim, 1000 + 118);
  emitBlast(fx, sim);
  for (const [x, y] of breaking) {
    fx.chips(x + 0.5, y + 0.5, 12, '#c79a5e');
    fx.chips(x + 0.5, y + 0.5, 4, '#3a404c');
    fx.smoke(x + 0.5, y + 0.5, 3, 0.26, '150,125,90');
  }
  const runners = [bomber(4.3, 5.5, 1, 0, { walk: 1.2 }), bomber(9.5, 8.55, 0, 1, { walk: 2.6 }), bomber(1.5, 9.35, 2, 2, { walk: 0.4 })];
  for (const r of runners) fx.dust(r.x, r.y + 0.35, 4);
  ageFx(fx, 0.07);
  const v = stage(W, H, 50, W / 2, 396, 7, 7);
  draw(ctx, v, sim, MAP_ACCENT.classic, runners, fx);
  scrimTop(ctx, W, H, 290);
  vignette(ctx, W, H, 0.55);
  const size = 112;
  label(ctx, 'BOMB MAZE', W / 2, 92, size, { spacing: 4, outline: 0.12 });
  label(ctx, 'BATTLE', W / 2, 196, size, { fill: ACCENT, spacing: 16, outline: 0.12 });
}

// ------------------------------------------------------------------ action
function action(ctx, W, H) {
  const crates = new Uint8Array(N);
  const sim = new Sim({ map: 'classic', seed: 5, roster: roster4, crates });
  const fx = new Fx(5);
  for (const [x, y] of [[7, 4], [7, 6], [5, 4], [9, 6], [3, 3], [11, 7], [5, 7], [9, 3]]) sim.crates[idx(x, y)] = 1;
  const a = sim.stats.get('a');
  a.b = 4;
  a.r = 3;
  const l = sim.placeBomb('a', 3, 5);
  const r = sim.placeBomb('a', 11, 5);
  l.at = 1000;
  r.at = 1000;
  runTo(sim, 1000 + 135);
  emitBlast(fx, sim);
  fx.sparks(7.5, 5.4, 26, '#ffd27a', 5.5, 0.5);
  fx.smoke(6.2, 5.5, 4, 0.35);
  fx.smoke(8.8, 5.5, 4, 0.35);
  ageFx(fx, 0.09);
  const v = stage(W, H, 124, W / 2, 420, 7, 5);
  const hero = bomber(7.5, 5.5, 2, 0, { moving: 0, scale: 1.12, initial: '' });
  draw(ctx, v, sim, MAP_ACCENT.classic, [hero], fx);
  vignette(ctx, W, H, 0.7);
  drawVignette(ctx, W, H, 0.38);
  ctx.fillStyle = 'rgba(255,200,120,0.1)';
  ctx.fillRect(0, 0, W, H);
}

// ------------------------------------------------------------------ win
function crown(ctx, cx, cy, r) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-r * 0.85, 0);
  ctx.lineTo(-r * 0.95, -r * 0.85);
  ctx.lineTo(-r * 0.4, -r * 0.4);
  ctx.lineTo(0, -r * 1.05);
  ctx.lineTo(r * 0.4, -r * 0.4);
  ctx.lineTo(r * 0.95, -r * 0.85);
  ctx.lineTo(r * 0.85, 0);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -r, 0, 0);
  g.addColorStop(0, '#fff0a0');
  g.addColorStop(1, '#f5a817');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#6a4300';
  ctx.lineWidth = Math.max(2, r * 0.12);
  ctx.stroke();
  ctx.fillStyle = '#ff4d6d';
  ctx.beginPath();
  ctx.arc(0, -r * 0.3, r * 0.14, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function win(ctx, W, H) {
  const sim = new Sim({ map: 'classic', seed: 9, roster: roster4, crates: new Uint8Array(N) });
  const fx = new Fx(9);
  sim.t = 4000;
  const S = 50;
  const v = stage(W, H, S, W / 2, 392, 7, 6);
  const hero = bomber(7.5, 6.5, 2, 0, { moving: 0, scale: 1.5, initial: '' });
  hero.ring = true;
  for (const [x, y, z, c] of [[3.2, 5, 3.6, '#ff4d6d'], [12.2, 4.6, 4.3, '#ffd23a'], [7.5, 2.6, 5.2, '#3ddcff'], [10.4, 6.2, 3.2, '#7dff6a'], [4.8, 7.4, 2.8, '#ff9a3a'], [1.6, 3.2, 3.1, '#d27bff']]) {
    fx.firework(x, y, z, c);
    fx.firework(x, y, z, '#ffffff');
  }
  fx.confetti(7.5, 6.5, 70, 5.5, 9);
  fx.confetti(7.5, 6.5, 40, 3.5, 6);
  ageFx(fx, 0.34);
  draw(ctx, v, sim, MAP_ACCENT.classic, [hero], fx, {
    afterGround: () => {
      const cx = v.ox + 7.5 * S;
      const cy = v.oy + 6.6 * S;
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 5);
      g.addColorStop(0, 'rgba(255,214,110,0.5)');
      g.addColorStop(1, 'rgba(255,214,110,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - S * 5, cy - S * 5, S * 10, S * 10);
      ctx.globalCompositeOperation = 'source-over';
    },
  });
  const hx = v.ox + 7.5 * S;
  const hy = v.oy + 6.5 * S + 0.36 * S - 0.86 * S * 1.5;
  crown(ctx, hx, hy - 0.3 * S * 1.5 * 0.82, S * 0.42);
  vignette(ctx, W, H, 0.5);
}

// ------------------------------------------------------------------ icon
function icon(ctx, W, H) {
  const g = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, W * 0.75);
  g.addColorStop(0, '#26314a');
  g.addColorStop(1, '#070a12');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // a blast cross behind: five tiles of fire each way, drawn by the game's own beams
  const S = 82;
  const v = stage(W, H, S, W / 2, H / 2 + 6, 7, 6);
  const sim = new Sim({ map: 'classic', seed: 3, roster: roster4, crates: new Uint8Array(N) });
  sim.t = 130;
  for (const [x, y] of [[7, 6], [6, 6], [5, 6], [8, 6], [9, 6], [7, 5], [7, 4], [7, 7], [7, 8]]) sim.fire.push({ i: idx(x, y), from: 20, cid: 1 });
  drawFire(ctx, v, sim, sim.t, new Uint8Array(N), NOW);
  drawFireLight(ctx, v, sim, sim.t);
  // the bomb
  const bv = { ox: 0, oy: 0, S: 255, quality: 2 };
  drawBomb(ctx, bv, { x: W / 2 / 255, y: (H / 2 + 6) / 255, phase: 0.55, c: 0, key: 4 }, NOW);
}

// ------------------------------------------------------------------ badges
function disc(ctx, W, a, b) {
  ctx.fillStyle = '#0a0d16';
  ctx.fillRect(0, 0, W, W);
  const g = ctx.createRadialGradient(W * 0.4, W * 0.32, W * 0.05, W / 2, W / 2, W * 0.5);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(W / 2, W / 2, W * 0.455, 0, TAU);
  ctx.fill();
  ctx.lineWidth = W * 0.03;
  ctx.strokeStyle = 'rgba(255,255,255,0.88)';
  ctx.stroke();
  ctx.lineWidth = W * 0.012;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.arc(W / 2, W / 2, W * 0.405, 0, TAU);
  ctx.stroke();
}

function star(ctx, cx, cy, r, fill) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r * 0.46 : r;
    ctx[i === 0 ? 'moveTo' : 'lineTo'](cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = r * 0.16;
  ctx.strokeStyle = '#3b1a8a';
  ctx.stroke();
  const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  g.addColorStop(0, '#fff3a8');
  g.addColorStop(1, fill);
  ctx.fillStyle = g;
  ctx.fill();
}

function badge(ctx, W, id) {
  const k = W / 256;
  ctx.save();
  ctx.scale(k, k);
  const w = 256;
  if (id === 'first-win') {
    disc(ctx, w, '#ffd34d', '#d98300');
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#5a3300';
    ctx.lineWidth = 9;
    // handles
    ctx.beginPath();
    ctx.arc(80, 104, 24, Math.PI * 0.5, Math.PI * 1.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(176, 104, 24, -Math.PI * 0.5, Math.PI * 0.5);
    ctx.stroke();
    // cup
    ctx.beginPath();
    ctx.moveTo(78, 70);
    ctx.lineTo(178, 70);
    ctx.quadraticCurveTo(176, 138, 128, 150);
    ctx.quadraticCurveTo(80, 138, 78, 70);
    ctx.closePath();
    const g = ctx.createLinearGradient(80, 70, 176, 150);
    g.addColorStop(0, '#fffbe6');
    g.addColorStop(1, '#ffd54a');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.stroke();
    // stem and base
    ctx.fillStyle = '#ffd54a';
    ctx.beginPath();
    ctx.rect(116, 150, 24, 26);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(92, 196);
    ctx.lineTo(164, 196);
    ctx.lineTo(156, 176);
    ctx.lineTo(100, 176);
    ctx.closePath();
    ctx.fillStyle = '#ffe27a';
    ctx.fill();
    ctx.stroke();
    star(ctx, 128, 108, 20, '#f59e0b');
  } else if (id === 'chain-reaction') {
    disc(ctx, w, '#ff7a3a', '#b8230a');
    // the link between two bombs
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.save();
    ctx.translate(128, 128);
    ctx.rotate(-0.62);
    for (const dx of [-18, 18]) {
      ctx.beginPath();
      ctx.rect(dx - 26, -13, 52, 26);
      ctx.stroke();
    }
    ctx.restore();
    const bv = { ox: 0, oy: 0, S: 120, quality: 2 };
    drawBomb(ctx, bv, { x: 80 / 120, y: 164 / 120, phase: 0.3, c: 1, key: 1 }, NOW);
    drawBomb(ctx, bv, { x: 176 / 120, y: 92 / 120, phase: 0.3, c: 3, key: 2 }, NOW);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(188, 60, 0, 188, 60, 26);
    g.addColorStop(0, 'rgba(255,255,230,0.95)');
    g.addColorStop(1, 'rgba(255,200,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(160, 32, 56, 56);
    ctx.globalCompositeOperation = 'source-over';
  } else if (id === 'triple-trap') {
    disc(ctx, w, '#8c6bff', '#3a1fb0');
    star(ctx, 128, 86, 40, '#f5b81c');
    star(ctx, 80, 154, 40, '#f5b81c');
    star(ctx, 176, 154, 40, '#f5b81c');
  } else {
    disc(ctx, w, '#2fe0c0', '#0b7a6c');
    // a plain helmet
    ctx.lineJoin = 'round';
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#102235';
    ctx.beginPath();
    ctx.moveTo(66, 150);
    ctx.bezierCurveTo(60, 84, 92, 54, 128, 54);
    ctx.bezierCurveTo(164, 54, 196, 84, 190, 150);
    ctx.lineTo(190, 176);
    ctx.quadraticCurveTo(190, 192, 172, 192);
    ctx.lineTo(84, 192);
    ctx.quadraticCurveTo(66, 192, 66, 176);
    ctx.closePath();
    const g = ctx.createLinearGradient(70, 54, 186, 192);
    g.addColorStop(0, '#f3f7ff');
    g.addColorStop(1, '#7d8ba6');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0a1018';
    ctx.beginPath();
    ctx.moveTo(84, 112);
    ctx.lineTo(172, 112);
    ctx.lineTo(166, 150);
    ctx.quadraticCurveTo(128, 160, 90, 150);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.moveTo(92, 118);
    ctx.lineTo(124, 118);
    ctx.lineTo(104, 146);
    ctx.lineTo(94, 144);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(121, 54, 14, 52);
  }
  ctx.restore();
}

const SIZES = { cover: [1280, 720], action: [1280, 720], win: [1280, 720], icon: [512, 512] };

/** Draws one poster and says so when it is on screen. */
export async function runPoster(name) {
  const canvas = document.getElementById('game');
  const badgeId = typeof name === 'string' && name.startsWith('badge-') ? name.slice(6) : null;
  const [W, H] = badgeId ? [256, 256] : (SIZES[name] ?? SIZES.cover);
  canvas.width = W;
  canvas.height = H;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext('2d', { alpha: false });
  try {
    await document.fonts.load(`800 60px ${FONT.split(',')[0]}`);
    await document.fonts.ready;
  } catch {
    // the fallback font draws
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (badgeId) badge(ctx, W, badgeId);
  else if (name === 'action') action(ctx, W, H);
  else if (name === 'win') win(ctx, W, H);
  else if (name === 'icon') icon(ctx, W, H);
  else cover(ctx, W, H);
  document.body.dataset.ready = '1';
}

