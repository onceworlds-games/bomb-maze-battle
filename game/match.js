// The rules of a match, with no network in sight: the table, the rounds, who won each one, the totals. The host's page (net.js) wraps this
// with the room; the tests play whole matches of bots straight through it.

import { Sim, simFromRecord } from './sim.js';
import { BotRunner, botSpecs } from './bots.js';
import { buildRoster, makeCrates, roundSeed, ranking, places, winsOf, mapOf, roundCap, spawnOf, awardsOf, T, SD_AT_MS, TABLE_SIZE } from './rules.js';

export class MatchCore {
  /** `humans`: player ids (they take the first seats); bots fill up to `seats`. Or pass a ready `roster`. */
  constructor({ humans = [], roster, seed, need = 3, map = 'classic', seats = TABLE_SIZE, skill } = {}) {
    this.seed = (Number.isFinite(seed) ? seed : 1) >>> 0;
    this.need = winsOf(need);
    this.map = mapOf(map);
    this.roster = roster ? roster.map((r) => ({ ...r })) : buildRoster(humans, this.seed, seats);
    this.ids = this.roster.map((r) => r.id);
    this.wins = Object.fromEntries(this.ids.map((id) => [id, 0]));
    this.kos = Object.fromEntries(this.ids.map((id) => [id, 0]));
    this.chain = Object.fromEntries(this.ids.map((id) => [id, 0]));
    this.skill = skill;
    this.cap = roundCap(this.need);
    this.n = 0;
    this.rseed = 0;
    this.sim = null;
    this.runner = null;
    this.settleAt = -1;
    this.result = null; // { winner: id | null } once the round is decided
    this.sped = false;
  }

  /** Builds the next round: the arena, the crates, the bots at their corners. */
  beginRound() {
    this.n++;
    this.rseed = roundSeed(this.seed, this.n);
    const sim = new Sim({ map: this.map, seed: this.rseed, roster: this.roster, crates: makeCrates(this.map, this.rseed, this.roster.length) });
    this.sim = sim;
    this.runner = new BotRunner(sim, botSpecs(this.roster, this.rseed, this.skill));
    this.roster.forEach((r, i) => {
      if (r.bot) return;
      const [sx, sy] = spawnOf(i);
      sim.bodies.set(r.id, { x: sx + 0.5, y: sy + 0.5 });
    });
    this.settleAt = -1;
    this.result = null;
    this.sped = false;
    return sim;
  }

  /** Carries on from the host's record `g` at round time `rt` (a new host). `snap`: the bots' last positions [[x, y, dir], ...] in roster order. */
  adoptRound(g, rt, snap) {
    this.n = g.rn;
    this.rseed = g.seed;
    const sim = simFromRecord(g, rt);
    this.sim = sim;
    this.runner = new BotRunner(sim, botSpecs(this.roster, this.rseed, this.skill));
    let k = 0;
    this.roster.forEach((r, i) => {
      if (r.bot) {
        const p = Array.isArray(snap) ? snap[k++] : null;
        if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) this.runner.place(r.id, p[0], p[1], p[2]);
        return;
      }
      const [sx, sy] = spawnOf(i);
      sim.bodies.set(r.id, { x: sx + 0.5, y: sy + 0.5 });
    });
    this.settleAt = -1;
    this.result = null;
    this.sped = false;
    return sim;
  }

  /** Runs the round's world (and the bots) up to round time `rt` and decides whether the round is over. */
  advance(rt) {
    const sim = this.sim;
    if (!sim) return;
    sim.advance(rt, () => this.runner.step());
    this.check();
  }

  check() {
    const sim = this.sim;
    if (!sim || this.result) return;
    const alive = sim.aliveIds();
    const people = this.roster.filter((r) => !r.bot);
    if (people.length && !this.sped && alive.length > 1 && !people.some((r) => sim.alive(r.id))) {
      sim.speedUpSuddenDeath(); // nobody real is left: the walls close in
      this.sped = true;
    }
    if (alive.length <= 1) {
      if (this.settleAt < 0) this.settleAt = sim.t + T.settleMs; // late claims may still be on their way
    } else this.settleAt = -1;
    if (this.settleAt >= 0 && sim.t >= this.settleAt) this.result = { winner: alive.length === 1 ? alive[0] : null };
    else if (sim.t > SD_AT_MS + T.hardCapMs) this.result = { winner: alive.length === 1 ? alive[0] : null };
  }

  /** Puts the round into the totals. Returns { winner, matchOver }. */
  finishRound() {
    const sim = this.sim;
    const winner = this.result?.winner ?? null;
    if (winner && this.wins[winner] !== undefined) this.wins[winner]++;
    if (sim) {
      for (const id of this.ids) {
        this.kos[id] += sim.kos.get(id) ?? 0;
        this.chain[id] = Math.max(this.chain[id], sim.chainBest.get(id) ?? 0);
      }
    }
    const matchOver = this.ids.some((id) => this.wins[id] >= this.need) || this.n >= this.cap;
    return { winner, matchOver };
  }

  /** The standings: ids best first, their places, and the awards. */
  standings() {
    const ranked = ranking(this.ids, this.wins, this.kos);
    return { ranked, places: places(ranked, this.wins, this.kos), awards: awardsOf(this.ids, this.kos, this.chain) };
  }

  /** What the sim reported since the last call (bombs placed, blasts, knock-outs, pick-ups). */
  takeEvents() {
    return this.sim ? this.sim.events.splice(0) : [];
  }
}
