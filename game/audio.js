// Synthesized sound: punchy effects for every action and a driving step-sequencer track. No files. The platform applies volume and mute.
// Everything is guarded: audio never throws into the game, and nothing plays before the first tap unlocks the context.

const BPM = 126;
const STEP = 60 / BPM / 4; // sixteenth notes
// Am - F - G - Em: bass root and the chord's three notes
const BARS = [
  { root: 55.0, chord: [220.0, 261.63, 329.63] },
  { root: 43.65, chord: [174.61, 220.0, 261.63] },
  { root: 49.0, chord: [196.0, 246.94, 293.66] },
  { root: 41.2, chord: [164.81, 196.0, 246.94] },
];
const ARP = [0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 2, 1, 0, 1];
const ITEM_NOTES = { b: 523.25, r: 587.33, s: 659.25, k: 698.46, p: 783.99, h: 880.0 };

export class Sound {
  constructor() {
    this.ctx = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.noiseBuf = null;
    this.music = { running: false, next: 0, step: 0, timer: 0, level: 0.4, mode: 'off' };
    this.lastBoom = 0;
  }

  get ready() {
    return Boolean(this.ctx);
  }

  /** Call from a tap or key press. */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const out = ctx.createGain();
        out.gain.value = 0.85;
        out.connect(ctx.destination);
        this.sfxBus = ctx.createGain();
        this.sfxBus.gain.value = 1;
        this.sfxBus.connect(out);
        this.musicBus = ctx.createGain();
        this.musicBus.gain.value = 0;
        this.musicBus.connect(out);
        const len = ctx.sampleRate;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        let seed = 7;
        for (let i = 0; i < len; i++) {
          seed = (seed * 16807) % 2147483647;
          data[i] = (seed / 2147483647) * 2 - 1;
        }
        this.noiseBuf = buf;
        this.ctx = ctx;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch {
      this.ctx = null;
    }
  }

  tone(f, dur, opt = {}) {
    const c = this.ctx;
    if (!c || !(f > 0) || !(dur > 0)) return;
    try {
      const t0 = c.currentTime + (opt.delay ?? 0);
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = opt.type ?? 'sine';
      osc.frequency.setValueAtTime(f, t0);
      if (opt.to > 0) osc.frequency.exponentialRampToValueAtTime(opt.to, t0 + dur);
      const peak = Math.max(0.0002, (opt.v ?? 0.25) * (opt.vol ?? 1));
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.012, dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(opt.bus ?? this.sfxBus);
      osc.start(t0);
      osc.stop(t0 + dur + 0.04);
    } catch {
      // ignore
    }
  }

  noise(dur, opt = {}) {
    const c = this.ctx;
    if (!c || !this.noiseBuf || !(dur > 0)) return;
    try {
      const t0 = c.currentTime + (opt.delay ?? 0);
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = opt.filter ?? 'bandpass';
      filter.frequency.setValueAtTime(opt.f ?? 1500, t0);
      if (opt.to > 0) filter.frequency.exponentialRampToValueAtTime(opt.to, t0 + dur);
      filter.Q.value = opt.q ?? 0.8;
      const g = c.createGain();
      const peak = Math.max(0.0002, (opt.v ?? 0.2) * (opt.vol ?? 1));
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.015, dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter);
      filter.connect(g);
      g.connect(opt.bus ?? this.sfxBus);
      src.start(t0, Math.random() * 0.5);
      src.stop(t0 + dur + 0.04);
    } catch {
      // ignore
    }
  }

  // ---------------------------------------------------------------- the sounds
  /** A bomb is set down: a dull thunk. */
  place(vol = 1) {
    this.tone(150, 0.12, { to: 70, v: 0.32, vol });
    this.noise(0.04, { filter: 'lowpass', f: 1200, v: 0.1, vol });
  }
  /** A blast. `size`: how big (1 for one bomb, more for a chain), `vol`: how near. */
  boom(size = 1, vol = 1) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastBoom < 0.035) vol *= 0.5; // a chain of blasts in one instant doesn't clip
    this.lastBoom = now;
    const k = Math.min(1.6, 0.8 + size * 0.15);
    this.noise(0.6, { filter: 'lowpass', f: 2600, to: 160, v: 0.42 * k, vol });
    this.tone(95, 0.5, { to: 32, v: 0.7 * k, vol });
    this.noise(0.09, { filter: 'highpass', f: 3500, v: 0.2, vol });
    this.tone(260, 0.16, { to: 60, type: 'sawtooth', v: 0.12, vol });
  }
  crate(vol = 1) {
    this.noise(0.16, { filter: 'bandpass', f: 1100, to: 350, q: 1.1, v: 0.22, vol });
    this.tone(300, 0.07, { to: 120, type: 'square', v: 0.07, vol });
  }
  pickup(kind = 'b') {
    const f = ITEM_NOTES[kind] ?? 600;
    this.tone(f, 0.1, { type: 'triangle', v: 0.2 });
    this.tone(f * 1.25, 0.1, { type: 'triangle', v: 0.17, delay: 0.07 });
    this.tone(f * 1.5, 0.22, { type: 'triangle', v: 0.17, delay: 0.14 });
    this.tone(f * 3, 0.14, { v: 0.05, delay: 0.14 });
  }
  kick(vol = 1) {
    this.tone(210, 0.16, { to: 70, v: 0.3, vol });
    this.noise(0.08, { filter: 'bandpass', f: 800, v: 0.14, vol });
  }
  shieldUp() {
    [440, 660, 880].forEach((f, i) => this.tone(f, 0.28, { v: 0.08, delay: i * 0.06 }));
  }
  shieldPop(vol = 1) {
    this.noise(0.22, { filter: 'highpass', f: 4200, v: 0.22, vol });
    this.tone(1200, 0.25, { to: 300, type: 'triangle', v: 0.14, vol });
  }
  /** Knocked out. */
  out(vol = 1) {
    this.noise(0.5, { filter: 'bandpass', f: 2400, to: 400, q: 1.2, v: 0.28, vol });
    this.tone(640, 0.45, { to: 90, type: 'sawtooth', v: 0.2, vol });
    this.tone(70, 0.4, { to: 40, v: 0.4, vol });
  }
  deny() {
    this.tone(130, 0.12, { type: 'square', v: 0.1 });
  }
  /** A pillar lands in sudden death. */
  slam(vol = 1) {
    this.tone(110, 0.2, { to: 45, type: 'triangle', v: 0.38, vol });
    this.noise(0.14, { filter: 'lowpass', f: 700, v: 0.2, vol });
  }
  alarm() {
    for (let i = 0; i < 3; i++) {
      this.tone(520, 0.22, { to: 760, type: 'sawtooth', v: 0.13, delay: i * 0.3 });
      this.tone(260, 0.22, { to: 380, type: 'square', v: 0.07, delay: i * 0.3 });
    }
  }
  warn() {
    this.tone(980, 0.05, { type: 'square', v: 0.07 });
  }
  pop() {
    this.tone(520, 0.08, { to: 880, type: 'triangle', v: 0.2 });
  }
  tap() {
    this.tone(700, 0.06, { to: 1000, type: 'square', v: 0.08 });
  }
  tick() {
    this.tone(440, 0.14, { type: 'square', v: 0.16 });
  }
  go() {
    this.tone(880, 0.4, { type: 'square', v: 0.17 });
    this.tone(1320, 0.4, { type: 'square', v: 0.09 });
    this.noise(0.25, { filter: 'highpass', f: 5000, v: 0.08 });
  }
  banner() {
    this.noise(0.5, { filter: 'bandpass', f: 500, to: 3200, q: 0.6, v: 0.16 });
    this.tone(196, 0.35, { to: 392, type: 'sawtooth', v: 0.08 });
  }
  /** A round won. */
  win() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this.tone(f, 0.22, { type: 'square', v: 0.11, delay: i * 0.085 });
      this.tone(f / 2, 0.22, { type: 'triangle', v: 0.14, delay: i * 0.085 });
    });
  }
  draw() {
    this.tone(330, 0.3, { to: 262, type: 'triangle', v: 0.16 });
    this.tone(247, 0.4, { to: 196, type: 'triangle', v: 0.14, delay: 0.18 });
  }
  place3(i = 0, vol = 1) {
    const base = [1046.5, 880, 783.99, 698.46][Math.min(i, 3)];
    this.tone(base, 0.5, { v: 0.16, vol });
    this.tone(base * 1.5, 0.5, { v: 0.07, vol, delay: 0.02 });
  }
  points() {
    this.tone(1200, 0.07, { to: 1800, type: 'triangle', v: 0.12 });
  }
  fanfare() {
    const notes = [523.25, 523.25, 523.25, 783.99, 659.25, 783.99, 1046.5];
    const at = [0, 0.12, 0.24, 0.36, 0.62, 0.74, 0.9];
    notes.forEach((f, i) => {
      this.tone(f, i === 6 ? 0.9 : 0.2, { type: 'square', v: 0.13, delay: at[i] });
      this.tone(f / 2, i === 6 ? 0.9 : 0.2, { type: 'triangle', v: 0.16, delay: at[i] });
    });
    this.noise(0.6, { filter: 'highpass', f: 6000, v: 0.08, delay: 0.9 });
  }

  // ---------------------------------------------------------------- music
  /** 'off' | 'menu' (quiet) | 'play' (full) | 'tense' (sudden death). */
  setMusic(mode) {
    if (!this.ctx) return;
    const m = this.music;
    m.mode = mode;
    m.level = mode === 'tense' ? 1.25 : mode === 'play' ? 1 : mode === 'menu' ? 0.45 : 0;
    const target = mode === 'tense' ? 0.5 : mode === 'play' ? 0.42 : mode === 'menu' ? 0.2 : 0;
    try {
      this.musicBus.gain.setTargetAtTime(target, this.ctx.currentTime, 0.4);
    } catch {
      // ignore
    }
    if (mode !== 'off' && !m.running) this.startMusic();
  }

  startMusic() {
    const m = this.music;
    if (!this.ctx || m.running) return;
    m.running = true;
    m.next = this.ctx.currentTime + 0.1;
    m.step = 0;
    m.timer = setInterval(() => this.schedule(), 50);
  }

  stopMusic() {
    this.music.running = false;
    clearInterval(this.music.timer);
  }

  schedule() {
    const c = this.ctx;
    const m = this.music;
    if (!c || !m.running) return;
    if (m.next < c.currentTime - 0.3) m.next = c.currentTime + 0.05; // the tab slept: don't play the missed notes at once
    while (m.next < c.currentTime + 0.25) {
      try {
        this.playStep(m.step, m.next, m.level);
      } catch {
        // ignore
      }
      m.next += STEP;
      m.step = (m.step + 1) % 64;
    }
  }

  playStep(i, t, level) {
    const c = this.ctx;
    if (level <= 0) return;
    const bar = BARS[i >> 4];
    const s = i & 15;
    const delay = Math.max(0, t - c.currentTime);
    const bus = this.musicBus;
    // bass: an offbeat pulse
    if (s % 4 === 2 || s === 0 || s === 7 || s === 11 || (level > 1.1 && s % 2 === 0)) this.tone(bar.root * (s === 7 || s === 15 ? 2 : 1), 0.17, { type: 'sawtooth', v: 0.22, delay, bus });
    if (level > 0.3) {
      if (s % 4 === 0) this.tone(160, 0.17, { to: 42, v: 0.6, delay, bus }); // kick on every beat
      if (s % 2 === 0) this.noise(0.035, { filter: 'highpass', f: 7500, v: level > 0.7 ? 0.08 : 0.04, delay, bus });
    }
    if (level > 0.7) {
      if (s === 4 || s === 12) {
        this.noise(0.13, { filter: 'bandpass', f: 1900, v: 0.24, delay, bus });
        this.tone(200, 0.08, { type: 'triangle', v: 0.1, delay, bus });
      }
      if (level > 1.1 && s % 2 === 1) this.noise(0.03, { filter: 'highpass', f: 8500, v: 0.05, delay, bus });
      if (s === 2 || s === 6 || s === 10 || s === 14) for (const f of bar.chord) this.tone(f, 0.1, { type: 'square', v: 0.03, delay, bus });
      this.tone(bar.chord[ARP[s]] * 2, 0.1, { type: 'triangle', v: 0.09, delay, bus });
    } else if (level > 0.3 && (s === 2 || s === 10)) {
      for (const f of bar.chord) this.tone(f, 0.14, { type: 'triangle', v: 0.03, delay, bus });
    }
  }
}
