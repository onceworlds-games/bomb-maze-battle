// The world of a round: crates, bombs, blasts, power-ups, sudden death and who is still standing.
//
//   - `Field` is the board as a page sees it (built from the host's record `g`).
//   - `Sim` is the host's authoritative copy: it places and kicks bombs, sets them off (chains included), breaks crates, drops power-ups,
//     keeps everyone's stats, runs sudden death and decides knock-outs (bots and anyone who stood in a blast without saying so by
//     themselves, humans from their own claim). Pure: tests run whole rounds of it.
//
// Times are round time in ms (`t`). Everything is stepped at a fixed 60 Hz by `tick()`.

import {
  COLS,
  ROWS,
  N,
  idx,
  tileX,
  tileY,
  inside,
  layoutOf,
  makeCrates,
  encodeBits,
  decodeBits,
  rollItem,
  mulberry32,
  ITEM_KINDS,
  START_STATS,
  CAPS,
  FUSE_MS,
  BLAST_MS,
  SLIDE_SPEED,
  SD_AT_MS,
  SD_STEP_MS,
  SD_FAST_STEP_MS,
  SD_WARN_MS,
  INV_MS,
  HOST_GRACE_MS,
  CLAIM_GRACE_MS,
  STEP_MS,
} from './rules.js';
import { overlapsTile } from './move.js';

export const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** What a blast from `bomb` burns: its tiles, the crates it breaks and the other bombs it reaches (it stops at each of those). */
export function blastOf(field, bomb, bombs, t) {
  const tiles = [idx(bomb.x, bomb.y)];
  const crates = [];
  const hit = [];
  for (const [dx, dy] of DIRS) {
    for (let k = 1; k <= bomb.r; k++) {
      const x = bomb.x + dx * k;
      const y = bomb.y + dy * k;
      if (!inside(x, y)) break;
      const i = idx(x, y);
      if (field.wallAt(i, t)) break;
      tiles.push(i);
      if (field.crates[i]) {
        crates.push(i);
        if (!bomb.p) break;
        continue;
      }
      const other = bombs.find((b) => b !== bomb && b.x === x && b.y === y);
      if (other) {
        hit.push(other);
        break;
      }
    }
  }
  return { tiles, crates, hit };
}

export class Field {
  constructor(map) {
    const L = layoutOf(map);
    this.map = L.id;
    this.pillars = L.pillars;
    this.order = L.order;
    this.rank = L.rank;
    this.open = L.open;
    this.crates = new Uint8Array(N);
    this.bombs = []; // { id, x, y, o (owner id), at, r, p (pierce), dx, dy, pr (slide progress 0..1) }
    this.fire = []; // { i, from, cid }
    this.items = []; // { i, k, born }
    this.sd = [SD_AT_MS, SD_STEP_MS, 0]; // sudden death: [first drop at, ms between drops, tiles already dropped]
    this.t = 0;
  }

  /** How many tiles sudden death has dropped by `t`. */
  dropCount(t = this.t) {
    const [at, step, base] = this.sd;
    const n = this.order.length;
    if (!(t >= at)) return Math.min(base, n);
    return Math.min(n, base + Math.floor((t - at) / step) + 1);
  }

  /** When the k-th tile of the spiral drops (for k at or beyond what has already dropped). */
  dropTime(k) {
    const [at, step, base] = this.sd;
    return at + (k - base) * step;
  }

  /** Tiles that drop within the warning window (outlined on the floor). */
  warned(t = this.t, out = []) {
    out.length = 0;
    const n = this.dropCount(t);
    for (let k = n; k < this.order.length && k < n + 8; k++) {
      if (this.dropTime(k) - SD_WARN_MS <= t) out.push(this.order[k]);
      else break;
    }
    return out;
  }

  crushedBy(i, t = this.t) {
    const r = this.rank[i];
    return r >= 0 && r < this.dropCount(t);
  }
  wallAt(i, t = this.t) {
    return this.pillars[i] === 1 || this.crushedBy(i, t);
  }
  blockedAt(i, t = this.t) {
    return this.wallAt(i, t) || this.crates[i] === 1;
  }
  bombAt(x, y) {
    for (const b of this.bombs) if (b.x === x && b.y === y) return b;
    return null;
  }
  itemAt(i) {
    for (const it of this.items) if (it.i === i) return it;
    return null;
  }
  fireOn(i, t = this.t) {
    for (const f of this.fire) if (f.i === i && f.from <= t && t < f.from + BLAST_MS) return f;
    return null;
  }
  /** Marks the tiles burning at `t` in `out` (a Uint8Array of N). */
  fireMap(t, out) {
    out.fill(0);
    for (const f of this.fire) if (f.from <= t && t < f.from + BLAST_MS) out[f.i] = 1;
    return out;
  }
  ownedBombs(id) {
    let n = 0;
    for (const b of this.bombs) if (b.o === id) n++;
    return n;
  }

  /** The tile code a bomber with these bombs-to-pass sees: 0 free, 1 wall or crate, 2 bomb. */
  codeAt(tx, ty, pass, t = this.t) {
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return 1;
    const i = idx(tx, ty);
    if (this.blockedAt(i, t)) return 1;
    if (this.bombAt(tx, ty) && !(pass && pass.includes(i))) return 2;
    return 0;
  }
}

/** The board from the host's record (already checked by `readG`). */
export function fieldFromRecord(g) {
  const f = new Field(g.map);
  const cr = decodeBits(g.cr);
  if (cr) f.crates = cr;
  const ids = g.roster.map((r) => r.id);
  f.bombs = (g.bombs ?? []).map((a) => ({ x: a[0], y: a[1], o: ids[a[2]] ?? '', at: a[3], r: a[4], p: a[5], id: a[6], dx: a[7] | 0, dy: a[8] | 0, pr: 0 }));
  f.fire = (g.fire ?? []).map((a) => ({ i: a[0], from: a[1], cid: 0 }));
  f.items = (g.items ?? []).map((a) => ({ i: a[0], k: ITEM_KINDS[a[1]], born: 0 }));
  f.sd = g.sd ? [g.sd[0], g.sd[1], g.sd[2]] : [SD_AT_MS, SD_STEP_MS, 0];
  return f;
}

export class Sim extends Field {
  /**
   * `roster`: [{ id, bot }]. `crates`: a Uint8Array (else made from the seed). `practice`: nobody can be hurt and there is no sudden
   * death (the lobby's arena and the title's demo).
   */
  constructor({ map, seed, roster, crates, practice = false }) {
    super(map);
    this.seed = seed >>> 0;
    this.rng = mulberry32((seed >>> 0) ^ 0x5eed5eed);
    this.roster = roster.map((r) => ({ id: r.id, bot: r.bot ? 1 : 0 }));
    this.index = new Map(this.roster.map((r, i) => [r.id, i]));
    this.practice = practice;
    this.crates = crates ? Uint8Array.from(crates) : makeCrates(map, seed, roster.length);
    this.stats = new Map();
    this.out = new Map(); // id -> round time of the knock-out
    this.took = new Map(); // id -> power-ups picked up this round
    this.kos = new Map(); // id -> knock-outs this round
    this.chainBest = new Map(); // id -> the biggest chain they set off this round
    this.bodies = new Map(); // id -> { x, y } (bots: the full body)
    this.chains = new Map(); // cid -> { own, kos, n, at }
    this.crushedAt = new Float64Array(N).fill(-1e12);
    this.nextBomb = 1;
    this.nextCid = 1;
    this.events = [];
    this.dirty = true;
    this.dropDone = 0;
    for (const r of this.roster) {
      this.stats.set(r.id, { ...START_STATS, inv: 0 });
      this.took.set(r.id, 0);
      this.kos.set(r.id, 0);
      this.chainBest.set(r.id, 0);
    }
    if (practice) {
      this.sd = [Infinity, SD_STEP_MS, 0];
      for (const s of this.stats.values()) s.b = 2;
    }
  }

  alive(id) {
    return this.stats.has(id) && !this.out.has(id);
  }
  aliveIds() {
    return this.roster.filter((r) => !this.out.has(r.id)).map((r) => r.id);
  }

  // ------------------------------------------------------------ what players ask for
  placeBomb(id, x, y) {
    const s = this.stats.get(id);
    if (!s || this.out.has(id) || !Number.isInteger(x) || !Number.isInteger(y) || !inside(x, y) || !(this.t >= 0)) return null;
    const i = idx(x, y);
    if (this.blockedAt(i) || this.bombAt(x, y) || this.fireOn(i)) return null;
    if (this.ownedBombs(id) >= s.b) return null;
    const bomb = { id: this.nextBomb++, x, y, o: id, at: this.t + FUSE_MS, r: s.r, p: s.p, dx: 0, dy: 0, pr: 0 };
    this.bombs.push(bomb);
    for (const bd of this.bodies.values()) if (bd.pass && overlapsTile(bd, i)) bd.pass.push(i);
    this.dirty = true;
    this.events.push({ k: 'place', id, bomb });
    return bomb;
  }

  kickBomb(id, x, y, dx, dy) {
    const s = this.stats.get(id);
    if (!s || !s.k || this.out.has(id)) return false;
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(dx) || !Number.isInteger(dy)) return false;
    if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
    const b = this.bombAt(x, y);
    if (!b || b.dx || b.dy) return false;
    if (!this.slideFree(x + dx, y + dy)) return false;
    b.dx = dx;
    b.dy = dy;
    b.pr = 0;
    this.dirty = true;
    this.events.push({ k: 'kick', id, bomb: b });
    return true;
  }

  takeItem(id, i) {
    const s = this.stats.get(id);
    if (!s || this.out.has(id) || !Number.isInteger(i) || i < 0 || i >= N) return null;
    const bd = this.bodies.get(id);
    if (bd && (Math.abs(Math.floor(bd.x) - tileX(i)) > 2 || Math.abs(Math.floor(bd.y) - tileY(i)) > 2)) return null;
    const at = this.items.findIndex((it) => it.i === i);
    if (at < 0) return null;
    const kind = this.items[at].k;
    this.items.splice(at, 1);
    if (kind === 'b') s.b = Math.min(CAPS.b, s.b + 1);
    else if (kind === 'r') s.r = Math.min(CAPS.r, s.r + 1);
    else if (kind === 's') s.s = Math.min(CAPS.s, s.s + 1);
    else if (kind === 'k') s.k = 1;
    else if (kind === 'p') s.p = 1;
    else if (kind === 'h') s.h = 1;
    this.took.set(id, (this.took.get(id) ?? 0) + 1);
    this.dirty = true;
    this.events.push({ k: 'take', id, kind, i });
    return kind;
  }

  /** A player's page says a blast (or a dropped pillar) got them. `f` is the tile it was. Returns 'out', 'shield', 'inv' or 'no'. */
  claimOut(id, f) {
    if (this.practice || !this.stats.has(id) || this.out.has(id) || !Number.isInteger(f) || f < 0 || f >= N) return 'no';
    const bd = this.bodies.get(id);
    if (bd && (Math.abs(Math.floor(bd.x) - tileX(f)) > 2 || Math.abs(Math.floor(bd.y) - tileY(f)) > 2)) return 'no';
    for (const e of this.fire) if (e.i === f && e.from <= this.t && this.t <= e.from + BLAST_MS + CLAIM_GRACE_MS) return this.hit(id, e);
    if (this.crushedBy(f) && this.t - this.crushedAt[f] <= 1500) return this.kill(id, null);
    return 'no';
  }

  /** Someone in a blast: a shield soaks it, a moment of invulnerability follows, otherwise they are out. */
  hit(id, entry) {
    const s = this.stats.get(id);
    if (!s || this.out.has(id) || this.practice) return 'no';
    if (this.t < s.inv) return 'inv';
    if (s.h > 0) {
      s.h = 0;
      s.inv = this.t + INV_MS;
      this.dirty = true;
      this.events.push({ k: 'shield', id });
      return 'shield';
    }
    return this.kill(id, entry);
  }

  kill(id, entry) {
    if (this.out.has(id) || this.practice) return 'no';
    this.out.set(id, Math.round(this.t));
    const ch = entry && entry.cid ? this.chains.get(entry.cid) : null;
    let by = null;
    if (ch && ch.own !== id) {
      by = ch.own;
      ch.kos++;
      this.kos.set(ch.own, (this.kos.get(ch.own) ?? 0) + 1);
      if (ch.kos === 3) this.events.push({ k: 'triple', id: ch.own });
    }
    this.dirty = true;
    this.events.push({ k: 'out', id, by, own: ch ? ch.own : null });
    return 'out';
  }

  /** All humans are out: the walls close in at once, faster. */
  speedUpSuddenDeath() {
    if (this.practice || this.sd[1] <= SD_FAST_STEP_MS) return;
    const t = this.t;
    const [at, , base] = this.sd;
    if (t < at) {
      if (t + 2500 < at) this.sd = [t + 2500, SD_FAST_STEP_MS, base];
      else this.sd = [at, SD_FAST_STEP_MS, base];
    } else this.sd = [t + SD_WARN_MS, SD_FAST_STEP_MS, this.dropCount(t)];
    this.dirty = true;
  }

  // ------------------------------------------------------------ time
  slideFree(x, y) {
    if (!inside(x, y)) return false;
    const i = idx(x, y);
    if (this.blockedAt(i) || this.bombAt(x, y)) return false;
    for (const r of this.roster) {
      if (this.out.has(r.id)) continue;
      const bd = this.bodies.get(r.id);
      if (bd && Math.floor(bd.x) === x && Math.floor(bd.y) === y) return false;
    }
    return true;
  }

  slide(b) {
    const dt = STEP_MS / 1000;
    if (b.pr === 0 && !this.slideFree(b.x + b.dx, b.y + b.dy)) {
      b.dx = 0;
      b.dy = 0;
      this.dirty = true;
      return;
    }
    b.pr += SLIDE_SPEED * dt;
    while (b.pr >= 1) {
      b.x += b.dx;
      b.y += b.dy;
      b.pr -= 1;
      if (!this.slideFree(b.x + b.dx, b.y + b.dy)) {
        b.pr = 0;
        b.dx = 0;
        b.dy = 0;
        this.dirty = true;
        return;
      }
    }
  }

  /** Sets off bombs (and every bomb their blasts reach, at once). All blasts of one step see the same crates. */
  explode(starts) {
    const t = this.t;
    const gone = new Set();
    const burned = new Map();
    const crateHits = new Set();
    for (const s of starts) {
      if (gone.has(s)) continue;
      const cid = this.nextCid++;
      const queue = [s];
      gone.add(s);
      let n = 0;
      while (queue.length) {
        const b = queue.shift();
        n++;
        const bl = blastOf(this, b, this.bombs, t);
        for (const i of bl.tiles) if (!burned.has(i)) burned.set(i, cid);
        for (const i of bl.crates) crateHits.add(i);
        for (const o of bl.hit) {
          if (gone.has(o)) continue;
          gone.add(o);
          queue.push(o);
        }
      }
      this.chains.set(cid, { own: s.o, kos: 0, n, at: t });
      if (n > (this.chainBest.get(s.o) ?? 0)) this.chainBest.set(s.o, n);
      this.events.push({ k: 'chain', id: s.o, n });
    }
    this.bombs = this.bombs.filter((b) => !gone.has(b));
    for (const [i, cid] of burned) this.fire.push({ i, from: t, cid });
    this.items = this.items.filter((it) => !burned.has(it.i));
    for (const i of crateHits) {
      this.crates[i] = 0;
      const kind = rollItem(this.rng);
      if (kind) this.items.push({ i, k: kind, born: t });
    }
    this.dirty = true;
    this.events.push({ k: 'boom', bombs: gone.size, tiles: burned.size });
  }

  /** A pillar drops on tile i. */
  crush(i) {
    this.crushedAt[i] = this.t;
    this.crates[i] = 0;
    this.items = this.items.filter((it) => it.i !== i);
    const b = this.bombs.find((o) => o.x === tileX(i) && o.y === tileY(i));
    if (b) this.bombs.splice(this.bombs.indexOf(b), 1);
    this.dirty = true;
    this.events.push({ k: 'crush', i });
  }

  /** One fixed step (1/60 s). */
  tick() {
    this.t += STEP_MS;
    const t = this.t;
    const n = this.dropCount(t);
    while (this.dropDone < n) this.crush(this.order[this.dropDone++]);
    for (const b of this.bombs) if (b.dx !== 0 || b.dy !== 0) this.slide(b);
    let due = null;
    for (const b of this.bombs) if (b.at <= t) (due ??= []).push(b);
    if (due) this.explode(due);
    // fire and walls hurt: bots at once, people only if they have not said so for a moment
    if (!this.practice) {
      for (const r of this.roster) {
        if (this.out.has(r.id)) continue;
        const bd = this.bodies.get(r.id);
        if (!bd) continue;
        const x = Math.floor(bd.x);
        const y = Math.floor(bd.y);
        if (!inside(x, y)) continue;
        const i = idx(x, y);
        const grace = r.bot ? 0 : HOST_GRACE_MS;
        const f = this.fireOn(i);
        if (f && t - f.from >= grace) this.hit(r.id, f);
        else if (!f && this.crushedBy(i) && t - this.crushedAt[i] >= grace) this.kill(r.id, null);
      }
    }
    // bots take what they stand on
    for (const r of this.roster) {
      if (!r.bot || this.out.has(r.id) || this.items.length === 0) continue;
      const bd = this.bodies.get(r.id);
      if (!bd) continue;
      const i = idx(Math.floor(bd.x), Math.floor(bd.y));
      if (this.items.some((it) => it.i === i)) this.takeItem(r.id, i);
    }
    if (this.fire.length && this.fire[0].from + BLAST_MS + CLAIM_GRACE_MS + 100 < t) this.fire = this.fire.filter((f) => f.from + BLAST_MS + CLAIM_GRACE_MS + 100 >= t);
    if (this.events.length > 400) this.events.splice(0, this.events.length - 200);
    if (this.chains.size > 24) for (const [cid, c] of this.chains) if (c.at < t - 4000) this.chains.delete(cid);
  }

  /** Runs fixed steps up to round time `to`; `pre(sim)` runs before each one (the bots think there). */
  advance(to, pre) {
    if (!(to > this.t)) return;
    if (to - this.t > 1500) this.t = to - 150; // a stalled page: don't replay the gap
    let n = 0;
    while (this.t + STEP_MS <= to + 1e-6 && n < 40) {
      pre?.(this);
      this.tick();
      n++;
    }
  }

  // ------------------------------------------------------------ the record
  /** What goes into the host's `g` (compact). */
  record() {
    const t = this.t;
    const pl = {};
    for (const r of this.roster) {
      const s = this.stats.get(r.id);
      pl[r.id] = [s.b, s.r, s.s, s.k, s.p, s.h, Math.round(s.inv)];
    }
    const out = {};
    for (const [id, at] of this.out) out[id] = at;
    return {
      cr: encodeBits(this.crates),
      bombs: this.bombs.map((b) => {
        const a = [b.x, b.y, this.index.get(b.o) ?? 0, Math.round(b.at), b.r, b.p ? 1 : 0, b.id];
        if (b.dx !== 0 || b.dy !== 0) a.push(b.dx, b.dy);
        return a;
      }),
      fire: this.fire.filter((f) => t < f.from + BLAST_MS + 120).map((f) => [f.i, Math.round(f.from)]),
      items: this.items.map((it) => [it.i, ITEM_KINDS.indexOf(it.k)]),
      pl,
      out,
      sd: this.sd.map((v) => (Number.isFinite(v) ? Math.round(v) : 1e12)),
    };
  }
}

/** The host's world carried on from a record (a new host after a reload or a change of host). Sliding bombs stop where they were last written. */
export function simFromRecord(g, rt) {
  const roster = g.roster.map((r) => ({ id: r.id, bot: r.bot }));
  const crates = decodeBits(g.cr);
  const sim = new Sim({ map: g.map, seed: g.seed, roster, crates: crates ?? undefined });
  const f = fieldFromRecord(g);
  sim.bombs = f.bombs.map((b) => ({ ...b, dx: 0, dy: 0, pr: 0 }));
  sim.fire = f.fire.map((e) => ({ ...e, cid: 0 }));
  sim.items = f.items;
  sim.sd = f.sd;
  sim.t = rt;
  sim.dropDone = sim.dropCount(rt);
  sim.rng = mulberry32((g.seed >>> 0) ^ (Math.round(rt) >>> 0) ^ 0x51ed);
  for (const r of roster) {
    const a = g.pl?.[r.id];
    const s = sim.stats.get(r.id);
    if (Array.isArray(a)) {
      s.b = a[0];
      s.r = a[1];
      s.s = a[2];
      s.k = a[3];
      s.p = a[4];
      s.h = a[5];
      s.inv = a[6] ?? 0;
      sim.took.set(r.id, (a[0] - 1 + (a[1] - 2) + a[2] + a[3] + a[4] + a[5]) > 0 ? 1 : 0);
    }
    if (typeof g.out?.[r.id] === 'number') sim.out.set(r.id, g.out[r.id]);
  }
  for (const b of sim.bombs) sim.nextBomb = Math.max(sim.nextBomb, b.id + 1);
  sim.dirty = true;
  return sim;
}
