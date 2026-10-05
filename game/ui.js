// Screens and HUD, drawn on the canvas: flat dark panels with a thin accent edge, uppercase labels, big numerals. Tap targets register in
// `hits` while they're on screen (the page looks them up on a tap). Sizes scale with `u` (1 at 860 x 480); nothing is a sentence.

import { PLAYER_COLORS, MAP_LABEL, MAP_ACCENT, ITEM_NAMES, clamp, ordinal } from './rules.js';
import { label, chamfer, rr, drawGlyph, drawIcon, face, ITEM_COLORS } from './draw.js';
import { easeOutBack, easeOutCubic } from './fx.js';

const TAU = Math.PI * 2;
export const ACCENT = '#ffb42a'; // the game's own colour: hazard amber
const PANEL = 'rgba(8,11,19,0.84)';
const R = () => ({ x: 0, y: 0, w: 0, h: 0, on: false });
export const hits = { play: R(), wins: R(), map: R(), start: R() };

export function clearHits() {
  for (const k of Object.keys(hits)) hits[k].on = false;
}
export function setHit(h, x, y, w, hgt) {
  h.x = x;
  h.y = y;
  h.w = w;
  h.h = hgt;
  h.on = true;
}
export const inHit = (h, x, y) => h.on && x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h;

export const uiScale = (W, H) => clamp(Math.min(W / 800, H / 440), 0.8, 1.55);
const px = (n, u, min = 0) => Math.max(min, Math.round(n * u));

/** A flat dark panel with its corners cut and a thin accent line along the top. */
export function panel(ctx, x, y, w, h, accent = ACCENT, o = {}) {
  chamfer(ctx, x, y, w, h, o.cut ?? Math.min(10, h * 0.25));
  ctx.fillStyle = o.fill ?? PANEL;
  ctx.fill();
  ctx.strokeStyle = o.edge ?? 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.fillRect(x + (o.cut ?? Math.min(10, h * 0.25)), y, w - 2 * (o.cut ?? Math.min(10, h * 0.25)), Math.max(2, h * 0.05));
}

function hazardBar(ctx, x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = ACCENT;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#0b0e16';
  const s = h;
  for (let k = -h; k < w + h; k += s * 2) {
    ctx.beginPath();
    ctx.moveTo(x + k, y + h);
    ctx.lineTo(x + k + s, y + h);
    ctx.lineTo(x + k + s + h, y);
    ctx.lineTo(x + k + h, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ title
export function drawTitle(ctx, W, H, u, now, touch = false) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(4,6,12,0.82)');
  g.addColorStop(0.5, 'rgba(4,6,12,0.5)');
  g.addColorStop(1, 'rgba(4,6,12,0.82)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2;
  const compact = H < 360;
  const big = Math.min(px(86, u), W / 7.2);
  const y1 = H * (compact ? 0.22 : 0.27);
  const y2 = y1 + big * 0.92;
  label(ctx, 'BOMB MAZE', cx, y1, big, { spacing: big * 0.04, outline: 0.14 });
  label(ctx, 'BATTLE', cx, y2, big, { fill: ACCENT, spacing: big * 0.14, outline: 0.14 });
  const bh = Math.max(5, big * 0.1);
  const wBar = Math.max(10, Math.min(W / 2 - big * 2.45 - 12, big * 2.3));
  hazardBar(ctx, cx - wBar - big * 2.45, y2 - bh / 2, wBar, bh);
  hazardBar(ctx, cx + big * 2.45, y2 - bh / 2, wBar, bh);
  // the one button
  const bw = px(270, u, 200);
  const bhh = px(78, u, 62);
  const bx = cx - bw / 2;
  const by = H * (compact ? 0.66 : 0.7) - bhh / 2;
  const pulse = 1 + 0.025 * Math.sin(now * 4);
  ctx.save();
  ctx.translate(cx, by + bhh / 2);
  ctx.scale(pulse, pulse);
  chamfer(ctx, -bw / 2, -bhh / 2, bw, bhh, 14);
  const bg = ctx.createLinearGradient(0, -bhh / 2, 0, bhh / 2);
  bg.addColorStop(0, '#ffcb4a');
  bg.addColorStop(1, '#ff8a1a');
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#fff2c4';
  ctx.stroke();
  label(ctx, 'PLAY', 0, 2, Math.min(px(42, u, 28), bhh * 0.62), { fill: '#161008', outline: 0, spacing: 3 });
  ctx.restore();
  setHit(hits.play, bx, by, bw, bhh);
  if (!touch) label(ctx, 'ENTER', cx, by + bhh + px(22, u, 14), px(14, u, 12), { fill: 'rgba(255,255,255,0.55)', outline: 0.1, weight: 700, spacing: 2 });
}

// ------------------------------------------------------------------ lobby
/** The settings across the top, as big values; the host can tap them. */
export function drawLobbyTop(ctx, W, H, u, st, now) {
  const hgt = px(52, u, 44);
  const cw = px(176, u, 128);
  const gap = px(10, u, 8);
  const y = px(8, u, 6);
  const hint = 'TRAP THEM IN YOUR BLASTS';
  const hs = px(17, u, 14);
  ctx.font = `700 ${hs}px sans-serif`;
  const hintW = hint.length * hs * 0.62;
  const sideHint = W >= 2 * cw + gap + hintW + 2 * px(150, u, 130);
  const total = 2 * cw + gap;
  const x0 = Math.round((W - total) / 2);
  const chips = [
    { key: 'wins', cap: 'WINS', val: String(st.wins), hit: hits.wins },
    { key: 'map', cap: 'ARENA', val: MAP_LABEL[st.map] ?? 'CLASSIC', hit: hits.map },
  ];
  chips.forEach((c, i) => {
    const x = x0 + i * (cw + gap);
    panel(ctx, x, y, cw, hgt, st.editable ? ACCENT : 'rgba(255,255,255,0.35)', { cut: 8 });
    label(ctx, c.cap, x + px(12, u, 9), y + hgt * 0.3, px(12, u, 11), { align: 'left', fill: 'rgba(255,255,255,0.6)', outline: 0, weight: 700, spacing: 2 });
    label(ctx, c.val, x + px(12, u, 9), y + hgt * 0.69, Math.min(px(26, u, 18), (cw - px(40, u, 30)) / Math.max(4, c.val.length) * 1.55), { align: 'left', outline: 0.12 });
    if (st.editable) {
      // a cycle mark at the right edge: this one can be changed
      const ax = x + cw - px(18, u, 14);
      const ay = y + hgt / 2;
      const r = px(8, u, 6);
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.moveTo(ax - r * 0.5, ay - r * 1.0);
      ctx.lineTo(ax + r * 0.9, ay);
      ctx.lineTo(ax - r * 0.5, ay + r * 1.0);
      ctx.closePath();
      ctx.fill();
      setHit(c.hit, x, y, cw, hgt);
    }
  });
  if (sideHint) label(ctx, hint, x0 + total + px(18, u, 12), y + hgt / 2, hs, { align: 'left', weight: 700, fill: 'rgba(255,255,255,0.88)', spacing: 1 });
  else label(ctx, hint, W / 2, y + hgt + px(18, u, 14), hs, { weight: 700, fill: 'rgba(255,255,255,0.88)', spacing: 1 });
  void now;
  return y + hgt;
}

/** A tap target for a stand-alone page that has no platform strip to start the match. */
export function drawStart(ctx, W, H, u, now) {
  const bw = px(210, u, 150);
  const bh = px(56, u, 46);
  const x = W - bw - px(16, u, 10);
  const y = H - bh - px(20, u, 14);
  chamfer(ctx, x, y, bw, bh, 10);
  ctx.fillStyle = ACCENT;
  ctx.fill();
  label(ctx, 'START', x + bw / 2, y + bh / 2 + 1, px(26, u, 18), { fill: '#161008', outline: 0, spacing: 2 });
  setHit(hits.start, x, y, bw, bh);
  void now;
}

// ------------------------------------------------------------------ countdown, banners and callouts
export function drawCountdown(ctx, W, H, u, what, age, reduced) {
  const k = clamp(age, 0, 1);
  const s = reduced ? 1 : easeOutBack(clamp(k * 3, 0, 1));
  const size = px(what === 'GO!' ? 150 : 190, u, 80) * (0.6 + 0.4 * s);
  const a = what === 'GO!' ? 1 - clamp((k - 0.5) / 0.5, 0, 1) : 1;
  ctx.globalAlpha = a;
  label(ctx, String(what), W / 2, H * 0.44, size, { fill: what === 'GO!' ? ACCENT : '#ffffff', outline: 0.12, spacing: 2 });
  ctx.globalAlpha = 1;
}

/** "ROUND 2 / LAST ONE STANDING": a band that slides in, holds and slides out. `age` and `total` in seconds. */
export function drawBanner(ctx, W, H, u, title, sub, age, total, reduced) {
  const inT = 0.28;
  const outT = 0.36;
  let k = 1;
  if (age < inT) k = easeOutCubic(age / inT);
  else if (age > total - outT) k = 1 - easeOutCubic((age - (total - outT)) / outT);
  k = clamp(k, 0, 1);
  const bandH = px(112, u, 80);
  const y = H * 0.4 - bandH / 2;
  const off = reduced ? 0 : (1 - k) * W * 0.5;
  ctx.globalAlpha = clamp(k * 1.4, 0, 1);
  ctx.fillStyle = 'rgba(6,9,16,0.86)';
  ctx.fillRect(0, y, W, bandH);
  hazardBar(ctx, 0, y - px(8, u, 6), W, px(8, u, 6));
  hazardBar(ctx, 0, y + bandH, W, px(8, u, 6));
  label(ctx, sub, W / 2 - off, y + bandH * 0.27, px(20, u, 15), { fill: ACCENT, outline: 0, weight: 800, spacing: 4 });
  label(ctx, title, W / 2 + off, y + bandH * 0.62, Math.min(px(54, u, 28), W / 11), { outline: 0.1, spacing: 2 });
  ctx.globalAlpha = 1;
}

/** A big word over the arena: ELIMINATED, DRAW, a winner's name. */
export function drawCallout(ctx, W, H, u, text, sub, age, color = '#ffffff', reduced = false) {
  const k = clamp(age / 0.35, 0, 1);
  const s = reduced ? 1 : easeOutBack(k);
  const a = clamp(1 - (age - 1.4) / 0.4, 0, 1);
  if (a <= 0) return;
  ctx.globalAlpha = a;
  const size = Math.min(px(70, u, 34), W / 9) * (0.55 + 0.45 * s);
  const y = H * 0.4;
  ctx.fillStyle = 'rgba(6,9,16,0.7)';
  ctx.fillRect(0, y - size * 0.75, W, size * 1.5 + (sub ? px(26, u, 20) : 0));
  label(ctx, text, W / 2, y, size, { fill: color, outline: 0.1, spacing: 3 });
  if (sub) label(ctx, sub, W / 2, y + size * 0.72, px(22, u, 16), { fill: 'rgba(255,255,255,0.85)', outline: 0, weight: 700, spacing: 3 });
  ctx.globalAlpha = 1;
}

export function drawWatching(ctx, W, H, u, y, text = 'WATCHING') {
  const w = px(150, u, 110);
  const h = px(30, u, 26);
  panel(ctx, (W - w) / 2, y, w, h, 'rgba(255,255,255,0.4)', { cut: 6 });
  label(ctx, text, W / 2, y + h / 2 + 1, px(16, u, 13), { outline: 0, weight: 800, spacing: 3 });
}

export function drawTapHint(ctx, W, H, u, now) {
  const a = 0.6 + 0.4 * Math.sin(now * 5);
  ctx.globalAlpha = a;
  label(ctx, 'TAP TO PLAY', W / 2, H * 0.3, px(30, u, 20), { spacing: 3 });
  ctx.globalAlpha = 1;
}

export function drawFlash(ctx, W, H, a, rgb) {
  if (a <= 0.01) return;
  ctx.fillStyle = `rgba(${rgb},${clamp(a, 0, 1) * 0.5})`;
  ctx.fillRect(0, 0, W, H);
}

/** A red edge when your life is on the line (a sudden-death tile under you, a blast on its way). */
export function drawVignette(ctx, W, H, a) {
  if (a <= 0.02) return;
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(255,40,30,0)');
  g.addColorStop(1, `rgba(255,40,30,${clamp(a, 0, 1) * 0.55})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// ------------------------------------------------------------------ the HUD
function pips(ctx, x, y, n, need, c, u) {
  const r = px(4.2, u, 3);
  for (let i = 0; i < need; i++) {
    const on = i < n;
    ctx.beginPath();
    ctx.arc(x + i * r * 2.7 + r, y, r, 0, TAU);
    ctx.fillStyle = on ? c : 'rgba(255,255,255,0.12)';
    ctx.fill();
    if (on) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

/** One player's chip: face, a colour and a shape, their wins as pips; dimmed and crossed once they are out. */
export function playerChip(ctx, x, y, w, hgt, p, need, u, now, o = {}) {
  const col = PLAYER_COLORS[p.c % PLAYER_COLORS.length];
  ctx.globalAlpha = p.out ? 0.5 : 1;
  panel(ctx, x, y, w, hgt, p.you ? '#ffffff' : col.main, { cut: 6, fill: p.you ? 'rgba(18,24,38,0.9)' : PANEL });
  ctx.fillStyle = col.main;
  ctx.fillRect(x, y + hgt * 0.12, Math.max(3, px(4, u)), hgt * 0.76);
  const r = hgt * 0.34;
  const fx = x + px(18, u, 14) + r * 0.2;
  face(ctx, p.head, fx + r * 0.4, y + hgt / 2, r, p.initial || '?', col);
  ctx.strokeStyle = col.main;
  ctx.lineWidth = Math.max(1.5, px(2.2, u));
  ctx.beginPath();
  ctx.arc(fx + r * 0.4, y + hgt / 2, r, 0, TAU);
  ctx.stroke();
  const tx = fx + r * 1.4 + px(7, u, 5);
  const room = x + w - tx - px(26, u, 20);
  if (!o.noName) {
    ctx.font = `700 ${px(14, u, 12)}px sans-serif`;
    label(ctx, fitName(p.name, room, px(14, u, 12)), tx, y + hgt * 0.34, px(14, u, 12), { align: 'left', weight: 700, outline: 0.12, fill: '#f2f5fb' });
    pips(ctx, tx, y + hgt * 0.74, p.wins, need, col.main, u);
  } else pips(ctx, tx - px(2, u), y + hgt * 0.5, p.wins, need, col.main, u);
  drawGlyph(ctx, col.shape, x + w - px(14, u, 12), y + hgt / 2, px(5.6, u, 4.5), col.main);
  if (p.out) {
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#ff4a4a';
    ctx.lineWidth = Math.max(2, px(3, u));
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(fx + r * 0.4 - r * 0.7, y + hgt / 2 - r * 0.7);
    ctx.lineTo(fx + r * 0.4 + r * 0.7, y + hgt / 2 + r * 0.7);
    ctx.moveTo(fx + r * 0.4 + r * 0.7, y + hgt / 2 - r * 0.7);
    ctx.lineTo(fx + r * 0.4 - r * 0.7, y + hgt / 2 + r * 0.7);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  void now;
}

function fitName(name, room, size) {
  const max = Math.max(3, Math.floor(room / (size * 0.58)));
  const s = String(name ?? '');
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;
}

/**
 * The slim top bar. `h`: { round, clock (ms until sudden death, or <0 once it has started), warn (a flash for the last seconds),
 * players: [{ c, name, head, initial, wins, out, you }], need, mine: { b, r, s, k, p, h } or null, board: { ox, S } }.
 * Returns the y just under the bar.
 */
export function drawHud(ctx, W, H, u, h, now) {
  const top = px(8, u, 6);
  const cw = px(160, u, 118);
  const ch = px(48, u, 40);
  const n = h.players.length;
  const chipW = px(150, u, 118);
  const chipH = px(42, u, 34);
  const gap = px(6, u, 4);
  const sides = h.board.ox >= chipW + px(20, u, 14);
  // the clock, top centre (kept clear of the platform's buttons in the top-left corner)
  const clockX = Math.max((W - cw) / 2, Math.min(136, W - cw - 6));
  const sd = h.clock < 0;
  const secs = Math.max(0, Math.ceil(h.clock / 1000));
  const mm = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, '0');
  const urgent = !sd && secs <= 10;
  const flash = sd || urgent ? 0.5 + 0.5 * Math.sin(now * (sd ? 7 : 9)) : 0;
  panel(ctx, clockX, top, cw, ch, sd ? '#ff4a3a' : urgent ? '#ff8a3a' : ACCENT, { cut: 9, fill: sd ? `rgba(60,10,10,${0.84 + 0.1 * flash})` : PANEL });
  label(ctx, `ROUND ${h.round}`, clockX + cw / 2, top + ch * 0.25, px(12, u, 11), { fill: 'rgba(255,255,255,0.6)', outline: 0, weight: 700, spacing: 3 });
  if (sd) label(ctx, 'SUDDEN DEATH', clockX + cw / 2, top + ch * 0.64, px(17, u, 13), { fill: '#ff6a5a', outline: 0.1, spacing: 1 });
  else label(ctx, `${mm}:${ss}`, clockX + cw / 2, top + ch * 0.64, px(27, u, 20), { fill: urgent ? '#ffb070' : '#ffffff', outline: 0.12, spacing: 1 });
  // the table
  let rowBottom = top + ch;
  if (sides) {
    const perCol = Math.min(4, Math.ceil(n / 2) || 1);
    const y0 = px(66, u, 58);
    h.players.forEach((p, i) => {
      const right = n <= 4 ? false : i >= perCol;
      const row = right ? i - perCol : i;
      const x = right ? W - chipW - px(12, u, 8) : px(12, u, 8);
      playerChip(ctx, x, y0 + row * (chipH + gap), chipW, chipH, p, h.need, u, now);
    });
  } else {
    const w = Math.min(px(66, u, 52), (W - 12 - (n - 1) * gap) / Math.max(1, n));
    const total = n * w + (n - 1) * gap;
    const x0 = (W - total) / 2;
    const y = top + ch + px(8, u, 6);
    h.players.forEach((p, i) => playerChip(ctx, x0 + i * (w + gap), y, w, chipH, p, h.need, u, now, { noName: true }));
    rowBottom = y + chipH;
  }
  // your own power-ups: top right, or under the table when the top is shared
  let bottom = rowBottom;
  if (h.mine) {
    const m = h.mine;
    const items = [
      ['b', m.b, true],
      ['r', m.r, true],
      ['s', m.s, m.s > 0],
      ['k', 1, m.k > 0],
      ['p', 1, m.p > 0],
      ['h', 1, m.h > 0],
    ].filter((e) => e[2]);
    const iw = px(52, u, 42);
    const pw = items.length * iw + px(10, u, 8);
    const ph = px(40, u, 34);
    const x = sides ? W - pw - px(12, u, 8) : (W - pw) / 2;
    const y = sides ? top : rowBottom + px(6, u, 4);
    panel(ctx, x, y, pw, ph, '#ffffff', { cut: 7 });
    items.forEach(([k, v], i) => {
      const cx = x + px(5, u, 4) + i * iw + px(14, u, 12);
      drawIcon(ctx, k, cx, y + ph / 2 + 1, px(11, u, 9), ITEM_COLORS[k]);
      if (k === 'b' || k === 'r' || k === 's') label(ctx, `${v}`, cx + px(20, u, 15), y + ph / 2 + 1, px(17, u, 13), { outline: 0.12, weight: 800 });
    });
    bottom = Math.max(bottom, y + ph);
  }
  return bottom;
}

// ------------------------------------------------------------------ between rounds
/** The result of a round: who won it, and everyone's wins as pips (the new one pops in). */
export function drawScore(ctx, W, H, u, s, now) {
  const n = s.rows.length;
  const rowH = px(40, u, 30);
  const pw = Math.min(W - 24, px(380, u, 280));
  const head = px(74, u, 56);
  const ph = head + n * rowH + px(14, u, 10);
  const x = (W - pw) / 2;
  const y = Math.max(px(66, u, 58), (H - ph) / 2 - px(10, u));
  panel(ctx, x, y, pw, ph, ACCENT);
  label(ctx, `ROUND ${s.round}`, x + pw / 2, y + head * 0.24, px(14, u, 12), { fill: 'rgba(255,255,255,0.6)', outline: 0, weight: 700, spacing: 3 });
  const title = s.winner ? `${s.winner.name} WINS` : 'DRAW';
  label(ctx, title, x + pw / 2, y + head * 0.64, Math.min(px(32, u, 20), pw / Math.max(6, title.length) * 1.5), { fill: s.winner ? PLAYER_COLORS[s.winner.c % 8].main : '#ffffff', outline: 0.12, spacing: 1 });
  const pop = clamp(s.age / 0.5, 0, 1);
  s.rows.forEach((p, i) => {
    const ry = y + head + i * rowH;
    const col = PLAYER_COLORS[p.c % 8];
    ctx.fillStyle = p.you ? 'rgba(255,255,255,0.09)' : i % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0)';
    ctx.fillRect(x + 6, ry, pw - 12, rowH - 2);
    const r = rowH * 0.36;
    face(ctx, p.head, x + px(30, u, 24), ry + rowH / 2, r, p.initial || '?', col);
    ctx.strokeStyle = col.main;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + px(30, u, 24), ry + rowH / 2, r, 0, TAU);
    ctx.stroke();
    drawGlyph(ctx, col.shape, x + px(58, u, 46), ry + rowH / 2, px(5, u, 4), col.main);
    label(ctx, fitName(p.name, pw * 0.4, px(16, u, 12)), x + px(72, u, 58), ry + rowH / 2, px(16, u, 12), { align: 'left', weight: 700, outline: 0.12 });
    const px0 = x + pw - px(18, u, 12) - s.need * px(21, u, 16);
    const r2 = px(7, u, 5.5);
    for (let k = 0; k < s.need; k++) {
      const filled = k < p.wins;
      const fresh = p.fresh && k === p.wins - 1;
      const sc = fresh ? 0.4 + 0.9 * easeOutBack(pop) : 1;
      ctx.beginPath();
      ctx.arc(px0 + k * px(21, u, 16) + r2, ry + rowH / 2, r2 * (filled ? sc : 1), 0, TAU);
      ctx.fillStyle = filled ? col.main : 'rgba(255,255,255,0.12)';
      ctx.fill();
      if (filled) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
  });
  void now;
}

// ------------------------------------------------------------------ the end of a match
/** Podium: the top three on blocks, "YOU: 5TH" if lower, and two awards. `s`: { rows: [{ c, name, head, initial, wins, place, you }], you, awards, age }. */
export function drawPodium(ctx, W, H, u, s, now, reduced) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0b1020');
  g.addColorStop(1, '#1c1430');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // light rays from behind the winner
  const cx = W / 2;
  const ap = px(34, u, 28);
  const floor = H - px(10, u, 8) - ap - px(34, u, 26);
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = ACCENT;
  for (let k = 0; k < 12; k++) {
    const a = (reduced ? 0 : now * 0.15) + (k * TAU) / 12;
    ctx.beginPath();
    ctx.moveTo(cx, floor - H * 0.3);
    ctx.lineTo(cx + Math.cos(a) * W, floor - H * 0.3 + Math.sin(a) * W);
    ctx.lineTo(cx + Math.cos(a + 0.12) * W, floor - H * 0.3 + Math.sin(a + 0.12) * W);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  label(ctx, 'RESULTS', cx, px(30, u, 22) + px(6, u), px(26, u, 18), { fill: ACCENT, outline: 0, spacing: 6 });
  const top3 = s.rows.slice(0, 3);
  const order = [1, 0, 2];
  const bw = Math.min(px(150, u, 96), W / 3.6);
  const heights = [px(150, u, 100), px(108, u, 74), px(78, u, 54)];
  const grow = clamp(s.age / 0.7, 0, 1);
  order.forEach((ri, slot) => {
    const p = top3[ri];
    if (!p) return;
    const col = PLAYER_COLORS[p.c % 8];
    const x = cx + (slot - 1) * (bw + px(10, u, 6)) - bw / 2;
    const bh = heights[ri] * easeOutCubic(clamp(grow * 1.4 - ri * 0.2, 0, 1));
    const y = floor - bh;
    ctx.fillStyle = PANEL;
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = col.main;
    ctx.fillRect(x, y, bw, Math.max(3, px(5, u)));
    label(ctx, ordinal(p.place), x + bw / 2, y + bh * 0.42, Math.min(px(36, u, 22), bh * 0.5), { fill: ri === 0 ? ACCENT : '#ffffff', outline: 0.1 });
    const r = Math.min(px(30, u, 22), bw * 0.24);
    const hy = y - r - px(8, u, 6) - (ri === 0 && !reduced ? Math.abs(Math.sin(now * 3)) * px(6, u) : 0);
    face(ctx, p.head, x + bw / 2, hy, r, p.initial || '?', col);
    ctx.strokeStyle = ri === 0 ? ACCENT : col.main;
    ctx.lineWidth = Math.max(2, px(3, u));
    ctx.beginPath();
    ctx.arc(x + bw / 2, hy, r, 0, TAU);
    ctx.stroke();
    label(ctx, fitName(p.name, bw, px(16, u, 12)), x + bw / 2, hy - r - px(14, u, 12), px(16, u, 12), { weight: 700, outline: 0.14 });
    if (p.you) label(ctx, 'YOU', x + bw / 2, hy - r - px(32, u, 25), px(12, u, 10), { fill: ACCENT, outline: 0.1, weight: 800, spacing: 3 });
    if (ri === 0) {
      // a crown
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      const cy = hy - r - px(2, u);
      ctx.moveTo(x + bw / 2 - r * 0.7, cy);
      ctx.lineTo(x + bw / 2 - r * 0.8, cy - r * 0.6);
      ctx.lineTo(x + bw / 2 - r * 0.3, cy - r * 0.25);
      ctx.lineTo(x + bw / 2, cy - r * 0.75);
      ctx.lineTo(x + bw / 2 + r * 0.3, cy - r * 0.25);
      ctx.lineTo(x + bw / 2 + r * 0.8, cy - r * 0.6);
      ctx.lineTo(x + bw / 2 + r * 0.7, cy);
      ctx.closePath();
      ctx.fill();
    }
    label(ctx, `${p.wins}`, x + bw / 2, y + bh - px(16, u, 12), px(18, u, 13), { fill: 'rgba(255,255,255,0.7)', outline: 0, weight: 800 });
  });
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(0, floor, W, 2);
  // you, if you are not up there
  const me = s.rows.find((r) => r.you);
  if (me && me.place > 3) label(ctx, `YOU: ${ordinal(me.place).toUpperCase()}`, cx, floor + px(20, u, 16), px(24, u, 17), { fill: '#ffffff', spacing: 2 });
  // awards
  const aw = [];
  if (s.awards?.kos) aw.push({ cap: 'MOST KOS', who: s.awards.kos });
  if (s.awards?.chain) aw.push({ cap: 'BIGGEST CHAIN', who: s.awards.chain });
  const aww = px(180, u, 130);
  aw.forEach((a, i) => {
    const x = cx - (aw.length * aww + (aw.length - 1) * px(10, u, 6)) / 2 + i * (aww + px(10, u, 6));
    const y = H - px(10, u, 8) - ap;
    panel(ctx, x, y, aww, ap, ACCENT, { cut: 6 });
    label(ctx, a.cap, x + px(10, u, 8), y + px(11, u, 9), px(10, u, 9), { align: 'left', fill: 'rgba(255,255,255,0.6)', outline: 0, weight: 700, spacing: 2 });
    label(ctx, fitName(a.who, aww - px(16, u, 12), px(14, u, 12)), x + px(10, u, 8), y + px(25, u, 20), px(14, u, 12), { align: 'left', weight: 800, outline: 0.1 });
  });
}

/** The results card that stays over the lobby for a few seconds after a match. */
export function drawResultsCard(ctx, W, H, u, s) {
  const rows = s.rows.slice(0, 3);
  const w = Math.min(W - 24, px(300, u, 230));
  const rowH = px(34, u, 28);
  const h = px(40, u, 32) + rows.length * rowH + (s.you && s.you.place > 3 ? px(30, u, 24) : 0);
  const x = (W - w) / 2;
  const y = H - px(104, u, 98) - h;
  panel(ctx, x, Math.max(px(70, u, 62), y), w, h, ACCENT);
  const yy = Math.max(px(70, u, 62), y);
  label(ctx, 'RESULTS', x + w / 2, yy + px(20, u, 15), px(14, u, 12), { fill: ACCENT, outline: 0, weight: 800, spacing: 4 });
  rows.forEach((p, i) => {
    const col = PLAYER_COLORS[p.c % 8];
    const ry = yy + px(36, u, 28) + i * rowH;
    label(ctx, ordinal(p.place), x + px(14, u, 10), ry + rowH / 2, px(16, u, 12), { align: 'left', fill: i === 0 ? ACCENT : '#fff', outline: 0.1 });
    face(ctx, p.head, x + px(76, u, 62), ry + rowH / 2, rowH * 0.36, p.initial || '?', col);
    label(ctx, fitName(p.name, w * 0.45, px(16, u, 12)), x + px(98, u, 80), ry + rowH / 2, px(16, u, 12), { align: 'left', weight: 700, outline: 0.12 });
    label(ctx, `${p.wins}`, x + w - px(16, u, 12), ry + rowH / 2, px(18, u, 13), { align: 'right', weight: 800, outline: 0.1 });
  });
  if (s.you && s.you.place > 3) label(ctx, `YOU: ${ordinal(s.you.place).toUpperCase()}`, x + w / 2, yy + h - px(16, u, 12), px(16, u, 12), { spacing: 2 });
}

/** A short word near a bomber for what it just picked up. */
export function pickupText(kind) {
  return ITEM_NAMES[kind] ?? '';
}

export { MAP_ACCENT };
