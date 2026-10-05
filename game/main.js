// Bomb Maze Battle: boot, the loop, the screens, and this page's own bomber.
//
// Flow: join the room at once; a title with one PLAY button over a live arena (bots playing); a lobby that is the arena with no crates
// (practice: bombs hurt nobody); a 3-2-1-GO; rounds (banner, play, the winner's moment, a scoreboard); a podium; back to the lobby with the
// results still up. The match itself (who is out, the bombs, the crates, the scores) is the host page's record `g` in room state: see net.js.

import {
  COLS,
  ROWS,
  N,
  idx,
  T,
  FUSE_MS,
  MAX_PLAYERS,
  SETTINGS,
  WINS_OPTIONS,
  MAP_OPTIONS,
  MAP_ACCENT,
  PLAYER_COLORS,
  ITEM_NAMES,
  BADGES,
  START_STATS,
  STEP_MS,
  spawnOf,
  speedOf,
  clamp,
  hashStr,
  winsOf,
  mapOf,
  cleanName,
  ranking,
  places,
  awardsOf,
} from './rules.js';
import { Sim, fieldFromRecord } from './sim.js';
import { makeBody, stepBody, prunePass, overlapsTile, tileOf } from './move.js';
import { MatchCore } from './match.js';
import { computeDanger, makeDanger } from './bots.js';
import { Host, readG, readPresence, readBots, createStubRoom } from './net.js';
import { Fx } from './fx.js';
import { Sound } from './audio.js';
import { createInput } from './input.js';
import { createAvatars } from './avatars.js';
import { makeView, layoutBoard, drawGround, drawStanding, drawFireLight, drawTag, label, FONT, ITEM_COLORS } from './draw.js';
import * as ui from './ui.js';

const params = new URLSearchParams(location.search);
if (params.has('poster')) {
  const { runPoster } = await import('./poster.js');
  await runPoster(params.get('poster'));
} else {
  await boot();
}

async function boot() {
  const ow = window.onceworlds ?? null;

  // ---------------------------------------------------------------- join at once, before anything heavy
  let room;
  try {
    if (!ow) throw new Error('no platform');
    room = await ow.rooms.join({ maxPlayers: MAX_PLAYERS, minPlayers: 1, lobby: 'bar', settings: SETTINGS });
  } catch (err) {
    console.warn('[bomb-maze-battle] no platform room: playing alone on this page', err);
    room = createStubRoom();
  }
  try {
    ow?.ui?.setOrientation('landscape');
  } catch {
    // desktop ignores it
  }

  // ---------------------------------------------------------------- setup
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const sound = new Sound();
  const fx = new Fx(11);
  const input = createInput(ow);
  const avatars = createAvatars(ow);
  const nowMs = () => (ow ? ow.now() : Date.now());
  const STEP = STEP_MS / 1000;
  const view = makeView();
  let W = 0;
  let H = 0;
  let pr = 1;
  let u = 1;
  let animT = 0;
  let layoutKey = '';

  function resize() {
    W = Math.max(200, innerWidth);
    H = Math.max(150, innerHeight);
    pr = ow?.settings ? ow.settings.pixelRatio(2) : Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * pr);
    canvas.height = Math.round(H * pr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    u = ui.uiScale(W, H);
    view.pr = pr;
    layoutKey = '';
  }
  addEventListener('resize', resize);
  try {
    ow?.settings?.on('change', resize);
  } catch {
    // ignore
  }
  resize();
  try {
    document.fonts?.load(`800 40px ${FONT.split(',')[0]}`)?.catch?.(() => {});
  } catch {
    // the fallback font draws until it loads
  }

  /** Fits the board for what is on screen: the title has the whole window, the lobby leaves the platform's strip, play leaves the HUD. */
  function relayout(mode) {
    const key = `${W}x${H}|${mode}|${pr}`;
    if (key === layoutKey) return;
    layoutKey = key;
    const sc = (n) => Math.round(n * u);
    if (mode === 'title') layoutBoard(view, W, H, 0, 0);
    else if (mode === 'lobby') layoutBoard(view, W, H, sc(62), 96);
    else {
      layoutBoard(view, W, H, sc(58), sc(10));
      if (view.ox < Math.max(118, sc(150)) + Math.max(14, sc(20))) layoutBoard(view, W, H, sc(58 + 52 + 44), sc(10)); // no room at the sides: the table and your power-ups go in rows under the bar
    }
  }

  // ---------------------------------------------------------------- state
  let titleOpen = room.match.phase === 'lobby';
  let needTap = !titleOpen; // arrived mid-match: the first tap starts the sound
  let audioOn = false;
  let appliedControls = '?';
  let musicMode = '';
  let acc = 0;
  let lastTs = 0;
  let rc = null; // this page's round context
  let me = null; // my bomber in the round
  let lobby = null; // the practice arena
  let lobbyMe = null;
  let demo = null; // the title's live bots
  let resultsG = null;
  let resultsUntil = 0;
  let lastFinalG = null;
  let finalFor = null;
  let finalFx = '';
  let callout = null; // { text, sub, color, at }
  let lastCount = 99;
  let goPlayed = false;
  let stats = { matches: 0, wins: 0, rounds: 0, kos: 0, chain: 0 };
  let errors = 0;
  const INP = { dx: 0, dy: 0, bomb: false, kick: false };
  const nameCache = new Map();
  const shakeOff = { x: 0, y: 0 };
  const scratch = { fire: new Uint8Array(N), warn: [] };
  const danger = makeDanger();
  let dangerFrame = 0;
  const SC = { b: 1, r: 2, s: 0, k: 0, p: 0, h: 0, inv: 0 }; // my stats, while I step
  const SO = { b: 1, r: 2, s: 0, k: 0, p: 0, h: 0, inv: 0 }; // anyone's, for drawing and effects
  const SH = { b: 1, r: 2, s: 0, k: 0, p: 0, h: 0, inv: 0 }; // mine, for the HUD and the controls

  if (ow) {
    ow.save
      .get('stats')
      .then((s) => {
        if (s && typeof s === 'object') stats = { matches: Number(s.matches) || 0, wins: Number(s.wins) || 0, rounds: Number(s.rounds) || 0, kos: Number(s.kos) || 0, chain: Number(s.chain) || 0 };
      })
      .catch(() => {});
  }
  const award = (id) => {
    if (!BADGES.has(id)) return;
    try {
      ow?.badges?.award(id)?.catch?.(() => {});
    } catch {
      // guests and the stand-alone page earn nothing
    }
  };

  // ---------------------------------------------------------------- the host's page (rounds, bombs, bots)
  const host = new Host(room, { nowMs, selfBody: () => (me && rc && me.rid === rc.rid ? me.body : null), onBadge: award });
  setInterval(() => host.pump(), 100);

  room.on('message', (d, from) => {
    if (!d || typeof d !== 'object' || !from) return;
    if (room.isHost && host.onMessage(d, from)) return;
    if (from.id !== room.host) return;
    if (d.t === 'badge' && BADGES.has(d.b)) award(d.b);
    else if (d.t === 'no' && me && rc && d.rid === rc.rid) dropPending(d.x, d.y, true);
  });
  room.on('host', () => host.adopt());
  room.on('reconnect', () => host.adopt());
  room.on('starting', () => {
    if (titleOpen) leaveTitle();
    lastCount = 99;
    goPlayed = false;
    if (room.isHost && room.kind === 'private') {
      try {
        room.setOpen?.(true);
      } catch {
        // friends can still join the next lobby
      }
    }
  });
  room.on('matchstart', () => {
    if (titleOpen) leaveTitle();
    rc = null;
    me = null;
    fx.clear();
    resultsUntil = 0;
    finalFor = null;
    lastFinalG = null;
    callout = null;
    if (!goPlayed) {
      goPlayed = true;
      sound.go();
    }
    host.adopt();
  });
  room.on('matchend', (match, previous) => {
    rc = null;
    me = null;
    fx.clear();
    lobby = null;
    lobbyMe = null;
    callout = null;
    if (previous?.phase === 'playing' && lastFinalG && lastFinalG.mid === previous.id) {
      resultsG = lastFinalG;
      resultsUntil = performance.now() + T.resultsAfterMs;
    }
  });
  room.on('rename', (p) => nameCache.set(p.id, cleanName(p.name)));
  host.adopt();
  if (titleOpen) room.hideLobby();

  function leaveTitle() {
    titleOpen = false;
    needTap = !audioOn;
    input.reset();
    try {
      room.hideLobby(false);
    } catch {
      // ignore
    }
  }

  // ---------------------------------------------------------------- taps and keys
  function unlockAudio() {
    sound.unlock();
    audioOn = sound.ready;
  }
  function playPressed() {
    unlockAudio();
    sound.pop();
    leaveTitle();
  }
  function cycleSetting(id, values) {
    const i = values.indexOf(room.settings[id]);
    sound.tap();
    room.setSetting(id, values[(i + 1) % values.length]);
  }
  addEventListener('pointerdown', (e) => {
    unlockAudio();
    if (needTap && !titleOpen) {
      needTap = false;
      return;
    }
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / Math.max(1, r.width)) * W;
    const y = ((e.clientY - r.top) / Math.max(1, r.height)) * H;
    if (titleOpen) {
      if (ui.inHit(ui.hits.play, x, y)) playPressed();
      return;
    }
    if (room.match.phase !== 'lobby') return;
    if (room.stub && ui.inHit(ui.hits.start, x, y)) {
      sound.pop();
      room.startMatch();
    } else if (room.isHost && ui.inHit(ui.hits.wins, x, y)) cycleSetting('wins', WINS_OPTIONS);
    else if (room.isHost && ui.inHit(ui.hits.map, x, y)) cycleSetting('map', MAP_OPTIONS.map((o) => o.value));
  });
  addEventListener('keydown', (e) => {
    unlockAudio();
    if (needTap && !titleOpen) {
      needTap = false;
      return;
    }
    if (e.repeat) return;
    if (titleOpen && (e.code === 'Space' || e.code === 'Enter')) playPressed();
    else if (room.stub && room.match.phase === 'lobby' && !titleOpen && e.code === 'Enter') room.startMatch();
  });

  // ---------------------------------------------------------------- who is who
  const myId = () => room.me.id;
  function nameOf(id, entry) {
    if (entry?.bot) return cleanName(entry.name, 'Bot');
    const p = room.players.get(id);
    if (p?.name) nameCache.set(id, cleanName(p.name));
    return nameCache.get(id) ?? 'Player';
  }
  const initialOf = (name) => (String(name).trim()[0] ?? '?').toUpperCase();
  const colorOf = (id) => PLAYER_COLORS[hashStr(id) % PLAYER_COLORS.length];
  void colorOf;

  /** Everyone's stats, from the world the page is looking at (the host's own, or the record). */
  function statsOf(g, field, id, out) {
    const s = field.stats?.get(id);
    if (s) {
      out.b = s.b;
      out.r = s.r;
      out.s = s.s;
      out.k = s.k;
      out.p = s.p;
      out.h = s.h;
      out.inv = s.inv;
      return out;
    }
    const a = g.pl[id];
    if (a) {
      out.b = a[0];
      out.r = a[1];
      out.s = a[2];
      out.k = a[3];
      out.p = a[4];
      out.h = a[5];
      out.inv = a[6];
    } else Object.assign(out, START_STATS, { inv: 0 });
    return out;
  }

  // ---------------------------------------------------------------- the round, from this page
  class RoundCtx {
    constructor(g) {
      this.rid = g.rid;
      this.rn = g.rn;
      this.fresh = true;
      this.seen = { bombs: new Set(), fire: new Set(), items: new Set(), sliding: new Set() };
      this.prevCrates = null;
      this.prevItems = new Map();
      this.prevOut = new Set(Object.keys(g.out));
      this.prevStats = new Map();
      this.prevCount = 0;
      this.vis = new Map();
      this.flags = { sdSeen: false, endSeen: false, bannerSeen: false, playSeen: false, scoreSeen: false };
      this.snaps = [];
      this.snapRaw = null;
      this.mirror = null;
      this.mirrorG = null;
      this.colorIndex = new Map(g.roster.map((r) => [r.id, r.c]));
      this.botIndex = new Map(g.roster.filter((r) => r.bot).map((r, j) => [r.id, j]));
      this.index = new Map(g.roster.map((r, i) => [r.id, i]));
    }
    visOf(id) {
      let v = this.vis.get(id);
      if (!v) {
        v = { x: 0, y: 0, init: false, walk: 0, moving: 0, movT: -1, dir: 2 };
        this.vis.set(id, v);
      }
      return v;
    }
  }

  function ensureRound(g) {
    if (!rc || rc.rid !== g.rid) {
      rc = new RoundCtx(g);
      me = makeMe(g, rc);
      callout = null;
    }
    return rc;
  }

  function makeMe(g, c) {
    const id = myId();
    const i = c.index.get(id);
    if (i === undefined || room.spectating) return null;
    const [sx, sy] = spawnOf(i);
    const body = makeBody(sx + 0.5, sy + 0.5);
    const m = { rid: g.rid, i, body, st: 0, hitAt: 0, claimAt: -1e9, claims: 0, pending: [], lastTake: new Map(), lastKick: 0, pubAt: 0, pubKey: '', shieldSeen: false, outAt: 0 };
    // a reload in the middle of a round: carry on from where this player was
    const p = readPresence(room.me.presence, g.rn);
    if (p) {
      body.x = clamp(p.x, 1.2, COLS - 1.2);
      body.y = clamp(p.y, 1.2, ROWS - 1.2);
      body.dir = p.d;
    }
    if (id in g.out) m.st = 2;
    return m;
  }

  /** The world this page looks at: the host's own sim while it is acting, else the record rebuilt. */
  function fieldOf(g, c, rt) {
    const sim = host.core?.sim;
    if (sim && room.isHost && room.running && g.by === myId() && host.core.n === g.rn) return sim;
    if (c.mirrorG !== g) {
      c.mirror = fieldFromRecord(g);
      c.mirrorG = g;
    }
    c.mirror.t = rt;
    return c.mirror;
  }

  /** How loud something at (x, y) is for me: full nearby, a little quieter across the arena. */
  function volAt(x, y) {
    const b = me?.body;
    const d = b ? Math.hypot(b.x - x, b.y - y) : 6;
    return clamp(1.1 - d / 16, 0.3, 1);
  }

  function dropPending(x, y, deny) {
    if (!me) return;
    const i = me.pending.findIndex((p) => p.x === x && p.y === y);
    if (i >= 0) {
      me.pending.splice(i, 1);
      if (deny) sound.deny();
    }
  }

  function sendToHost(g, d) {
    if (room.isHost) return host.onMessage(d, room.me);
    room.send(d, { to: room.host });
    return true;
  }

  function tryBomb(g, field) {
    const m = me;
    const b = m.body;
    const tx = Math.floor(b.x);
    const ty = Math.floor(b.y);
    const s = statsOf(g, field, myId(), SC);
    const owned = field.ownedBombs(myId()) + m.pending.filter((p) => !field.bombAt(p.x, p.y)).length;
    if (owned >= s.b || field.codeAt(tx, ty, [], field.t) !== 0 || m.pending.some((p) => p.x === tx && p.y === ty) || field.fireOn(idx(tx, ty), field.t)) {
      sound.deny();
      return;
    }
    sound.place();
    fx.dust(tx + 0.5, ty + 0.8, 3);
    fx.shake(0.04);
    if (room.isHost) {
      if (host.onMessage({ t: 'bomb', rid: g.rid, x: tx, y: ty }, room.me)) b.pass.push(idx(tx, ty));
      else sound.deny();
      return;
    }
    m.pending.push({ x: tx, y: ty, born: performance.now(), at: field.t + FUSE_MS, key: -(++pendingSeq) });
    b.pass.push(idx(tx, ty));
    room.send({ t: 'bomb', rid: g.rid, x: tx, y: ty }, { to: room.host });
  }

  function kickAt(g, field, tx, ty, dx, dy) {
    const now = performance.now();
    if (now - me.lastKick < 220) return;
    me.lastKick = now;
    const bomb = field.bombAt(tx, ty);
    if (!bomb || bomb.dx || bomb.dy) return;
    sound.kick();
    fx.dust(tx + 0.5, ty + 0.8, 4);
    sendToHost(g, { t: 'kick', rid: g.rid, x: tx, y: ty, dx, dy });
  }

  const DIR_VEC = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  let pendingSeq = 0;

  function stepMe(g, c, field, dt) {
    const m = me;
    if (!m || m.rid !== g.rid) return;
    const id = myId();
    const body = m.body;
    if (id in g.out && m.st !== 2) {
      m.st = 2;
      m.outAt = performance.now();
      onMyOut(body);
    }
    if (m.st === 2) return;
    statsOf(g, field, id, SC);
    const t = field.t;
    const canAct = g.phase === 'play' && t >= 0 && room.running && m.st === 0;
    input.sample(INP);
    const dx = canAct ? INP.dx : 0;
    const dy = canAct ? INP.dy : 0;
    const blocked = (tx, ty) => {
      const code = field.codeAt(tx, ty, body.pass, t);
      if (code === 0 && m.pending.length) {
        const i = idx(tx, ty);
        for (const p of m.pending) if (p.x === tx && p.y === ty && !body.pass.includes(i)) return 2;
      }
      return code;
    };
    if (m.st === 0) stepBody(body, dx, dy, dt, speedOf(SC), blocked);
    else {
      body.moving = 0;
      body.bump = -1;
    }
    prunePass(body);
    if (canAct) {
      if (INP.bomb) tryBomb(g, field);
      if (INP.kick && SC.k) {
        const [kx, ky] = DIR_VEC[body.dir];
        kickAt(g, field, Math.floor(body.x) + kx, Math.floor(body.y) + ky, kx, ky);
      } else if (body.bump >= 0 && SC.k) {
        const [kx, ky] = DIR_VEC[body.dir];
        kickAt(g, field, body.bump % COLS, Math.floor(body.bump / COLS), kx, ky);
      }
      // a power-up underfoot: ask for it (again after a moment, if the host hasn't said yes)
      const ti = tileOf(body);
      if (field.items.length && field.itemAt(ti)) {
        const now = performance.now();
        if (now - (m.lastTake.get(ti) ?? -1e9) > 380) {
          m.lastTake.set(ti, now);
          sendToHost(g, { t: 'take', rid: g.rid, i: ti });
        }
      }
    }
    // blasts and falling pillars
    if (g.phase === 'play' && m.st <= 1) hazards(g, field, m, body);
    for (let k = m.pending.length - 1; k >= 0; k--) {
      const p = m.pending[k];
      if (field.bombAt(p.x, p.y)) m.pending.splice(k, 1);
      else if (performance.now() - p.born > 1000) {
        m.pending.splice(k, 1);
        sound.deny();
      }
    }
  }

  function hazards(g, field, m, body) {
    const i = tileOf(body);
    const t = field.t;
    const crushed = field.crushedBy(i, t);
    const burning = field.fireOn(i, t);
    const now = performance.now();
    if (m.st === 1 && t < SC.inv) {
      m.st = 0; // the host's shield took it after all
      m.claims = 0;
      return;
    }
    if (!crushed && !burning) {
      if (m.st === 1 && now - m.hitAt > 1400) {
        m.st = 0; // the host did not take it (a shield, a blast that never was)
        m.claims = 0;
      }
      return;
    }
    if (t < SC.inv) return;
    if (m.st === 0) {
      if (SC.h > 0 && !crushed) {
        if (now - m.claimAt > 400) {
          m.claimAt = now;
          sendToHost(g, { t: 'out', rid: g.rid, f: i });
        }
        return;
      }
      m.st = 1;
      m.hitAt = now;
      m.claims = 0;
      onMyHit(body);
    }
    if (m.st === 1 && now - m.claimAt > 380 && m.claims < 5) {
      m.claimAt = now;
      m.claims++;
      sendToHost(g, { t: 'out', rid: g.rid, f: i });
    }
  }

  function onMyHit(body) {
    fx.hitstop(70);
    fx.shake(0.55);
    fx.doFlash(0.5, '255,60,40');
    sound.out(1);
    fx.sparks(body.x, body.y, 14, '#ff8a3a', 5);
  }

  function onMyOut(body) {
    fx.sparks(body.x, body.y, 20, '#ffd27a', 6, 0.4);
    fx.smoke(body.x, body.y, 6, 0.3);
    fx.ring(body.x, body.y + 0.2, 0.9, '#ffffff', 0.5);
    callout = { text: 'ELIMINATED', sub: '', color: '#ff5a4a', at: animT };
  }

  // ---------------------------------------------------------------- what the page notices in the world
  const fresh = (c) => c.fresh;
  function observe(g, c, field, t) {
    const silent = fresh(c);
    const id = myId();
    // bombs: new ones, and kicked ones starting to slide
    for (const b of field.bombs) {
      if (!c.seen.bombs.has(b.id)) {
        c.seen.bombs.add(b.id);
        if (!silent) {
          if (b.o !== id) {
            sound.place(volAt(b.x, b.y) * 0.8);
            fx.dust(b.x + 0.5, b.y + 0.8, 2);
          }
          if (me && me.st !== 2 && overlapsTile(me.body, idx(b.x, b.y)) && !me.body.pass.includes(idx(b.x, b.y))) me.body.pass.push(idx(b.x, b.y));
        }
      }
      const sliding = b.dx !== 0 || b.dy !== 0;
      if (sliding && !c.seen.sliding.has(b.id)) {
        c.seen.sliding.add(b.id);
        if (!silent && b.o !== id) sound.kick(volAt(b.x, b.y) * 0.8);
      } else if (!sliding) c.seen.sliding.delete(b.id);
    }
    // blasts
    const froms = new Map();
    for (const f of field.fire) {
      const key = `${f.i}:${Math.round(f.from)}`;
      if (c.seen.fire.has(key)) continue;
      c.seen.fire.add(key);
      if (silent || t - f.from > 600) continue;
      const x = (f.i % COLS) + 0.5;
      const y = Math.floor(f.i / COLS) + 0.5;
      fx.sparks(x, y, 4, '#ffb43b', 3.6);
      if (fx.rnd() < 0.5) fx.smoke(x, y, 1, 0.26);
      const k = Math.round(f.from);
      const e = froms.get(k);
      if (e) e.n++;
      else froms.set(k, { n: 1, x, y });
    }
    for (const e of froms.values()) {
      const near = volAt(e.x, e.y);
      sound.boom(Math.ceil(e.n / 6), near);
      fx.shake((0.14 + Math.min(0.4, e.n * 0.018)) * near);
      fx.doFlash(0.1 * near, '255,210,150');
    }
    // crates breaking
    if (c.prevCrates && !silent) {
      let broke = 0;
      for (let i = 0; i < N; i++) {
        if (c.prevCrates[i] && !field.crates[i] && !field.crushedBy(i, t)) {
          broke++;
          const x = (i % COLS) + 0.5;
          const y = Math.floor(i / COLS) + 0.5;
          fx.chips(x, y, 9, '#c79a5e');
          fx.chips(x, y, 3, '#3a404c');
          fx.smoke(x, y, 2, 0.22, '150,125,90');
        }
      }
      if (broke) sound.crate(clamp(0.5 + broke * 0.1, 0.5, 1));
    }
    if (!c.prevCrates) c.prevCrates = new Uint8Array(N);
    c.prevCrates.set(field.crates);
    // power-ups appearing and going
    const items = new Map();
    for (const it of field.items) {
      const key = it.i;
      items.set(key, it.k);
      if (!c.prevItems.has(key) && !silent) {
        const x = (it.i % COLS) + 0.5;
        const y = Math.floor(it.i / COLS) + 0.5;
        fx.ring(x, y, 0.7, ITEM_COLORS[it.k] ?? '#fff', 0.45);
        fx.sparks(x, y, 6, ITEM_COLORS[it.k] ?? '#fff', 2.5, 0.3);
      }
    }
    if (!silent) {
      for (const [i, k] of c.prevItems) {
        if (items.has(i)) continue;
        const x = (i % COLS) + 0.5;
        const y = Math.floor(i / COLS) + 0.5;
        const burned = field.fire.some((f) => f.i === i && t - f.from < 150);
        const mine = me && me.st !== 2 && Math.abs(me.body.x - x) < 1.2 && Math.abs(me.body.y - y) < 1.2;
        if (burned) fx.smoke(x, y, 2, 0.2);
        else if (mine) {
          sound.pickup(k);
          fx.sparks(x, y, 12, ITEM_COLORS[k] ?? '#fff', 4, 0.4);
          fx.ring(x, y, 0.9, ITEM_COLORS[k] ?? '#fff', 0.45);
          fx.popup(me.body.x, me.body.y - 0.9, ITEM_NAMES[k] ?? '', ITEM_COLORS[k] ?? '#fff', 26);
        } else fx.sparks(x, y, 6, ITEM_COLORS[k] ?? '#fff', 2.5, 0.3);
      }
    }
    c.prevItems = items;
    // shields going up and popping
    for (const r of g.roster) {
      const s = statsOf(g, field, r.id, SO);
      const prev = c.prevStats.get(r.id);
      if (prev !== undefined && !silent) {
        const v = c.visOf(r.id);
        if (prev === 1 && s.h === 0 && s.inv > t) {
          sound.shieldPop(volAt(v.x, v.y));
          fx.ring(v.x, v.y, 1.2, '#8fe3ff', 0.5);
          fx.sparks(v.x, v.y, 14, '#8fe3ff', 5, 0.5);
          fx.shake(0.12);
        } else if (prev === 0 && s.h === 1 && r.id === id) sound.shieldUp();
      }
      c.prevStats.set(r.id, s.h);
    }
    // knock-outs
    for (const rid of Object.keys(g.out)) {
      if (c.prevOut.has(rid)) continue;
      c.prevOut.add(rid);
      if (silent) continue;
      const v = c.visOf(rid);
      if (rid !== id) {
        fx.sparks(v.x, v.y, 18, '#ffd27a', 5.5, 0.4);
        fx.smoke(v.x, v.y, 5, 0.3);
        fx.ring(v.x, v.y + 0.2, 0.8, '#ffffff', 0.45);
        sound.out(volAt(v.x, v.y) * 0.8);
        fx.hitstop(45);
        fx.shake(0.2);
      }
    }
    // sudden death
    const count = field.dropCount(t);
    if (count > c.prevCount) {
      if (!silent && c.prevCount >= 0) {
        for (let k = c.prevCount; k < count && k < c.prevCount + 4; k++) {
          const i = field.order[k];
          if (i === undefined) break;
          const x = (i % COLS) + 0.5;
          const y = Math.floor(i / COLS) + 0.5;
          fx.dust(x, y + 0.2, 4);
          fx.smoke(x, y, 1, 0.3);
        }
        sound.slam(0.8);
        fx.shake(0.1);
      }
      c.prevCount = count;
    }
    if (!c.flags.sdSeen && (count > 0 || field.warned(t, scratch.warn).length > 0)) {
      c.flags.sdSeen = true;
      if (!silent) {
        sound.alarm();
        callout = { text: 'SUDDEN DEATH', sub: '', color: '#ff5a4a', at: animT };
      }
    }
    c.fresh = false;
  }

  // ---------------------------------------------------------------- positions of everyone for drawing
  /** Feeds the bots' snapshots (host page: the bots are simulated here, nothing to read). */
  function feedSnaps(g, c) {
    const raw = room.state.b;
    if (raw === c.snapRaw) return;
    c.snapRaw = raw;
    const s = readBots(raw, g.rid);
    if (!s) return;
    const last = c.snaps[c.snaps.length - 1];
    if (last && s.t <= last.t) return;
    c.snaps.push(s);
    if (c.snaps.length > 8) c.snaps.shift();
  }

  function sampleSnap(c, ts) {
    const a = c.snaps;
    if (a.length === 0) return null;
    if (ts <= a[0].t || a.length === 1) return { p: a[0], q: a[0], k: 0 };
    for (let i = a.length - 1; i > 0; i--) {
      if (a[i - 1].t <= ts) {
        const span = a[i].t - a[i - 1].t;
        return { p: a[i - 1], q: a[i], k: span > 0 ? clamp((ts - a[i - 1].t) / span, 0, 1) : 1 };
      }
    }
    return { p: a[0], q: a[0], k: 0 };
  }

  function lerp(a, b, k) {
    return a + (b - a) * k;
  }

  const bomberPool = [];
  const bombPool = [];
  let nBombers = 0;
  let nBombs = 0;
  function newBomber() {
    let d = bomberPool[nBombers];
    if (!d) d = bomberPool[nBombers] = {};
    nBombers++;
    d.x = d.y = 0;
    d.dir = 2;
    d.moving = 0;
    d.walk = 0;
    d.c = 0;
    d.head = null;
    d.initial = '?';
    d.alpha = 1;
    d.blink = false;
    d.shield = false;
    d.scale = 1;
    d.ring = false;
    d.name = '';
    d.arrow = false;
    d.ready = false;
    return d;
  }
  function newBomb() {
    let d = bombPool[nBombs];
    if (!d) d = bombPool[nBombs] = {};
    nBombs++;
    d.x = d.y = 0;
    d.phase = 0;
    d.c = 0;
    d.key = 0;
    return d;
  }

  /** Moves a drawn bomber's smoothed position and works out its walk. */
  function followVis(v, x, y, dt, dir, moving) {
    if (!v.init) {
      v.x = x;
      v.y = y;
      v.init = true;
    }
    const dist = Math.hypot(x - v.x, y - v.y);
    v.x = x;
    v.y = y;
    if (dist > 0.0025 || moving) v.movT = animT;
    v.moving = animT - v.movT < 0.12 ? 1 : 0;
    if (v.moving) v.walk = (v.walk + (dist || 0.04 * dt * 60) * 7.5) % (Math.PI * 4);
    v.dir = dir;
  }

  /** The bombs to draw (the world's, and my own not yet confirmed). */
  function collectBombs(g, c, field, t, now) {
    nBombs = 0;
    const snap = field.stats ? null : sampleSnap(c, t - 130);
    for (const b of field.bombs) {
      const d = newBomb();
      let bx = b.x + 0.5;
      let by = b.y + 0.5;
      if (b.dx || b.dy) {
        if (field.stats) {
          bx += b.dx * b.pr;
          by += b.dy * b.pr;
        } else if (snap) {
          const a = snap.p.k?.find((k) => k[0] === b.id);
          const z = snap.q.k?.find((k) => k[0] === b.id);
          if (a && z) {
            bx = lerp(a[1], z[1], snap.k);
            by = lerp(a[2], z[2], snap.k);
          } else if (z || a) {
            bx = (z ?? a)[1];
            by = (z ?? a)[2];
          }
        }
      }
      d.x = bx;
      d.y = by;
      d.phase = 1 - (b.at - t) / FUSE_MS;
      d.c = c.colorIndex.get(b.o) ?? 0;
      d.key = b.id;
    }
    if (me) {
      for (const p of me.pending) {
        if (field.bombAt(p.x, p.y)) continue;
        const d = newBomb();
        d.x = p.x + 0.5;
        d.y = p.y + 0.5;
        d.phase = 1 - (p.at - t) / FUSE_MS;
        d.c = c.colorIndex.get(myId()) ?? 0;
        d.key = p.key;
      }
    }
    void now;
  }

  /** The bombers to draw, from the record: me from my own simulation, bots from the host's sim or snapshots, people from presence. */
  function collectBombers(g, c, field, t, dt, showNames) {
    nBombers = 0;
    const id = myId();
    const snap = host.core?.runner && room.isHost && field.stats ? null : sampleSnap(c, t - 130);
    g.roster.forEach((r, i) => {
      if (r.id in g.out) return;
      const v = c.visOf(r.id);
      const d = newBomber();
      d.c = r.c;
      d.name = showNames ? nameOf(r.id, r) : '';
      d.initial = initialOf(nameOf(r.id, r));
      d.head = r.bot ? null : avatars.get(r.id);
      const [sx, sy] = spawnOf(i);
      let x = sx + 0.5;
      let y = sy + 0.5;
      let dir = 2;
      let moving = 0;
      let away = false;
      if (r.id === id && me) {
        x = me.body.x;
        y = me.body.y;
        dir = me.body.dir;
        moving = me.body.moving;
        v.walk = me.body.walk;
        v.init = true;
        v.x = x;
        v.y = y;
        v.dir = dir;
        v.moving = moving;
        d.ring = true;
        d.arrow = g.phase === 'banner' || (g.phase === 'play' && t < 2500);
        d.name = showNames ? nameOf(r.id, r) : '';
        const s = statsOf(g, field, r.id, SO);
        d.shield = s.h > 0;
        d.blink = s.inv > t || me.st === 1;
      } else {
        if (r.bot) {
          const bot = field.stats && host.core?.runner ? host.core.runner.byId(r.id) : null;
          if (bot) {
            x = bot.body.x;
            y = bot.body.y;
            dir = bot.body.dir;
            moving = bot.body.moving;
          } else if (snap) {
            const j = c.botIndex.get(r.id);
            const a = snap.p.p[j];
            const z = snap.q.p[j];
            if (a && z) {
              x = lerp(a[0], z[0], snap.k);
              y = lerp(a[1], z[1], snap.k);
              dir = z[2];
              moving = z[3];
            }
          }
        } else {
          const pl = room.players.get(r.id);
          const raw = readPresence(pl?.presence, g.rn);
          if (raw) {
            const sm = room.presenceAt(r.id, { snap: 3 });
            x = Number.isFinite(sm?.x) ? sm.x : raw.x;
            y = Number.isFinite(sm?.y) ? sm.y : raw.y;
            dir = raw.d;
            moving = raw.w;
          }
          away = pl?.connected === false;
        }
        x = clamp(x, 0.6, COLS - 0.6);
        y = clamp(y, 0.6, ROWS - 0.6);
        followVis(v, x, y, dt, dir, moving);
        d.alpha = away ? 0.5 : 1;
        const s = statsOf(g, field, r.id, SO);
        d.shield = s.h > 0;
        d.blink = s.inv > t;
      }
      d.x = v.x;
      d.y = v.y;
      d.dir = v.dir;
      d.moving = v.moving;
      d.walk = v.walk;
    });
  }

  // ---------------------------------------------------------------- the lobby arena and the title's demo
  const lobbyId = () => myId();
  function makeLobby(map) {
    const sim = new Sim({ map, seed: 1234, roster: [{ id: lobbyId(), bot: 0 }], crates: new Uint8Array(N), practice: true });
    const [sx, sy] = spawnOf(hashStr(lobbyId()) % 8);
    lobbyMe = makeBody(sx + 0.5, sy + 0.5);
    sim.bodies.set(lobbyId(), lobbyMe);
    lobbyMe.born = animT;
    return { sim, map, t0: performance.now() };
  }
  function ensureLobby() {
    const map = mapOf(room.settings.map);
    if (!lobby || lobby.map !== map) lobby = makeLobby(map);
    return lobby;
  }

  function makeDemo() {
    const core = new MatchCore({ seed: (Math.random() * 4294967296) >>> 0, need: 2, map: ['classic', 'cross', 'rings'][Math.floor(Math.random() * 3)], seats: 4 });
    const sim = core.beginRound();
    return { core, sim, endedAt: 0, vis: new Map(), c: new RoundCtx({ rid: 'demo', rn: 1, out: {}, roster: core.roster }), t0: performance.now() };
  }

  function stepDemo(dt) {
    if (!demo) demo = makeDemo();
    const d = demo;
    d.core.advance(d.sim.t + Math.min(dt, 0.06) * 1000);
    d.sim.events.length = 0;
    const alive = d.sim.aliveIds().length;
    if (d.core.result || alive <= 1) {
      if (!d.endedAt) d.endedAt = animT;
      else if (animT - d.endedAt > 2.2) demo = makeDemo();
    } else if (d.sim.t > 50000) demo = makeDemo();
  }

  // ---------------------------------------------------------------- one frame of logic
  function simFrame(dt) {
    host.pump();
    const mp = room.match.phase;
    const g = mp === 'playing' ? readG(room) : null;
    acc = Math.min(acc + dt, 0.12);
    let steps = 0;
    while (acc >= STEP && steps < 6) {
      acc -= STEP;
      steps++;
    }
    if (fx.freeze > 0 || (mp === 'playing' && !room.running)) steps = 0;
    if (titleOpen) {
      stepDemo(dt);
      return;
    }
    if (mp === 'playing' && g) {
      const c = ensureRound(g);
      const rt = room.matchNow() - g.t0;
      const field = fieldOf(g, c, rt);
      feedSnaps(g, c);
      if (g.phase === 'banner' || g.phase === 'play') for (let k = 0; k < steps; k++) stepMe(g, c, field, STEP);
      else if (me && me.st !== 2) me.body.moving = 0;
      observe(g, c, field, field.t);
      publishRound(g);
      return;
    }
    // the lobby (and the countdown): practice in an empty arena
    const L = ensureLobby();
    const sim = L.sim;
    if (!room.spectating) {
      for (let k = 0; k < steps; k++) {
        input.sample(INP);
        const blocked = (tx, ty) => sim.codeAt(tx, ty, lobbyMe.pass, sim.t);
        stepBody(lobbyMe, INP.dx, INP.dy, STEP, speedOf({ s: 0 }), blocked);
        prunePass(lobbyMe);
        if (INP.bomb) {
          if (sim.placeBomb(lobbyId(), Math.floor(lobbyMe.x), Math.floor(lobbyMe.y))) {
            sound.place();
            fx.dust(Math.floor(lobbyMe.x) + 0.5, Math.floor(lobbyMe.y) + 0.8, 3);
          } else sound.deny();
        }
      }
    }
    sim.advance(performance.now() - L.t0 + 10);
    practiceFx(sim);
    publishLobby();
  }

  /** Blasts in the practice arena: the same sounds and sparks, nobody hurt. */
  const practiceSeen = new Set();
  function practiceFx(sim) {
    for (const e of sim.events.splice(0)) {
      if (e.k === 'boom') {
        sound.boom(1, 0.8);
        fx.shake(0.12);
      }
    }
    for (const f of sim.fire) {
      const key = `${f.i}:${Math.round(f.from)}`;
      if (practiceSeen.has(key)) continue;
      practiceSeen.add(key);
      if (practiceSeen.size > 600) practiceSeen.clear();
      if (sim.t - f.from > 400) continue;
      fx.sparks((f.i % COLS) + 0.5, Math.floor(f.i / COLS) + 0.5, 4, '#ffb43b', 3.6);
    }
  }

  // ---------------------------------------------------------------- telling the others where I am
  const r2 = (v) => Math.round(v * 100) / 100;
  const lobbyKeyRef = { k: '', at: 0 };
  function publishRound(g) {
    if (!me || me.rid !== g.rid || room.spectating) return;
    const b = me.body;
    const key = `${r2(b.x)},${r2(b.y)},${b.dir},${b.moving},${g.rn},${me.st === 2 ? 2 : 0}`;
    const now = performance.now();
    if (key === me.pubKey && now - me.pubAt < 400) return;
    if (now - me.pubAt < 50) return;
    me.pubKey = key;
    me.pubAt = now;
    room.setPresence({ x: r2(b.x), y: r2(b.y), d: b.dir, w: b.moving, r: g.rn, s: me.st === 2 ? 2 : 0 });
  }
  function publishLobby() {
    if (!lobbyMe || room.spectating) return;
    const b = lobbyMe;
    const key = `${r2(b.x)},${r2(b.y)},${b.dir},${b.moving}`;
    const now = performance.now();
    if (key === lobbyKeyRef.k && now - lobbyKeyRef.at < 400) return;
    if (now - lobbyKeyRef.at < 50) return;
    lobbyKeyRef.k = key;
    lobbyKeyRef.at = now;
    room.setPresence({ x: r2(b.x), y: r2(b.y), d: b.dir, w: b.moving, r: 0, s: 0 });
  }

  // ---------------------------------------------------------------- touch controls and music follow what is on screen
  function syncControls(g) {
    const mp = room.match.phase;
    let want = 'none';
    if (!titleOpen && !needTap && !room.spectating) {
      if (mp === 'lobby' || mp === 'starting') want = 'play';
      else if (mp === 'playing' && g && me && me.st !== 2 && (g.phase === 'banner' || g.phase === 'play')) want = 'play';
    }
    if (want === 'play' && mp === 'playing' && me) {
      const s = rc && g ? statsOf(g, fieldForControls(g), myId(), SH) : null;
      if (s && s.k) want = 'play+kick';
    }
    if (want === appliedControls) return;
    appliedControls = want;
    try {
      if (want === 'none') ow?.controls?.set(null);
      else {
        const buttons = [{ id: 'bomb', label: 'Bomb' }];
        if (want === 'play+kick') buttons.push({ id: 'kick', label: 'Kick' });
        ow?.controls?.set({ stick: 'analog', buttons });
      }
    } catch {
      // ignore
    }
  }
  function fieldForControls(g) {
    return host.core?.sim && room.isHost && g.by === myId() ? host.core.sim : { stats: null };
  }

  function syncMusic(g, field) {
    if (!audioOn) return;
    let mode = 'menu';
    if (room.match.phase === 'playing' && g && (g.phase === 'banner' || g.phase === 'play' || g.phase === 'end')) {
      mode = field && g.phase === 'play' && (field.dropCount(field.t) > 0 || field.warned(field.t, scratch.warn).length > 0) ? 'tense' : 'play';
    }
    if (mode === musicMode) return;
    musicMode = mode;
    sound.setMusic(mode);
  }

  // ---------------------------------------------------------------- drawing
  const padsList = [];
  function padsOf(g) {
    padsList.length = 0;
    g.roster.forEach((r, i) => {
      const [sx, sy] = spawnOf(i);
      padsList.push({ x: sx + 0.5, y: sy + 0.5, c: r.c });
    });
    return padsList;
  }

  let dangerLive = false;
  function drawBoard(field, t, accent, o = {}) {
    shakeOffset();
    ctx.save();
    ctx.translate(shakeOff.x, shakeOff.y);
    if (o.drift) {
      const k = 1.03 + 0.012 * Math.sin(animT * 0.25);
      ctx.translate(W / 2, H / 2);
      ctx.scale(k, k);
      ctx.translate(-W / 2 + Math.sin(animT * 0.2) * 10, -H / 2 + Math.cos(animT * 0.17) * 6);
    }
    // blasts about to go off: tint the tiles
    let dng = null;
    if (o.danger) {
      if (field.bombs.length) {
        if (dangerFrame++ % 3 === 0) computeDanger(field, null, danger);
        dangerLive = true;
      } else if (dangerLive) {
        danger.start.fill(Infinity);
        dangerLive = false;
      }
      dng = danger.start;
    }
    const sc = { field, t, accent, danger: dng, pads: o.pads ?? null };
    drawGround(ctx, view, sc, animT, scratch);
    drawStanding(ctx, view, sc, bombPool, nBombs, bomberPool, nBombers, animT);
    drawFireLight(ctx, view, field, t);
    fx.draw(ctx, view);
    if (o.tags) for (let i = 0; i < nBombers; i++) drawTag(ctx, view, bomberPool[i], animT);
    for (const p of fx.pops) {
      const k = p.age / p.life;
      ctx.globalAlpha = clamp(1 - Math.max(0, k - 0.6) / 0.4, 0, 1);
      label(ctx, p.text, view.ox + p.x * view.S, view.oy + (p.y - k * 0.9) * view.S, p.size * Math.max(0.8, u) * (0.7 + 0.3 * Math.min(1, k * 6)), { fill: p.color });
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  function shakeOffset() {
    fx.shakeOffset(view.S, shakeOff);
    if (fx.reduced) {
      shakeOff.x = 0;
      shakeOff.y = 0;
    }
  }

  function hudPlayers(g, c, field) {
    return g.roster.map((r) => ({
      c: r.c,
      name: nameOf(r.id, r),
      head: r.bot ? null : avatars.get(r.id),
      initial: initialOf(nameOf(r.id, r)),
      wins: g.wins[r.id] ?? 0,
      out: r.id in g.out,
      you: r.id === myId(),
    }));
  }

  function drawTitleScreen(dt) {
    relayout('title');
    const d = demo ?? (demo = makeDemo());
    const sim = d.sim;
    nBombers = 0;
    nBombs = 0;
    const runnerBots = d.core.runner.bots;
    for (const bot of runnerBots) {
      if (!sim.alive(bot.id)) continue;
      const r = d.core.roster.find((x) => x.id === bot.id);
      const vv = d.c.visOf(bot.id);
      followVis(vv, bot.body.x, bot.body.y, dt, bot.body.dir, bot.body.moving);
      const b = newBomber();
      b.x = vv.x;
      b.y = vv.y;
      b.dir = vv.dir;
      b.moving = vv.moving;
      b.walk = vv.walk;
      b.c = r.c;
      b.initial = initialOf(r.name);
      const s = sim.stats.get(bot.id);
      b.shield = s.h > 0;
    }
    for (const bm of sim.bombs) {
      const b = newBomb();
      b.x = bm.x + 0.5 + bm.dx * bm.pr;
      b.y = bm.y + 0.5 + bm.dy * bm.pr;
      b.phase = 1 - (bm.at - sim.t) / FUSE_MS;
      b.c = d.core.roster.find((x) => x.id === bm.o)?.c ?? 0;
      b.key = bm.id;
    }
    demoFx(d);
    drawBoard(sim, sim.t, MAP_ACCENT[d.core.map] ?? MAP_ACCENT.classic, { drift: true });
    ui.drawTitle(ctx, W, H, u, animT, Boolean(ow?.controls?.touch));
  }

  /** The title's blasts and breaking crates, quieter than the real thing. */
  function demoFx(d) {
    const c = d.c;
    const sim = d.sim;
    if (!c.prevCrates) {
      c.prevCrates = new Uint8Array(N);
      c.prevCrates.set(sim.crates);
    }
    for (const f of sim.fire) {
      const key = `${f.i}:${Math.round(f.from)}`;
      if (c.seen.fire.has(key)) continue;
      c.seen.fire.add(key);
      if (c.seen.fire.size > 500) c.seen.fire.clear();
      fx.sparks((f.i % COLS) + 0.5, Math.floor(f.i / COLS) + 0.5, 3, '#ffb43b', 3.2);
    }
    for (let i = 0; i < N; i++) {
      if (c.prevCrates[i] && !sim.crates[i]) {
        const x = (i % COLS) + 0.5;
        const y = Math.floor(i / COLS) + 0.5;
        fx.chips(x, y, 6, '#c79a5e');
        fx.smoke(x, y, 1, 0.2, '150,125,90');
      }
    }
    c.prevCrates.set(sim.crates);
  }

  function drawLobbyScreen(dt, mp) {
    relayout('lobby');
    const L = ensureLobby();
    const sim = L.sim;
    nBombers = 0;
    nBombs = 0;
    const id = myId();
    const players = [...room.players.values()];
    for (const p of players) {
      const mine = p.id === id;
      let x;
      let y;
      let dir = 2;
      let moving = 0;
      const v = lobbyVis(p.id);
      if (mine) {
        if (room.spectating) continue;
        x = lobbyMe.x;
        y = lobbyMe.y;
        dir = lobbyMe.dir;
        moving = lobbyMe.moving;
        v.walk = lobbyMe.walk;
        v.init = true;
        v.x = x;
        v.y = y;
        v.dir = dir;
        v.moving = moving;
      } else {
        const raw = readPresence(p.presence, 0);
        if (!raw) continue;
        const sm = room.presenceAt(p.id, { snap: 3 });
        x = clamp(Number.isFinite(sm?.x) ? sm.x : raw.x, 0.6, COLS - 0.6);
        y = clamp(Number.isFinite(sm?.y) ? sm.y : raw.y, 0.6, ROWS - 0.6);
        followVis(v, x, y, dt, raw.d, raw.w);
      }
      const b = newBomber();
      b.x = v.x;
      b.y = v.y;
      b.dir = v.dir;
      b.moving = v.moving;
      b.walk = v.walk;
      b.c = lobbyColor(p.id);
      const nm = nameOf(p.id);
      b.name = nm;
      b.initial = initialOf(nm);
      b.head = avatars.get(p.id);
      b.alpha = p.connected === false ? 0.5 : 1;
      b.ring = mine;
      b.arrow = mine && animT - (lobbyMe.born ?? 0) < 3.5;
      b.ready = Boolean(p.ready);
    }
    for (const bm of sim.bombs) {
      const b = newBomb();
      b.x = bm.x + 0.5;
      b.y = bm.y + 0.5;
      b.phase = 1 - (bm.at - sim.t) / FUSE_MS;
      b.c = lobbyColor(bm.o);
      b.key = bm.id;
    }
    drawBoard(sim, sim.t, MAP_ACCENT[L.map] ?? MAP_ACCENT.classic, { tags: true });
    if (mp === 'starting') drawCountdownScreen();
    else if (mp === 'playing') label(ctx, 'GET READY', W / 2, H * 0.4, Math.max(30, 56 * u));
    if (mp === 'lobby') {
      ui.drawLobbyTop(ctx, W, H, u, { wins: winsOf(room.settings.wins), map: mapOf(room.settings.map), editable: room.isHost }, animT);
      if (room.stub) ui.drawStart(ctx, W, H, u, animT);
      if (resultsG && performance.now() < resultsUntil) drawResultsCard(resultsG);
    }
    if (room.spectating && mp === 'playing') ui.drawWatching(ctx, W, H, u, 70);
  }

  const lobbyVisMap = new Map();
  function lobbyVis(id) {
    let v = lobbyVisMap.get(id);
    if (!v) {
      v = { x: 0, y: 0, init: false, walk: 0, moving: 0, movT: -1, dir: 2 };
      lobbyVisMap.set(id, v);
    }
    return v;
  }
  /** In the lobby a colour is a person's own: taken in the order they arrived, so no two are alike. */
  const lobbyColors = new Map();
  function lobbyColor(id) {
    if (!lobbyColors.has(id)) lobbyColors.set(id, lobbyColors.size % PLAYER_COLORS.length);
    return lobbyColors.get(id);
  }

  function drawCountdownScreen() {
    const startsAt = room.match.startsAt;
    if (!Number.isFinite(startsAt)) return;
    const left = (startsAt - nowMs()) / 1000;
    const n = Math.ceil(left);
    if (n >= 1 && n <= 3) {
      if (n !== lastCount) {
        lastCount = n;
        sound.tick();
      }
      ui.drawCountdown(ctx, W, H, u, n, 1 - (left - (n - 1)), fx.reduced);
    }
  }

  function roundPlace(g) {
    const ranked = ranking(g.roster.map((r) => r.id), g.wins, g.kos);
    return { ranked, places: places(ranked, g.wins, g.kos) };
  }

  function drawRound(g, c, dt) {
    const rt = room.matchNow() - g.t0;
    const field = fieldOf(g, c, rt);
    const t = field.t;
    relayout('play');
    const id = myId();
    collectBombs(g, c, field, t, animT);
    collectBombers(g, c, field, t, dt, true);
    const showPads = g.phase === 'banner' || (g.phase === 'play' && rt < 1600);
    drawBoard(field, t, MAP_ACCENT[g.map] ?? MAP_ACCENT.classic, { tags: true, danger: g.phase === 'play', pads: showPads ? padsOf(g) : null });
    // your life on the line: a red edge
    if (me && me.st === 0 && g.phase === 'play') {
      const i = tileOf(me.body);
      const warn = field.warned(t, scratch.warn);
      let a = 0;
      if (warn.includes(i)) a = 0.5;
      else if (danger.start[i] < Infinity && danger.start[i] - t < 700 && danger.start[i] - t > 0) a = 0.35;
      if (a) ui.drawVignette(ctx, W, H, a * (0.7 + 0.3 * Math.sin(animT * 14)));
    }
    // HUD
    const sd = field.sd;
    const clock = field.dropCount(t) > 0 || field.warned(t, scratch.warn).length > 0 || t >= sd[0] ? -1 : sd[0] - t;
    if (g.phase === 'banner' || g.phase === 'play' || g.phase === 'end') {
      const mine = me && me.st !== 2 ? statsOf(g, field, id, SH) : null;
      ui.drawHud(ctx, W, H, u, { round: g.rn, clock, players: hudPlayers(g, c, field), need: g.need, mine: mine ? { ...SH } : null, board: view }, animT);
    }
    if (room.spectating) ui.drawWatching(ctx, W, H, u, Math.round(66 * u));
    else if (me && me.st === 2 && g.phase !== 'score') ui.drawWatching(ctx, W, H, u, Math.round(66 * u), 'OUT');
    // the round's moments
    const now = room.matchNow();
    if (g.phase === 'banner') {
      const age = (now - (g.until - T.bannerMs)) / 1000;
      if (!c.flags.bannerSeen && age >= 0) {
        c.flags.bannerSeen = true;
        sound.banner();
      }
      if (age >= 0) ui.drawBanner(ctx, W, H, u, 'LAST ONE STANDING', `ROUND ${g.rn}`, age, T.bannerMs / 1000, fx.reduced);
      else if (g.rn === 1) ui.drawCountdown(ctx, W, H, u, 'GO!', now / T.openingMs, fx.reduced);
    } else if (g.phase === 'play') {
      if (!c.flags.playSeen) {
        c.flags.playSeen = true;
        if (g.rn > 1 || rt < 600) sound.pop();
      }
      if (rt < 650) ui.drawCountdown(ctx, W, H, u, 'GO!', rt / 650, fx.reduced);
    } else if (g.phase === 'end') {
      const age = (now - (g.until - T.endMs)) / 1000;
      if (!c.flags.endSeen) {
        c.flags.endSeen = true;
        const w = g.win ? g.roster.find((r) => r.id === g.win) : null;
        if (!w) sound.draw();
        else if (w.id === id) {
          sound.win();
          fx.confetti(7.5, 6, 40, 5, 9);
        } else sound.points();
        if (w && w.id === id) callout = { text: 'YOU WIN', sub: `ROUND ${g.rn}`, color: PLAYER_COLORS[w.c % 8].main, at: animT };
        else callout = { text: w ? `${nameOf(w.id, w).toUpperCase()} WINS` : 'DRAW', sub: w ? '' : `ROUND ${g.rn}`, color: w ? PLAYER_COLORS[w.c % 8].main : '#ffffff', at: animT };
      }
      void age;
    }
    if (g.phase === 'score') drawScoreScreen(g, c);
    if (callout && g.phase !== 'score') {
      const age = animT - callout.at;
      if (age < 1.9) ui.drawCallout(ctx, W, H, u, callout.text, callout.sub, age, callout.color, fx.reduced);
    }
    ui.drawFlash(ctx, W, H, fx.flash, fx.flashColor);
    void dt;
  }

  function drawScoreScreen(g, c) {
    const ids = g.roster.map((r) => r.id);
    const ranked = ranking(ids, g.wins, g.kos);
    const now = room.matchNow();
    if (!c.flags.scoreSeen) {
      c.flags.scoreSeen = true;
      sound.points();
    }
    const winner = g.win ? g.roster.find((r) => r.id === g.win) : null;
    const rows = ranked.map((rid) => {
      const r = g.roster.find((x) => x.id === rid);
      return { c: r.c, name: nameOf(rid, r), head: r.bot ? null : avatars.get(rid), initial: initialOf(nameOf(rid, r)), wins: g.wins[rid] ?? 0, you: rid === myId(), fresh: rid === g.win };
    });
    ui.drawScore(ctx, W, H, u, { rows, need: g.need, round: g.rn, winner: winner ? { name: nameOf(winner.id, winner).toUpperCase(), c: winner.c } : null, age: (now - (g.until - T.scoreMs)) / 1000 }, animT);
  }

  function podiumRows(g) {
    const ids = g.roster.map((r) => r.id);
    const ranked = ranking(ids, g.wins, g.kos);
    const pl = places(ranked, g.wins, g.kos);
    return ranked.map((rid, i) => {
      const r = g.roster.find((x) => x.id === rid);
      return { c: r.c, name: nameOf(rid, r), head: r.bot ? null : avatars.get(rid), initial: initialOf(nameOf(rid, r)), wins: g.wins[rid] ?? 0, place: pl[i], you: rid === myId() };
    });
  }

  function awardsFor(g) {
    const a = awardsOf(g.roster.map((r) => r.id), g.kos, g.ch);
    const nm = (rid) => (rid ? nameOf(rid, g.roster.find((r) => r.id === rid)) : null);
    return { kos: nm(a.kos), chain: nm(a.chain) };
  }

  function drawFinalScreen(g, dt) {
    const now = room.matchNow();
    const age = (now - (g.until - T.finalMs)) / 1000;
    if (finalFx !== g.mid) {
      finalFx = g.mid;
      sound.fanfare();
      fx.confetti(7.5, 4, 80, 6, 10);
    }
    if (fx.rnd() < dt * 4) fx.confetti(fx.r(2, 13), 0, 6, 2, 3);
    ui.drawPodium(ctx, W, H, u, { rows: podiumRows(g), awards: awardsFor(g), age }, animT, fx.reduced);
    const v = { ox: 0, oy: 0, S: 40, W, H };
    v.ox = (W - COLS * v.S) / 2;
    v.oy = H * 0.02;
    fx.draw(ctx, v);
  }

  function drawResultsCard(g) {
    const rows = podiumRows(g);
    ui.drawResultsCard(ctx, W, H, u, { rows, you: rows.find((r) => r.you) ?? null });
  }

  /** The match's end: stats, badges, the board. Once. */
  function onFinal(g) {
    if (finalFor === g.mid) return;
    finalFor = g.mid;
    const id = myId();
    if (!g.roster.some((r) => r.id === id)) return;
    const ranked = ranking(g.roster.map((r) => r.id), g.wins, g.kos);
    const pl = places(ranked, g.wins, g.kos);
    const won = pl[ranked.indexOf(id)] === 1 && (g.wins[id] ?? 0) > 0;
    stats = {
      matches: stats.matches + 1,
      wins: stats.wins + (won ? 1 : 0),
      rounds: stats.rounds + g.rn,
      kos: stats.kos + (g.kos[id] ?? 0),
      chain: Math.max(stats.chain, g.ch[id] ?? 0),
    };
    try {
      ow?.save?.set('stats', stats)?.catch?.(() => {});
    } catch {
      // ignore
    }
    if (won) {
      award('first-win');
      try {
        ow?.leaderboards?.submit('wins', stats.wins)?.catch?.(() => {});
      } catch {
        // guests have no leaderboard
      }
    }
  }

  // ---------------------------------------------------------------- the frame
  function frame(ts) {
    requestAnimationFrame(frame);
    const dt = clamp((ts - (lastTs || ts)) / 1000, 0, 0.1);
    lastTs = ts;
    animT = ts / 1000;
    try {
      fx.reduced = Boolean(ow?.settings?.reducedMotion);
      const q = ow?.settings ? (ow.settings.quality === 'low' ? 0 : ow.settings.quality === 'medium' ? 1 : 2) : 2;
      fx.quality = q;
      view.quality = q;
    } catch {
      // keep the last settings
    }
    try {
      simFrame(dt);
      fx.update(dt);
      draw(dt);
    } catch (err) {
      if (errors++ < 5) console.error('[bomb-maze-battle]', err);
      try {
        ctx.setTransform(pr, 0, 0, pr, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      } catch {
        // nothing more to do
      }
    }
  }

  function draw(dt) {
    const mp = room.match.phase;
    const g = mp === 'playing' ? readG(room) : null;
    syncControls(g);
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#070a12';
    ctx.fillRect(0, 0, W, H);
    ui.clearHits();
    let field = null;
    if (titleOpen) {
      drawTitleScreen(dt);
    } else if (mp === 'playing' && g && g.phase === 'final') {
      lastFinalG = g;
      onFinal(g);
      drawFinalScreen(g, dt);
    } else if (mp === 'playing' && g && rc && rc.rid === g.rid) {
      field = fieldOf(g, rc, room.matchNow() - g.t0);
      drawRound(g, rc, dt);
    } else {
      drawLobbyScreen(dt, mp);
    }
    syncMusic(g, field);
    if (needTap && !titleOpen) ui.drawTapHint(ctx, W, H, u, animT);
  }

  requestAnimationFrame(frame);
}
