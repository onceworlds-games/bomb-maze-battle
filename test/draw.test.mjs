// The renderer's corners: every bomber pose and state, every power-up, blasts of every shape, falling pillars, outlines of what is about to
// drop, kicked bombs, at several sizes and graphics settings. Nothing may be a bad number, and every save has its restore.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fakedom.mjs';
import { COLS, ROWS, N, idx, ITEM_KINDS, BLAST_MS, SD_AT_MS } from '../game/rules.js';
import { Sim } from '../game/sim.js';
import { computeDanger, makeDanger } from '../game/bots.js';
import { makeView, layoutBoard, drawGround, drawStanding, drawFireLight, drawTag, drawIcon, drawGlyph, label } from '../game/draw.js';
import * as ui from '../game/ui.js';

const dom = installFakeDom({ width: 900, height: 500 });
const ctx = dom.ctx;

function scene(S, quality, t) {
  const v = makeView();
  v.pr = 2;
  v.quality = quality;
  layoutBoard(v, 900, 500, 60, 20);
  const sim = new Sim({ map: ['classic', 'cross', 'rings'][S % 3], seed: S, roster: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] });
  sim.t = t;
  sim.dropDone = sim.dropCount(t);
  sim.stats.get('a').b = 6;
  sim.stats.get('a').k = 1;
  ITEM_KINDS.forEach((k, i) => sim.items.push({ i: idx(1 + i * 2, 3), k, born: 0 }));
  for (let i = 0; i < 5; i++) sim.fire.push({ i: idx(3 + i, 5), from: t - 40 - i * 90, cid: 1 });
  for (let i = 0; i < 4; i++) sim.fire.push({ i: idx(7, 4 + i), from: t - 200, cid: 2 });
  const b1 = sim.bombs.push({ id: 1, x: 5, y: 7, o: 'a', at: t + 2300, r: 2, p: 0, dx: 0, dy: 0, pr: 0 });
  sim.bombs.push({ id: 2, x: 7, y: 7, o: 'b', at: t + 400, r: 2, p: 0, dx: 1, dy: 0, pr: 0.5 });
  sim.bombs.push({ id: 3, x: 9, y: 9, o: 'c', at: t + 40, r: 2, p: 1, dx: 0, dy: 0, pr: 0 });
  assert.ok(b1 > 0);
  const bombs = sim.bombs.map((b) => ({ x: b.x + 0.5 + b.dx * b.pr, y: b.y + 0.5, phase: 1 - (b.at - t) / 2400, c: 'abcd'.indexOf(b.o), key: b.id }));
  const bombers = [];
  [0, 1, 2, 3].forEach((dir) => {
    for (const [i, o] of [{ moving: 0 }, { moving: 1, shield: true }, { moving: 1, blink: true, ring: true, arrow: true }, { moving: 0, ready: true, alpha: 0.5, scale: 1.4 }].entries()) {
      bombers.push({ x: 2.5 + dir * 3, y: 2.5 + i * 2.2, dir, moving: o.moving, walk: 1.3 + dir, c: (dir + i) % 8, head: null, initial: i % 2 ? 'Q' : '', alpha: o.alpha ?? 1, blink: Boolean(o.blink), shield: Boolean(o.shield), scale: o.scale ?? 1, ring: Boolean(o.ring), name: i ? 'A longish name' : '', arrow: Boolean(o.arrow), ready: Boolean(o.ready) });
    }
  });
  return { v, sim, bombs, bombers };
}

test('every pose, power-up, blast and falling pillar draws cleanly at every size and quality', () => {
  const scratch = { fire: new Uint8Array(N), warn: [] };
  for (const [w, h] of [[900, 500], [360, 640], [1920, 1080], [320, 200]]) {
    dom.resize?.(w, h);
    for (const quality of [0, 1, 2]) {
      for (const t of [1000, SD_AT_MS - 300, SD_AT_MS + 200, SD_AT_MS + 40000]) {
        const { v, sim, bombs, bombers } = scene(Math.floor(t / 1000) + quality, quality, t);
        layoutBoard(v, w, h, 60, 20);
        const danger = makeDanger();
        computeDanger(sim, null, danger);
        const sc = { field: sim, t, accent: '#33e6ff', danger: danger.start, pads: [{ x: 1.5, y: 1.5, c: 0 }, { x: 13.5, y: 11.5, c: 3 }] };
        drawGround(ctx, v, sc, 3.1, scratch);
        drawStanding(ctx, v, sc, bombs, bombs.length, bombers, bombers.length, 3.1);
        drawFireLight(ctx, v, sim, t);
        for (const b of bombers) drawTag(ctx, v, b, 3.1);
        // a fresh view with no sprites to build from: the flat fallback
        const flat = makeView();
        layoutBoard(flat, w, h, 60, 20);
        flat.sprites = { key: 'x', accent: '#fff', floor: null, pillar: null, crates: [], walls: new Map() };
        flat.sprites.walls.set(0, null);
        drawStanding(ctx, flat, sc, bombs, 1, bombers, 2, 3.1);
      }
    }
  }
  assert.deepEqual(dom.problems, []);
  assert.ok(dom.stats.drawImages > 1000);
});

test('the UI pieces: every screen at awkward sizes, with long names, no faces, five wins, eight players', () => {
  const players = Array.from({ length: 8 }, (_, i) => ({ c: i, name: i % 2 ? 'Averyveryverylongname' : 'Bo', head: null, initial: i % 3 ? 'Z' : '', wins: i % 6, out: i % 3 === 0, you: i === 2 }));
  const rows = players.map((p, i) => ({ ...p, place: i + 1, fresh: i === 1 }));
  for (const [w, h] of [[360, 640], [640, 360], [844, 390], [1280, 720], [1920, 1080], [200, 150]]) {
    const u = ui.uiScale(w, h);
    ui.clearHits();
    ui.drawTitle(ctx, w, h, u, 1.2, false);
    ui.drawTitle(ctx, w, h, u, 1.2, true);
    ui.drawLobbyTop(ctx, w, h, u, { wins: 5, map: 'cross', editable: true }, 1);
    ui.drawLobbyTop(ctx, w, h, u, { wins: 2, map: 'rings', editable: false }, 1);
    ui.drawStart(ctx, w, h, u, 1);
    for (const what of [3, 2, 1, 'GO!']) for (const age of [0, 0.4, 1, 2]) ui.drawCountdown(ctx, w, h, u, what, age, false);
    for (const age of [0, 0.1, 1.2, 2.5, 2.7]) ui.drawBanner(ctx, w, h, u, 'LAST ONE STANDING', 'ROUND 12', age, 2.6, age > 1);
    for (const age of [0, 0.2, 1, 1.6, 2]) ui.drawCallout(ctx, w, h, u, 'A VERY LONG CALLOUT NAME WINS', 'ROUND 3', age, '#fff', age > 1);
    ui.drawWatching(ctx, w, h, u, 70);
    ui.drawWatching(ctx, w, h, u, 70, 'OUT');
    ui.drawTapHint(ctx, w, h, u, 1);
    ui.drawFlash(ctx, w, h, 0.7, '255,60,40');
    ui.drawFlash(ctx, w, h, 0, '255,60,40');
    ui.drawVignette(ctx, w, h, 0.6);
    for (const n of [1, 4, 5, 8]) for (const ox of [10, 120, 300]) {
      for (const clock of [90000, 9000, 0, -1]) ui.drawHud(ctx, w, h, u, { round: 3, clock, players: players.slice(0, n), need: 5, mine: { b: 6, r: 8, s: 3, k: 1, p: 1, h: 1 }, board: { ox } }, 2);
      ui.drawHud(ctx, w, h, u, { round: 3, clock: 5000, players: players.slice(0, n), need: 3, mine: null, board: { ox } }, 2);
    }
    ui.drawScore(ctx, w, h, u, { rows, need: 5, round: 4, winner: { name: 'AVERYVERYVERYLONGNAME', c: 1 }, age: 0.2 }, 1);
    ui.drawScore(ctx, w, h, u, { rows: rows.slice(0, 2), need: 2, round: 1, winner: null, age: 3 }, 1);
    for (const age of [0, 0.3, 1, 8]) ui.drawPodium(ctx, w, h, u, { rows, awards: { kos: 'Bo', chain: 'Averyveryverylongname' }, age }, 1, age > 0.5);
    ui.drawPodium(ctx, w, h, u, { rows: rows.slice(0, 2), awards: {}, age: 2 }, 1, false);
    ui.drawResultsCard(ctx, w, h, u, { rows, you: rows[6] });
    ui.drawResultsCard(ctx, w, h, u, { rows: rows.slice(0, 2), you: null });
    for (const k of ['circle', 'square', 'triangle', 'diamond', 'star', 'cross', 'hex', 'bar', 'nothing']) drawGlyph(ctx, k, 20, 20, 6, '#fff');
    for (const k of [...ITEM_KINDS, 'zzz']) drawIcon(ctx, k, 30, 30, 12, '#fff');
    label(ctx, 'Plain', 10, 10, 20);
  }
  assert.deepEqual(dom.problems, []);
  assert.ok(ui.inHit({ x: 1, y: 1, w: 5, h: 5, on: true }, 3, 3) && !ui.inHit({ x: 1, y: 1, w: 5, h: 5, on: false }, 3, 3));
  assert.ok(COLS > 0 && ROWS > 0 && BLAST_MS > 0);
});
