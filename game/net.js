// The room: the shared record of the match (`g`), the host's page that runs the rounds, and a stand-alone stub room.
//
//   - One record per match, written only by the host: `g` = { mid, by, need, map, rn, rid, phase, until, t0, seed, roster, wins, kos, ch,
//     win, + the world: cr (crates), bombs, fire, items, pl (everyone's stats), out, sd }. Pages derive what to draw from
//     `room.match.phase` plus `g`; a `g` of another match is stale.
//   - Deadlines are match-clock values (`room.matchNow()`), so a pause and a change of host keep them. The host's page steps the world
//     every frame (and from a 100 ms ticker) and only acts when it is the host, the match is running and `g.by` is itself; `adopt()`
//     takes a record over after a reload or a new host.
//   - Bombs belong to the host: a page asks (`bomb`), the host checks and places it. A page decides its own knock-out (`out`) and its
//     own pick-ups (`take`), the host checks them; the host decides for bots and for anyone standing in a blast who says nothing.
//   - Everything read from the room is validated: it comes from other people's browsers.

import { N, COLS, ROWS, T, MAX_PLAYERS, MAP_IDS, ITEM_KINDS, BADGES, isNum, isMap, winsOf, mapOf, roundCap } from './rules.js';
import { MatchCore } from './match.js';

// ------------------------------------------------------------------ the record
const PHASES = new Set(['banner', 'play', 'end', 'score', 'final']);
let cachedRaw = null;
let cachedMid = null;
let cachedOk = null;

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const numList = (a, len) => Array.isArray(a) && a.length >= len[0] && a.length <= len[1] && a.every((v) => isNum(v, -1e13, 1e13));

function checkG(g, mid) {
  if (!isMap(g) || g.mid !== mid || typeof g.by !== 'string' || typeof g.rid !== 'string' || !PHASES.has(g.phase)) return null;
  if (!isInt(g.need, 1, 9) || !MAP_IDS.includes(g.map) || !isInt(g.rn, 1, 99) || !isNum(g.until, 0, 1e12) || !isNum(g.t0, 0, 1e12) || !isNum(g.seed, 0, 4294967296)) return null;
  if (!Array.isArray(g.roster) || g.roster.length < 1 || g.roster.length > MAX_PLAYERS) return null;
  const ids = new Set();
  for (const r of g.roster) {
    if (!isMap(r) || typeof r.id !== 'string' || r.id.length > 80 || ids.has(r.id) || (r.bot !== 0 && r.bot !== 1) || !isInt(r.c, 0, 7)) return null;
    if (r.bot && (typeof r.name !== 'string' || r.name.length > 14)) return null;
    ids.add(r.id);
  }
  for (const key of ['wins', 'kos', 'ch', 'out']) {
    if (!isMap(g[key])) return null;
    for (const v of Object.values(g[key])) if (!isNum(v, 0, 1e9)) return null;
  }
  if (typeof g.win !== 'string' || g.win.length > 80) return null;
  if (typeof g.cr !== 'string' || g.cr.length !== Math.ceil(N / 4) || !/^[0-9a-f]+$/.test(g.cr)) return null;
  if (!Array.isArray(g.bombs) || g.bombs.length > 80) return null;
  for (const b of g.bombs) {
    if (!numList(b, [7, 9]) || !isInt(b[0], 1, COLS - 2) || !isInt(b[1], 1, ROWS - 2) || !isInt(b[2], 0, g.roster.length - 1) || !isInt(b[4], 1, 20) || !isInt(b[6], 0, 1e9)) return null;
  }
  if (!Array.isArray(g.fire) || g.fire.length > 500) return null;
  for (const f of g.fire) if (!numList(f, [2, 2]) || !isInt(f[0], 0, N - 1)) return null;
  if (!Array.isArray(g.items) || g.items.length > 150) return null;
  for (const it of g.items) if (!numList(it, [2, 2]) || !isInt(it[0], 0, N - 1) || !isInt(it[1], 0, ITEM_KINDS.length - 1)) return null;
  if (!isMap(g.pl)) return null;
  for (const [id, a] of Object.entries(g.pl)) if (!ids.has(id) || !numList(a, [7, 7])) return null;
  if (!numList(g.sd, [3, 3])) return null;
  return g;
}

/** The match's record if it is this match's and well formed, else null. */
export function readG(room) {
  const raw = room.state.g;
  if (raw === cachedRaw && room.match.id === cachedMid) return cachedOk;
  cachedRaw = raw;
  cachedMid = room.match.id;
  cachedOk = checkG(raw, room.match.id);
  return cachedOk;
}

/** Another player's presence, if it is well formed and from this round. */
export function readPresence(p, rn) {
  if (!isMap(p) || p.r !== rn || !isNum(p.x, 0, COLS) || !isNum(p.y, 0, ROWS)) return null;
  return { x: p.x, y: p.y, d: isInt(p.d, 0, 3) ? p.d : 2, w: p.w ? 1 : 0, s: p.s === 2 ? 2 : 0 };
}

/** The bots' snapshot `b`, if well formed for this round. */
export function readBots(b, rid) {
  if (!isMap(b) || b.rid !== rid || !isNum(b.t, -1e9, 1e9) || !Array.isArray(b.p) || b.p.length > MAX_PLAYERS) return null;
  for (const p of b.p) if (!numList(p, [4, 4])) return null;
  if (b.k !== undefined && (!Array.isArray(b.k) || b.k.length > 12 || b.k.some((k) => !numList(k, [3, 3])))) return null;
  return b;
}

const r2 = (v) => Math.round(v * 100) / 100;

// ------------------------------------------------------------------ the host
export class Host {
  /** `game`: { nowMs() (wall clock, ms), selfBody() -> the host player's own { x, y } or null, onBadge(id) }. */
  constructor(room, game) {
    this.room = room;
    this.game = game;
    this.core = null;
    this.lastFlush = -1e9;
    this.lastBots = -1e9;
    this.lastEnd = -1e9;
    this.lastBomb = new Map();
  }

  get g() {
    return readG(this.room);
  }
  get meId() {
    return this.room.me.id;
  }
  get acting() {
    return this.room.isHost && this.room.running;
  }

  put(g, patch) {
    this.room.setState('g', { ...g, ...patch });
  }

  // ---------------------------------------------------------------- lifecycle
  startMatch() {
    const room = this.room;
    const humans = (room.match.participants ?? []).filter((id) => typeof id === 'string');
    this.core = new MatchCore({ humans, seed: room.match.seed, need: winsOf(room.settings.wins), map: mapOf(room.settings.map) });
    this.lastBomb.clear();
    this.beginRound();
  }

  /** Builds the next round and writes it: a banner, then play. */
  beginRound() {
    const room = this.room;
    const core = this.core;
    core.beginRound();
    const t0 = room.matchNow() + T.bannerMs + (core.n === 1 ? T.openingMs : 0); // the first round has a GO of its own before the banner
    room.setState('b', null);
    this.lastFlush = -1e9;
    const g = {
      mid: room.match.id,
      by: this.meId,
      need: core.need,
      map: core.map,
      rn: core.n,
      rid: `${room.match.id}.${core.n}`,
      phase: 'banner',
      until: t0,
      t0,
      seed: core.rseed,
      roster: core.roster.map((r) => (r.bot ? { id: r.id, bot: 1, c: r.c, name: r.name } : { id: r.id, bot: 0, c: r.c })),
      wins: { ...core.wins },
      kos: { ...core.kos },
      ch: { ...core.chain },
      win: '',
      ...core.sim.record(),
    };
    core.sim.dirty = false;
    room.setState('g', g);
  }

  /** Carry on as the host, from the room's copy. Safe to call again and again (a match start, a new host, a reconnect). */
  adopt() {
    const room = this.room;
    if (!room.isHost || !room.running) return;
    const g = this.g;
    if (!g) return this.startMatch();
    if (g.by === this.meId && this.core) return;
    const core = new MatchCore({ roster: g.roster, seed: room.match.seed, need: g.need, map: g.map });
    core.wins = { ...core.wins, ...g.wins };
    core.kos = { ...core.kos, ...g.kos };
    core.chain = { ...core.chain, ...g.ch };
    this.core = core;
    this.lastBomb.clear();
    const now = room.matchNow();
    if (g.phase === 'banner') {
      core.n = g.rn - 1;
      core.beginRound();
    } else if (g.phase === 'play' || g.phase === 'end') {
      const snap = room.state.b && room.state.b.rid === g.rid && Array.isArray(room.state.b.p) ? room.state.b.p : null;
      core.n = g.rn;
      core.adoptRound(g, now - g.t0, snap);
      if (g.phase === 'end') core.result = { winner: g.win || null };
    } else core.n = g.rn;
    this.put(g, { by: this.meId });
  }

  /** Steps the world and the phases. Call every frame and from a ticker (it is safe to call as often as you like). */
  pump() {
    if (!this.acting) return;
    const g = this.g;
    const core = this.core;
    if (!g || g.by !== this.meId || !core) return;
    const room = this.room;
    const now = room.matchNow();
    switch (g.phase) {
      case 'banner':
        if (now >= g.until) this.put(g, { phase: 'play', until: 0 });
        break;
      case 'play': {
        this.runWorld(g, now);
        if (core.result) this.endRound(g, now);
        break;
      }
      case 'end':
        this.runWorld(g, now);
        if (now >= g.until) this.put(g, { phase: 'score', until: now + T.scoreMs });
        break;
      case 'score':
        if (now >= g.until) {
          const over = core.ids.some((id) => (g.wins[id] ?? 0) >= g.need) || g.rn >= roundCap(g.need);
          if (over) this.put(g, { phase: 'final', until: now + T.finalMs });
          else this.beginRound();
        }
        break;
      case 'final':
        if (now >= g.until && this.game.nowMs() - this.lastEnd > 2500) {
          this.lastEnd = this.game.nowMs();
          room.endMatch(); // back to the platform's lobby, ready flags cleared
        }
        break;
      default:
    }
  }

  /** Where the people are, as far as the host can tell (their own page's presence). */
  syncBodies(g) {
    const sim = this.core.sim;
    if (!sim) return;
    for (const r of g.roster) {
      if (r.bot) continue;
      if (r.id === this.meId) {
        const b = this.game.selfBody?.();
        if (b && Number.isFinite(b.x) && Number.isFinite(b.y)) sim.bodies.set(r.id, { x: b.x, y: b.y });
        continue;
      }
      const p = readPresence(this.room.players.get(r.id)?.presence, g.rn);
      if (p) sim.bodies.set(r.id, { x: p.x, y: p.y });
    }
  }

  runWorld(g, now) {
    const core = this.core;
    const sim = core.sim;
    if (!sim) return;
    this.syncBodies(g);
    core.advance(now - g.t0);
    for (const e of core.takeEvents()) {
      if (e.k === 'triple') this.badge(e.id, 'triple-trap');
      else if (e.k === 'chain' && e.n >= 4) this.badge(e.id, 'chain-reaction');
    }
    this.flush(g, false);
    this.publishBots(g);
  }

  /** The world's changes go into `g`, at most about 18 times a second. */
  flush(g, force) {
    const sim = this.core?.sim;
    if (!sim || !sim.dirty) return;
    const wall = this.game.nowMs();
    if (!force && wall - this.lastFlush < 55) return;
    this.lastFlush = wall;
    sim.dirty = false;
    this.put(this.g ?? g, sim.record());
  }

  endRound(g, now) {
    const core = this.core;
    const winner = core.result.winner;
    const sim = core.sim;
    const { winner: w } = core.finishRound();
    if (w && !core.roster.find((r) => r.id === w)?.bot && (sim.took.get(w) ?? 0) === 0) this.badge(w, 'untouched');
    sim.dirty = false;
    this.put(this.g ?? g, { ...sim.record(), phase: 'end', until: now + T.endMs, win: winner ?? '', wins: { ...core.wins }, kos: { ...core.kos }, ch: { ...core.chain } });
  }

  badge(id, name) {
    if (!BADGES.has(name)) return;
    if (id === this.meId) this.game.onBadge?.(name);
    else if (!this.core?.roster.find((r) => r.id === id)?.bot) this.room.send({ t: 'badge', b: name }, { to: id });
  }

  // ---------------------------------------------------------------- what players ask for
  /** A message from another page (or the host's own page, with `from` its own id). It says what happened to that player, and only that. */
  onMessage(d, from) {
    if (!this.acting || !isMap(d) || typeof d.rid !== 'string' || !from || typeof from.id !== 'string') return false;
    const g = this.g;
    if (!g || g.by !== this.meId || !this.core?.sim || d.rid !== g.rid || (g.phase !== 'play' && g.phase !== 'end')) return false;
    const entry = g.roster.find((r) => r.id === from.id);
    if (!entry || entry.bot) return false;
    const sim = this.core.sim;
    const id = from.id;
    const near = (x, y, slack) => {
      const p = id === this.meId ? this.game.selfBody?.() : readPresence(this.room.players.get(id)?.presence, g.rn);
      return Boolean(p) && Math.abs(p.x - (x + 0.5)) <= slack && Math.abs(p.y - (y + 0.5)) <= slack;
    };
    if (d.t === 'bomb') {
      if (g.phase !== 'play' || !isInt(d.x, 1, COLS - 2) || !isInt(d.y, 1, ROWS - 2)) return false;
      const wall = this.game.nowMs();
      const quick = wall - (this.lastBomb.get(id) ?? -1e9) < 90; // a held button, or a script
      this.lastBomb.set(id, wall);
      const ok = !quick && near(d.x, d.y, 1.7) && sim.placeBomb(id, d.x, d.y);
      if (!ok && id !== this.meId) this.room.send({ t: 'no', rid: g.rid, x: d.x, y: d.y }, { to: id });
      if (ok) this.flush(g, true);
      return Boolean(ok);
    }
    if (d.t === 'out') {
      if (!isInt(d.f, 0, N - 1)) return false;
      const res = sim.claimOut(id, d.f);
      if (res !== 'no') this.flush(g, true);
      return res === 'out' || res === 'shield';
    }
    if (d.t === 'take') {
      if (!isInt(d.i, 0, N - 1)) return false;
      const kind = sim.takeItem(id, d.i);
      if (kind) this.flush(g, true);
      return Boolean(kind);
    }
    if (d.t === 'kick') {
      if (!isInt(d.x, 1, COLS - 2) || !isInt(d.y, 1, ROWS - 2) || !isInt(d.dx, -1, 1) || !isInt(d.dy, -1, 1)) return false;
      if (!near(d.x, d.y, 1.8)) return false;
      const ok = sim.kickBomb(id, d.x, d.y, d.dx, d.dy);
      if (ok) this.flush(g, true);
      return ok;
    }
    return false;
  }

  // ---------------------------------------------------------------- the bots, seen from the other pages
  /** Share the bots' positions (and kicked bombs on the move) about 12 times a second. */
  publishBots(g) {
    const core = this.core;
    const sim = core?.sim;
    if (!sim || !core.runner) return;
    const wall = this.game.nowMs();
    if (wall - this.lastBots < 80) return;
    const moving = sim.bombs.filter((b) => b.dx !== 0 || b.dy !== 0);
    if (core.runner.bots.length === 0 && moving.length === 0) return;
    this.lastBots = wall;
    this.room.setState('b', {
      rid: g.rid,
      t: Math.round(sim.t),
      p: core.runner.bots.map((b) => [r2(b.body.x), r2(b.body.y), b.body.dir, b.body.moving ? 1 : 0]),
      k: moving.map((b) => [b.id, r2(b.x + 0.5 + b.dx * b.pr), r2(b.y + 0.5 + b.dy * b.pr)]),
    });
  }
}

// ------------------------------------------------------------------ outside the platform
/** A room with nobody else in it, for when the page is opened on its own: it keeps a match the way the platform's rooms do. */
export function createStubRoom() {
  const listeners = new Map();
  const emit = (e, ...a) => {
    for (const f of listeners.get(e) ?? []) {
      try {
        f(...a);
      } catch (err) {
        console.error(err);
      }
    }
  };
  const me = { id: 'me', name: 'You', presence: null, team: 0 };
  let timer = 0;
  const room = {
    stub: true,
    me,
    players: new Map([['me', me]]),
    host: 'me',
    kind: 'solo',
    connected: true,
    state: {},
    match: { phase: 'lobby', n: 0, min: 1 },
    settings: { wins: 3, map: 'classic' },
    isHost: true,
    get online() {
      return [me];
    },
    get participants() {
      return this.match.phase === 'lobby' ? [] : [me];
    },
    spectating: false,
    get running() {
      return this.match.phase === 'playing';
    },
    matchNow() {
      return this.match.phase === 'playing' ? Date.now() - this.match.startedAt : 0;
    },
    isParticipant() {
      return this.match.phase !== 'lobby';
    },
    setReady() {},
    clearReady() {},
    hideLobby() {},
    send() {},
    admit() {},
    privateOf() {
      return {};
    },
    setState(k, v) {
      if (v === null || v === undefined) delete this.state[k];
      else this.state[k] = v;
    },
    setPresence(d) {
      me.presence = d;
    },
    presenceAt(id) {
      return id === 'me' ? me.presence : null;
    },
    setSetting(id, v) {
      if (this.match.phase === 'lobby') this.settings = { ...this.settings, [id]: v };
    },
    on(e, f) {
      if (!listeners.has(e)) listeners.set(e, new Set());
      listeners.get(e).add(f);
      return () => listeners.get(e).delete(f);
    },
    startMatch() {
      if (this.match.phase !== 'lobby') return;
      const n = this.match.n + 1;
      const prev = this.match;
      this.match = { phase: 'starting', n, min: 1, id: `solo${n}`, seed: Math.floor(Math.random() * 4294967296), participants: ['me'], startsAt: Date.now() + 3000 };
      emit('match', this.match, prev);
      emit('starting', this.match);
      timer = setTimeout(() => {
        const before = this.match;
        const { startsAt, ...rest } = before;
        this.match = { ...rest, phase: 'playing', startedAt: Date.now() };
        emit('match', this.match, before);
        emit('matchstart', this.match);
      }, 3000);
    },
    endMatch() {
      clearTimeout(timer);
      if (this.match.phase === 'lobby') return;
      const before = this.match;
      this.match = { phase: 'lobby', n: before.n, min: 1 };
      this.state = {};
      emit('match', this.match, before);
      emit('matchend', this.match, before);
    },
  };
  return room;
}
