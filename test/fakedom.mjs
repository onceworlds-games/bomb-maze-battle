// A just-enough browser for running the game's real main.js in node, with time under the test's control:
// a canvas that checks every drawing call for bad numbers and unbalanced save/restore, Web Audio that accepts anything,
// timers and animation frames on a fake clock, and key / pointer events.

const NUMERIC = new Set(['moveTo', 'lineTo', 'arc', 'ellipse', 'fillRect', 'strokeRect', 'clearRect', 'rect', 'arcTo', 'quadraticCurveTo', 'bezierCurveTo', 'translate', 'scale', 'rotate', 'setTransform', 'drawImage', 'fillText', 'strokeText', 'createLinearGradient', 'createRadialGradient']);

export function installFakeDom({ width = 800, height = 450, search = '', ow = null } = {}) {
  const clock = { ms: 100000 };
  const timers = [];
  let timerId = 1;
  let rafQueue = [];
  const listeners = new Map();
  const problems = [];
  const stats = { calls: 0, saves: 0, restores: 0, texts: [], frames: 0, maxDepth: 0, audioNodes: 0, sprites: 0, drawImages: 0 };

  // ---- canvas contexts (the screen's, and one for every offscreen sprite)
  function makeCtx(track) {
    const state = { font: '10px sans-serif', depth: 0 };
    const ctx = new Proxy(state, {
      get(t, p) {
        if (p in t) return t[p];
        if (p === 'measureText') return (s) => ({ width: String(s).length * 0.5 * parseFloat((String(t.font).match(/(\d+(?:\.\d+)?)px/) ?? [0, 10])[1]) });
        if (p === 'save')
          return () => {
            t.depth++;
            if (track) {
              stats.saves++;
              stats.maxDepth = Math.max(stats.maxDepth, t.depth);
            }
          };
        if (p === 'restore')
          return () => {
            t.depth--;
            if (track) stats.restores++;
            if (t.depth < 0) problems.push('restore without save');
          };
        if (p === 'fillText' || p === 'strokeText')
          return (...a) => {
            stats.calls++;
            if (a.slice(1, 3).some((n) => typeof n !== 'number' || !Number.isFinite(n))) problems.push(`${String(p)} with bad numbers: ${JSON.stringify(a)}`);
            if (typeof a[0] !== 'string' || /undefined|NaN|\[object/.test(a[0])) problems.push(`text "${a[0]}"`);
            if (p === 'fillText' && track) stats.texts.push(String(a[0]));
          };
        if (p === 'createLinearGradient' || p === 'createRadialGradient')
          return (...a) => {
            for (const n of a) if (typeof n !== 'number' || !Number.isFinite(n)) problems.push(`${String(p)} with ${n}: ${JSON.stringify(a)}`);
            if (p === 'createRadialGradient' && (a[2] < 0 || a[5] < 0)) problems.push(`radial gradient with a negative radius: ${JSON.stringify(a)}`);
            return { addColorStop(o, c) {
              if (!(o >= 0 && o <= 1)) problems.push(`color stop at ${o}`);
              if (/NaN|undefined/.test(String(c))) problems.push(`color stop ${c}`);
            } };
          };
        if (p === 'drawImage')
          return (...a) => {
            stats.calls++;
            stats.drawImages++;
            for (const n of a.slice(1)) if (typeof n !== 'number' || !Number.isFinite(n)) problems.push(`drawImage with ${n}: ${JSON.stringify(a.slice(1))}`);
          };
        if (NUMERIC.has(p))
          return (...a) => {
            stats.calls++;
            for (const n of a) if (typeof n === 'number' && !Number.isFinite(n)) problems.push(`${String(p)} with ${n}: ${JSON.stringify(a)}`);
            // a real canvas throws on a negative radius, and an exception in the frame loop stops the game
            if (p === 'arc' && a[2] < 0) problems.push(`arc with a negative radius: ${JSON.stringify(a)}`);
            if (p === 'ellipse' && (a[2] < 0 || a[3] < 0)) problems.push(`ellipse with a negative radius: ${JSON.stringify(a)}`);
            if (p === 'arcTo' && a[4] < 0) problems.push(`arcTo with a negative radius: ${JSON.stringify(a)}`);
          };
        return () => {
          stats.calls++;
        };
      },
      set(t, p, v) {
        if (p === 'globalAlpha' && !(typeof v === 'number' && v >= 0 && v <= 1)) problems.push(`globalAlpha ${v}`);
        if (p === 'lineWidth' && !(typeof v === 'number' && v > 0 && Number.isFinite(v))) problems.push(`lineWidth ${v}`);
        if (p === 'font' && /NaN|undefined|Infinity/.test(String(v))) problems.push(`font ${v}`);
        if ((p === 'fillStyle' || p === 'strokeStyle') && typeof v === 'string' && /NaN|undefined/.test(v)) problems.push(`${String(p)} ${v}`);
        if (p === 'shadowBlur' && !(typeof v === 'number' && v >= 0 && Number.isFinite(v))) problems.push(`shadowBlur ${v}`);
        t[p] = v;
        return true;
      },
    });
    return { ctx, state };
  }

  const main = makeCtx(true);
  const ctx = main.ctx;
  const state = main.state;

  const canvas = {
    width,
    height,
    style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: globalThis.innerWidth, height: globalThis.innerHeight }),
    addEventListener() {},
  };

  const doc = {
    getElementById: (id) => (id === 'game' ? canvas : null),
    createElement: (tag) => {
      if (tag !== 'canvas') return { style: {}, appendChild() {} };
      stats.sprites++;
      const c = makeCtx(false);
      return { width: 0, height: 0, style: {}, getContext: () => c.ctx };
    },
    body: { dataset: {}, style: {}, appendChild() {} },
    hidden: false,
    activeElement: null,
    addEventListener: (type, fn) => add(type, fn),
    fonts: { load: () => Promise.resolve([]), ready: Promise.resolve() },
  };

  function add(type, fn) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  }

  // ---- Web Audio that accepts anything and counts what it is asked to make
  const node = () =>
    new Proxy(function () {}, {
      get(t, p) {
        if (p === 'connect') return (n) => n;
        if (p === 'frequency' || p === 'gain' || p === 'Q' || p === 'detune') return audioParam();
        if (p === 'getChannelData') return () => new Float32Array(48000);
        return t[p];
      },
      set(t, p, v) {
        t[p] = v;
        return true;
      },
      apply() {},
    });
  const audioParam = () => ({
    value: 0,
    setValueAtTime(v) {
      if (!Number.isFinite(v)) problems.push(`audio param ${v}`);
    },
    exponentialRampToValueAtTime(v) {
      if (!(v > 0) || !Number.isFinite(v)) problems.push(`audio ramp to ${v}`);
    },
    linearRampToValueAtTime() {},
    setTargetAtTime() {},
  });
  class FakeAudioContext {
    constructor() {
      this.state = 'suspended';
      this.sampleRate = 48000;
      this.destination = {};
    }
    get currentTime() {
      return clock.ms / 1000;
    }
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    createGain() {
      stats.audioNodes++;
      return node();
    }
    createOscillator() {
      stats.audioNodes++;
      const n = node();
      n.start = () => {};
      n.stop = () => {};
      return n;
    }
    createBufferSource() {
      stats.audioNodes++;
      const n = node();
      n.start = () => {};
      n.stop = () => {};
      return n;
    }
    createBiquadFilter() {
      return node();
    }
    createBuffer(ch, len) {
      return { getChannelData: () => new Float32Array(len) };
    }
  }

  // ---- install on the global object
  const g = globalThis;
  g.window = g;
  g.document = doc;
  g.innerWidth = width;
  g.innerHeight = height;
  g.devicePixelRatio = 1;
  g.location = { search };
  g.addEventListener = (type, fn) => add(type, fn);
  g.AudioContext = FakeAudioContext;
  g.Image = class {
    constructor() {
      this.complete = false;
      this.naturalWidth = 0;
    }
  };
  if (ow) g.onceworlds = ow;
  else delete g.onceworlds;
  Object.defineProperty(g, 'performance', { value: { now: () => clock.ms }, configurable: true, writable: true });
  const realDateNow = Date.now;
  Date.now = () => clock.ms;
  g.setTimeout = (fn, ms = 0) => {
    const id = timerId++;
    timers.push({ id, at: clock.ms + ms, fn, every: 0 });
    return id;
  };
  g.setInterval = (fn, ms = 0) => {
    const id = timerId++;
    timers.push({ id, at: clock.ms + ms, fn, every: Math.max(1, ms) });
    return id;
  };
  g.clearTimeout = g.clearInterval = (id) => {
    const i = timers.findIndex((t) => t.id === id);
    if (i >= 0) timers.splice(i, 1);
  };
  g.requestAnimationFrame = (fn) => {
    rafQueue.push(fn);
    return rafQueue.length;
  };
  g.cancelAnimationFrame = () => {};

  function runTimers() {
    for (;;) {
      let due = null;
      for (const t of timers) if (t.at <= clock.ms && (!due || t.at < due.at)) due = t;
      if (!due) return;
      if (due.every) due.at += due.every;
      else timers.splice(timers.indexOf(due), 1);
      due.fn();
    }
  }

  // anything logged as an error by the game is a problem
  const realError = console.error;
  console.error = (...a) => {
    problems.push(`console.error: ${a.map((x) => (x instanceof Error ? x.stack : String(x))).join(' ')}`);
  };

  return {
    clock,
    problems,
    stats,
    canvas,
    ctx,
    /** Dispatch an event to the game's listeners. */
    fire(type, ev = {}) {
      const e = { type, preventDefault() {}, isTrusted: true, ...ev };
      for (const fn of listeners.get(type) ?? []) fn(e);
    },
    /** Advance the fake clock one animation frame at a time. */
    frames(n, dtMs = 16.7, each) {
      for (let i = 0; i < n; i++) {
        clock.ms += dtMs;
        runTimers();
        const q = rafQueue;
        rafQueue = [];
        for (const fn of q) fn(clock.ms);
        stats.frames++;
        if (state.depth !== 0) {
          problems.push(`save/restore unbalanced after a frame (depth ${state.depth})`);
          state.depth = 0;
        }
        each?.(i);
      }
    },
    /** Turn the phone, change the window: the game redraws at the new size. */
    resize(w, h) {
      g.innerWidth = w;
      g.innerHeight = h;
      for (const fn of listeners.get('resize') ?? []) fn({ type: 'resize' });
    },
    /** Let time pass with no frames drawn (timers still run). */
    idle(ms) {
      clock.ms += ms;
      runTimers();
    },
    restore() {
      Date.now = realDateNow;
      console.error = realError;
    },
  };
}

/** A fake `window.onceworlds` around a room: logs what the game asks of the platform. */
export function fakePlatform(room, { avatarUrl = null } = {}) {
  const log = { controls: [], badges: [], saves: [], boards: [], orientation: [] };
  const ow = {
    mode: 'platform',
    version: 'test',
    ready: () => Promise.resolve(),
    now: () => Date.now(),
    rooms: { join: async () => room, current: room },
    ui: { setOrientation: (o) => log.orientation.push(o), setMenuPosition() {}, showInvite() {}, requestFullscreen() {} },
    controls: {
      stick: { x: 0, y: 0 },
      held: new Set(),
      touch: true,
      set(layout) {
        log.controls.push(layout);
      },
      pressed(id) {
        return this.held.has(id);
      },
    },
    settings: { quality: 'high', scale: 1, reducedMotion: false, choice: 'auto', pixelRatio: () => 1, on() {} },
    save: {
      get: async () => null,
      set: async (k, v) => log.saves.push([k, v]),
    },
    badges: {
      award: async (id) => {
        log.badges.push(id);
        return true;
      },
    },
    leaderboards: { submit: async (b, s) => log.boards.push([b, s]) },
    player: { avatarUrl: async () => avatarUrl },
    on() {},
  };
  return { ow, log };
}
