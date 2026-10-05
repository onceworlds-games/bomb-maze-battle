// The host's bombers. A bot reads the same world a person sees: it builds a danger map (which tiles will be in a blast, and when, chains
// included), walks away from danger along the nearest safe path, and otherwise heads for a spot next to crates, a power-up or a rival.
// It drops a bomb only when it can see a way out afterwards. Each has a reaction time and the odd slip, so they do get caught.
// Pure: no DOM, no platform; node tests play whole rounds of bots.

import { N, idx, tileX, tileY, inside, FUSE_MS, BLAST_MS, STEP_MS, speedOf, mulberry32, spawnOf } from './rules.js';
import { blastOf, DIRS } from './sim.js';
import { makeBody, stepBody, tileOf, prunePass } from './move.js';

export const SKILLS = {
  rookie: { react: 400, slip: 0.025, aggr: 0.4, think: 130 },
  avg: { react: 270, slip: 0.012, aggr: 0.65, think: 110 },
  sharp: { react: 170, slip: 0.004, aggr: 0.9, think: 90 },
  perfect: { react: 0, slip: 0, aggr: 0.8, think: 60 }, // for tests: never makes a mistake
};
const SKILL_ORDER = ['avg', 'sharp', 'rookie', 'avg', 'sharp', 'rookie', 'avg', 'sharp'];
export const skillFor = (i) => SKILLS[SKILL_ORDER[((i % SKILL_ORDER.length) + SKILL_ORDER.length) % SKILL_ORDER.length]];

const AFTER = 130; // be off a tile this long before its blast starts
const BEFORE = 60;

export function makeDanger() {
  return { start: new Float64Array(N), end: new Float64Array(N) };
}
function makeBuf() {
  return { dist: new Int16Array(N), prev: new Int16Array(N), queue: new Int16Array(N), count: 0 };
}

/** For every tile: when a blast (or a dropped pillar) first reaches it and when the last one is gone. Chains are followed. */
export function computeDanger(sim, extra, out) {
  const t = sim.t;
  out.start.fill(Infinity);
  out.end.fill(-Infinity);
  const mark = (i, s, e) => {
    if (s < out.start[i]) out.start[i] = s;
    if (e > out.end[i]) out.end[i] = e;
  };
  for (const f of sim.fire) if (t < f.from + BLAST_MS) mark(f.i, f.from, f.from + BLAST_MS);
  const bombs = extra && extra.length ? sim.bombs.concat(extra) : sim.bombs;
  const n = bombs.length;
  if (n) {
    const et = bombs.map((b) => b.at);
    const blasts = bombs.map((b) => blastOf(sim, b, bombs, t));
    for (let pass = 0, changed = true; changed && pass < n + 2; pass++) {
      changed = false;
      for (let a = 0; a < n; a++) {
        for (const o of blasts[a].hit) {
          const j = bombs.indexOf(o);
          if (j >= 0 && et[a] < et[j]) {
            et[j] = et[a];
            changed = true;
          }
        }
      }
    }
    for (let a = 0; a < n; a++) for (const i of blasts[a].tiles) mark(i, et[a], et[a] + BLAST_MS);
  }
  if (!sim.practice) {
    const n0 = sim.dropCount(t);
    for (let k = n0; k < sim.order.length && k < n0 + 10; k++) {
      const dt = sim.dropTime(k);
      if (dt - 1100 > t) break;
      mark(sim.order[k], dt - 350, Infinity);
    }
  }
  return out;
}

/** Breadth-first over open tiles, entering only tiles that are safe at the time we would get there. */
function runBfs(sim, from, danger, speed, buf, maxSteps = 40) {
  const { dist, prev, queue } = buf;
  dist.fill(-1);
  let head = 0;
  let tail = 0;
  queue[tail++] = from;
  dist[from] = 0;
  prev[from] = -1;
  const stepMs = 1000 / Math.max(1, speed);
  while (head < tail) {
    const i = queue[head++];
    const d = dist[i];
    if (d >= maxSteps) continue;
    const x = tileX(i);
    const y = tileY(i);
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inside(nx, ny)) continue;
      const j = idx(nx, ny);
      if (dist[j] !== -1 || sim.blockedAt(j) || sim.bombAt(nx, ny)) continue;
      // we are in tile j from `enter` (at the earliest now + d steps) until we have crossed it
      const enter = sim.t + d * stepMs;
      if (enter + stepMs + AFTER > danger.start[j] && enter - BEFORE < danger.end[j]) continue;
      dist[j] = d + 1;
      prev[j] = i;
      queue[tail++] = j;
    }
  }
  buf.count = tail;
  return buf;
}

function pathTo(buf, goal, from) {
  const path = [];
  for (let i = goal; i !== from && i >= 0; i = buf.prev[i]) path.push(i);
  return path.reverse();
}

export class Brain {
  constructor(id, seed, skill = SKILLS.avg) {
    this.id = id;
    this.rng = mulberry32(seed >>> 0);
    this.k = skill;
    this.nextThink = 0;
    this.alarmAt = -1;
    this.fleeing = false;
    this.path = [];
    this.goal = -1;
    this.kind = '';
    this.danger = makeDanger();
    this.danger2 = makeDanger();
    this.buf = makeBuf();
    this.buf2 = makeBuf();
    this.intent = { dx: 0, dy: 0, bomb: false };
    this.lastPos = { x: 0, y: 0, t: 0 };
    this.mode = 'idle';
  }

  /** The bot's wishes for this step: { dx, dy, bomb }. (The object is reused.) */
  think(sim, body) {
    const it = this.intent;
    it.dx = 0;
    it.dy = 0;
    it.bomb = false;
    const stats = sim.stats.get(this.id);
    if (!stats || sim.out.has(this.id)) return it;
    const t = sim.t;
    if (t >= this.nextThink) this.plan(sim, body, stats, it);
    this.follow(sim, body, it);
    return it;
  }

  plan(sim, body, stats, it) {
    const t = sim.t;
    const k = this.k;
    const rng = this.rng;
    this.nextThink = t + k.think * (0.8 + rng() * 0.5);
    computeDanger(sim, null, this.danger);
    const me = tileOf(body);
    const speed = speedOf(stats);
    // stuck? (wanting to move and not getting anywhere)
    const moved = Math.abs(body.x - this.lastPos.x) + Math.abs(body.y - this.lastPos.y);
    if (t - this.lastPos.t > 700) {
      if (moved < 0.05 && this.path.length > 0) {
        this.path = [];
        this.goal = -1;
      }
      this.lastPos.x = body.x;
      this.lastPos.y = body.y;
      this.lastPos.t = t;
    }
    const inDanger = this.danger.start[me] < Infinity;
    if (inDanger) {
      if (this.alarmAt < 0) this.alarmAt = t;
      const react = this.fleeing ? 0 : k.react;
      if (t - this.alarmAt < react) {
        this.mode = 'hold';
        return;
      }
      if (rng() < k.slip * 0.15) {
        this.mode = 'hold'; // a lapse: it just stands there a moment
        return;
      }
      this.mode = 'flee';
      this.flee(sim, me, speed);
      return;
    }
    this.alarmAt = -1;
    this.fleeing = false;
    this.mode = 'idle';
    this.roam(sim, body, stats, me, speed, it);
  }

  flee(sim, me, speed) {
    const buf = runBfs(sim, me, this.danger, speed, this.buf);
    let best = -1;
    for (let q = 1; q < buf.count; q++) {
      const j = buf.queue[q];
      if (this.danger.start[j] === Infinity) {
        best = j;
        break;
      }
    }
    if (best < 0) {
      // nowhere safe: the tile whose blast comes last
      let latest = this.danger.start[me];
      best = me;
      for (let q = 1; q < buf.count; q++) {
        const j = buf.queue[q];
        if (this.danger.start[j] > latest) {
          latest = this.danger.start[j];
          best = j;
        }
      }
    }
    this.goal = best;
    this.kind = 'flee';
    this.path = best === me ? [] : pathTo(buf, best, me);
  }

  roam(sim, body, stats, me, speed, it) {
    const rng = this.rng;
    const t = sim.t;
    const buf = runBfs(sim, me, this.danger, speed, this.buf, 18);
    const opp = [];
    for (const r of sim.roster) {
      if (r.id === this.id || sim.out.has(r.id)) continue;
      const bd = sim.bodies.get(r.id);
      if (bd) opp.push(tileOf(bd));
    }
    const canBomb = sim.ownedBombs(this.id) < stats.b;
    // standing on a bomb spot: drop one if there is a way out
    if (canBomb && this.kind === 'bomb' && this.goal === me && this.centered(body, me)) {
      const v = this.spotValue(sim, me, stats, opp);
      if (v.crates > 0 || v.opp > 0) {
        if (rng() < this.k.slip || this.escapable(sim, me, stats, speed)) {
          it.bomb = true;
          this.fleeing = true;
          this.nextThink = t;
          this.path = [];
          this.goal = -1;
          this.kind = '';
          return;
        }
      }
      this.goal = -1;
    }
    let best = -1;
    let bestScore = 0.05;
    let bestKind = '';
    for (let q = 0; q < buf.count; q++) {
      const j = buf.queue[q];
      const steps = buf.dist[j];
      const arrive = sim.t + steps * (1000 / speed);
      // not a place to stand if a blast comes soon
      if (this.danger.start[j] < Infinity && this.danger.start[j] - arrive < 1900) continue;
      if (sim.crushedBy(j, arrive + 600)) continue;
      let score = -steps * 0.12;
      let kind = '';
      if (sim.itemAt(j)) {
        score += 3.4;
        kind = 'item';
      }
      if (canBomb) {
        const v = this.spotValue(sim, j, stats, opp);
        const bv = v.crates * 1.0 + v.opp * 2.6 * this.k.aggr;
        if (bv > 0 && bv + (kind ? 3.4 : 0) - steps * 0.12 > score) {
          score = bv - steps * 0.12 + (kind ? 3.4 : 0);
          kind = 'bomb';
        }
      }
      if (!kind) continue;
      if (j === this.goal) score += 0.6;
      score += rng() * 0.35;
      if (score > bestScore) {
        bestScore = score;
        best = j;
        bestKind = kind;
      }
    }
    if (best < 0 && opp.length) {
      // nothing to blast or grab: head for the nearest rival
      let nearest = 1e9;
      for (let q = 0; q < buf.count; q++) {
        const j = buf.queue[q];
        const jx = tileX(j);
        const jy = tileY(j);
        for (const o of opp) {
          const d = Math.abs(tileX(o) - jx) + Math.abs(tileY(o) - jy) + buf.dist[j] * 0.01;
          if (d < nearest) {
            nearest = d;
            best = j;
            bestKind = 'chase';
          }
        }
      }
    }
    if (best < 0 || best === me) {
      this.goal = best;
      this.kind = best === me ? bestKind : '';
      this.path = [];
      return;
    }
    this.goal = best;
    this.kind = bestKind;
    this.path = pathTo(buf, best, me);
  }

  centered(body, tile) {
    return Math.abs(body.x - (tileX(tile) + 0.5)) < 0.22 && Math.abs(body.y - (tileY(tile) + 0.5)) < 0.22;
  }

  spotValue(sim, tile, stats, opp) {
    const bl = blastOf(sim, { x: tileX(tile), y: tileY(tile), r: stats.r, p: stats.p }, sim.bombs, sim.t);
    let n = 0;
    for (const o of opp) if (bl.tiles.includes(o)) n++;
    return { crates: bl.crates.length, opp: n };
  }

  /** Would a bomb dropped here leave a way out in time? */
  escapable(sim, tile, stats, speed) {
    const extra = [{ x: tileX(tile), y: tileY(tile), r: stats.r, p: stats.p, at: sim.t + FUSE_MS, dx: 0, dy: 0, id: -1, o: this.id }];
    computeDanger(sim, extra, this.danger2);
    if (this.danger2.start[tile] === Infinity) return true;
    const buf = runBfs(sim, tile, this.danger2, speed, this.buf2);
    for (let q = 1; q < buf.count; q++) if (this.danger2.start[buf.queue[q]] === Infinity) return true;
    return false;
  }

  /** Settles onto the middle of the tile it has arrived at. */
  center(body, me, it) {
    const ox = tileX(me) + 0.5 - body.x;
    const oy = tileY(me) + 0.5 - body.y;
    if (Math.abs(ox) > 0.08 && Math.abs(ox) >= Math.abs(oy)) it.dx = ox > 0 ? 1 : -1;
    else if (Math.abs(oy) > 0.08) it.dy = oy > 0 ? 1 : -1;
  }

  /** Turns the path into a direction for this step: line up with the lane first, then go. */
  follow(sim, body, it) {
    const path = this.path;
    if (path.length === 0 && this.goal !== tileOf(body)) return;
    const me = tileOf(body);
    while (path.length && path[0] === me) path.shift();
    if (path.length === 0) {
      if (this.goal === me) this.center(body, me, it);
      return;
    }
    const next = path[0];
    const cx = tileX(me);
    const cy = tileY(me);
    const nx = tileX(next);
    const ny = tileY(next);
    if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) {
      this.path = [];
      this.nextThink = 0;
      return;
    }
    if (nx !== cx) {
      const off = cy + 0.5 - body.y;
      if (Math.abs(off) > 0.06) it.dy = off > 0 ? 1 : -1;
      else it.dx = nx > cx ? 1 : -1;
    } else {
      const off = cx + 0.5 - body.x;
      if (Math.abs(off) > 0.06) it.dx = off > 0 ? 1 : -1;
      else it.dy = ny > cy ? 1 : -1;
    }
  }
}

/** Seats for the bots: where they stand and how they play. */
export function botSpecs(roster, matchSeed, skill) {
  const specs = [];
  roster.forEach((r, i) => {
    if (!r.bot) return;
    const [sx, sy] = spawnOf(i);
    specs.push({ id: r.id, seed: ((matchSeed >>> 0) ^ (0x9e3779b9 * (i + 1))) >>> 0, skill: skill ?? skillFor(i), x: sx + 0.5, y: sy + 0.5 });
  });
  return specs;
}

export class BotRunner {
  constructor(sim, specs) {
    this.sim = sim;
    this.bots = specs.map((s) => ({ id: s.id, body: makeBody(s.x, s.y), brain: new Brain(s.id, s.seed, s.skill) }));
    for (const b of this.bots) sim.bodies.set(b.id, b.body);
  }

  byId(id) {
    return this.bots.find((b) => b.id === id) ?? null;
  }

  /** Puts a bot back where a snapshot says it was (a new host carrying on). */
  place(id, x, y, dir) {
    const b = this.byId(id);
    if (!b) return;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      b.body.x = x;
      b.body.y = y;
    }
    if (dir >= 0 && dir <= 3) b.body.dir = dir;
  }

  /** One fixed step for every bot still in: think, move, maybe drop a bomb. Call before `sim.tick()`. */
  step() {
    const sim = this.sim;
    const dt = STEP_MS / 1000;
    for (const bot of this.bots) {
      if (!sim.alive(bot.id)) continue;
      const it = bot.brain.think(sim, bot.body);
      const blocked = (tx, ty) => sim.codeAt(tx, ty, bot.body.pass);
      stepBody(bot.body, it.dx, it.dy, dt, speedOf(sim.stats.get(bot.id)), blocked);
      prunePass(bot.body);
      if (it.bomb) sim.placeBomb(bot.id, Math.floor(bot.body.x), Math.floor(bot.body.y));
    }
  }
}
