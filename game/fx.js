// Juice: particles, shake from decaying trauma, hit-stop, a flash, floating callouts. Positions are in tile units (so a resize costs
// nothing); `draw` turns them into pixels with the view. Everything honours reduced motion and the graphics quality.

import { mulberry32, clamp } from './rules.js';

const CAPS = [160, 340, 720];

export class Fx {
  constructor(seed = 1) {
    this.parts = [];
    this.pops = [];
    this.trauma = 0;
    this.freeze = 0; // ms of hit-stop left
    this.flash = 0; // 0..1
    this.flashColor = '255,255,255';
    this.reduced = false;
    this.quality = 2;
    this.clock = 0;
    this.rng = mulberry32(seed);
  }

  rnd() {
    return this.rng();
  }
  r(lo, hi) {
    return lo + (hi - lo) * this.rng();
  }
  seed(s) {
    this.rng = mulberry32(s);
  }

  clear() {
    this.parts.length = 0;
    this.pops.length = 0;
    this.trauma = 0;
    this.freeze = 0;
    this.flash = 0;
  }

  /** Camera shake: 0..1 of trauma added (it decays, and what is drawn is trauma squared). */
  shake(amount) {
    if (this.reduced) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }
  hitstop(ms) {
    if (this.reduced) return;
    this.freeze = Math.max(this.freeze, ms);
  }
  doFlash(a, color = '255,255,255') {
    if (this.reduced) return;
    this.flash = Math.max(this.flash, a);
    this.flashColor = color;
  }

  /** Camera offset in pixels for a board whose tiles are S pixels. */
  shakeOffset(S, out) {
    const k = this.trauma * this.trauma;
    const m = S * 0.42 * k;
    out.x = m * Math.sin(this.clock * 43.1);
    out.y = m * Math.sin(this.clock * 57.7 + 1.9);
    return out;
  }

  add(p) {
    const cap = CAPS[clamp(this.quality | 0, 0, 2)] * (this.reduced ? 0.4 : 1);
    if (this.parts.length >= cap) this.parts.shift();
    this.parts.push(p);
    return p;
  }
  /** How many particles to make for a burst of `n`, by quality. */
  n(n) {
    return Math.max(1, Math.round(n * [0.4, 0.7, 1][clamp(this.quality | 0, 0, 2)] * (this.reduced ? 0.5 : 1)));
  }

  // ---- kinds: 0 spark (additive), 1 smoke, 2 chip (rotating, falls), 3 confetti, 4 dust, 5 ring
  sparks(x, y, count, color = '#ffb43b', speed = 4, z = 0.2) {
    for (let i = 0; i < this.n(count); i++) {
      const a = this.rnd() * Math.PI * 2;
      const v = speed * (0.4 + this.rnd() * 0.9);
      this.add({ kind: 0, x, y, z, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, vz: this.r(1, 4), life: this.r(0.25, 0.6), max: 0.6, size: this.r(0.04, 0.09), color, rot: 0, vr: 0 });
    }
  }
  smoke(x, y, count, size = 0.3, color = '90,96,110') {
    for (let i = 0; i < this.n(count); i++) {
      this.add({ kind: 1, x: x + this.r(-0.25, 0.25), y: y + this.r(-0.2, 0.2), z: this.r(0, 0.3), vx: this.r(-0.5, 0.5), vy: this.r(-0.4, 0.2), vz: this.r(0.6, 1.4), life: this.r(0.5, 1.1), max: 1.1, size: size * this.r(0.7, 1.3), color, rot: 0, vr: 0 });
    }
  }
  chips(x, y, count, color = '#b88448') {
    for (let i = 0; i < this.n(count); i++) {
      const a = this.rnd() * Math.PI * 2;
      const v = this.r(1.2, 4.2);
      this.add({ kind: 2, x, y, z: this.r(0.1, 0.5), vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6, vz: this.r(3, 7), life: this.r(0.5, 0.9), max: 0.9, size: this.r(0.07, 0.14), color, rot: this.r(0, 6), vr: this.r(-12, 12) });
    }
  }
  dust(x, y, count = 3) {
    for (let i = 0; i < this.n(count); i++) {
      this.add({ kind: 4, x: x + this.r(-0.15, 0.15), y: y + this.r(-0.05, 0.1), z: 0.05, vx: this.r(-0.5, 0.5), vy: this.r(-0.3, 0.1), vz: this.r(0.2, 0.7), life: this.r(0.25, 0.45), max: 0.45, size: this.r(0.08, 0.15), color: '200,205,220', rot: 0, vr: 0 });
    }
  }
  confetti(x, y, count = 40, speed = 5, up = 8) {
    const cols = ['#ff3b4a', '#ffc61a', '#34df68', '#2f8dff', '#ff45d2', '#ffffff', '#19e3e3'];
    for (let i = 0; i < this.n(count); i++) {
      const a = this.rnd() * Math.PI * 2;
      const v = speed * this.rnd();
      this.add({ kind: 3, x, y, z: 0.4, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: up * (0.5 + this.rnd() * 0.7), life: this.r(1.4, 2.6), max: 2.6, size: this.r(0.09, 0.15), color: cols[Math.floor(this.rnd() * cols.length)], rot: this.r(0, 6), vr: this.r(-9, 9) });
    }
  }
  ring(x, y, size = 0.8, color = '#ffffff', life = 0.4) {
    this.add({ kind: 5, x, y, z: 0, vx: 0, vy: 0, vz: 0, life, max: life, size, color, rot: 0, vr: 0 });
  }
  firework(x, y, z, color) {
    for (let i = 0; i < this.n(46); i++) {
      const a = this.rnd() * Math.PI * 2;
      const e = this.r(-1, 1);
      const v = this.r(2.2, 4.6);
      this.add({ kind: 0, x, y, z, vx: Math.cos(a) * v * Math.sqrt(1 - e * e), vy: Math.sin(a) * v * Math.sqrt(1 - e * e) * 0.4, vz: v * e, life: this.r(0.7, 1.3), max: 1.3, size: this.r(0.05, 0.1), color, rot: 0, vr: 0 });
    }
  }
  /** A floating callout at a tile position. */
  popup(x, y, text, color = '#ffffff', size = 28) {
    if (this.pops.length > 14) this.pops.shift();
    this.pops.push({ x, y, text, color, size, age: 0, life: 1.1 });
  }

  update(dt) {
    dt = clamp(dt, 0, 0.1);
    this.clock += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    this.flash = Math.max(0, this.flash - dt * 2.6);
    if (this.freeze > 0) this.freeze = Math.max(0, this.freeze - dt * 1000);
    const parts = this.parts;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        parts[i] = parts[parts.length - 1];
        parts.pop();
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += p.vr * dt;
      if (p.kind === 0 || p.kind === 2 || p.kind === 3) p.vz -= 11 * dt;
      if (p.kind === 3) {
        p.vx *= 1 - dt * 1.4;
        p.vy *= 1 - dt * 1.4;
        p.vz = Math.max(p.vz, -1.6);
      }
      if (p.kind === 1) p.size += dt * 0.35;
      if (p.z < 0 && p.kind !== 1 && p.kind !== 4) {
        p.z = 0;
        p.vz *= -0.3;
        p.vx *= 0.6;
        p.vy *= 0.6;
        if (p.kind === 0 || p.kind === 3) p.life -= dt * 2;
      }
    }
    const pops = this.pops;
    for (let i = pops.length - 1; i >= 0; i--) {
      pops[i].age += dt;
      if (pops[i].age >= pops[i].life) pops.splice(i, 1);
    }
  }

  /** Draws the particles of a board view `v`: { ox, oy, S }. */
  draw(ctx, v) {
    const S = v.S;
    const parts = this.parts;
    for (let pass = 0; pass < 2; pass++) {
      // pass 0: smoke, dust, rings, chips and confetti; pass 1: additive sparks on top
      if (pass === 1) ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if ((p.kind === 0) !== (pass === 1)) continue;
        const k = clamp(p.life / p.max, 0, 1);
        const px = v.ox + p.x * S;
        const py = v.oy + (p.y - p.z * 0.9) * S;
        if (!(px > -50 && px < v.W + 50 && py > -50 && py < v.H + 50)) continue;
        if (p.kind === 0) {
          ctx.globalAlpha = Math.min(1, k * 1.6);
          ctx.fillStyle = p.color;
          const s = Math.max(1.2, p.size * S * (0.6 + k * 0.6));
          ctx.fillRect(px - s / 2, py - s / 2, s, s);
        } else if (p.kind === 1 || p.kind === 4) {
          ctx.globalAlpha = (p.kind === 1 ? 0.5 : 0.4) * k * k;
          ctx.fillStyle = `rgb(${p.color})`;
          ctx.beginPath();
          ctx.arc(px, py, Math.max(0.5, p.size * S), 0, Math.PI * 2);
          ctx.fill();
        } else if (p.kind === 5) {
          const r = p.size * S * (1.6 - k * 1.2);
          ctx.globalAlpha = k;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1, S * 0.06 * k);
          ctx.beginPath();
          ctx.ellipse(px, py, Math.max(0.5, r), Math.max(0.5, r * 0.55), 0, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.globalAlpha = Math.min(1, k * 2);
          ctx.fillStyle = p.color;
          const s = Math.max(1.5, p.size * S);
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(p.rot);
          ctx.fillRect(-s / 2, -s * 0.3, s, s * 0.6);
          ctx.restore();
        }
      }
      if (pass === 1) ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }
}

/** The ease used for pops: overshoot and settle. */
export function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp(t, 0, 1) - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInOut = (t) => {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
};
