// The real main.js as a guest in someone else's room: another page is the host (its own Host object, driven here), this page reads the
// host's record, asks for bombs by message, decides its own knock-out, draws the others from presence and the bots from snapshots, and
// watches when it was not in the match.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, fakePlatform } from './fakedom.mjs';
import { Host, readG } from '../game/net.js';
import { mulberry32, T } from '../game/rules.js';

Math.random = mulberry32(7);

/** What the SDK's Room looks like to a page, with two views onto one shared room. */
const shared = {
  clock: () => Date.now(),
  state: {},
  players: new Map([
    ['h0', { id: 'h0', name: 'Hostess', presence: null }],
    ['p1', { id: 'p1', name: 'Pat', presence: null }],
  ]),
  match: { phase: 'lobby', n: 0, min: 1 },
  settings: { wins: 2, map: 'rings' },
  host: 'h0',
  outbox: [],
  toPage: [],
  sent: { bomb: 0, out: 0, take: 0, kick: 0 },
};
function view(meId) {
  const listeners = new Map();
  const room = {
    me: shared.players.get(meId),
    players: shared.players,
    state: shared.state,
    kind: 'public',
    connected: true,
    get host() {
      return shared.host;
    },
    get isHost() {
      return shared.host === meId;
    },
    get match() {
      return shared.match;
    },
    get settings() {
      return shared.settings;
    },
    get running() {
      return shared.match.phase === 'playing';
    },
    get participants() {
      return shared.match.phase === 'lobby' ? [] : shared.match.participants.map((id) => shared.players.get(id)).filter(Boolean);
    },
    get spectating() {
      return shared.match.phase !== 'lobby' && !shared.match.participants.includes(meId);
    },
    get online() {
      return [...shared.players.values()];
    },
    isParticipant: (id = meId) => shared.match.phase !== 'lobby' && shared.match.participants.includes(id),
    matchNow: () => (shared.match.phase === 'playing' ? shared.clock() - shared.match.startedAt : 0),
    setReady() {},
    clearReady() {},
    hideLobby() {},
    admit() {},
    setOpen() {},
    setSetting() {},
    startMatch() {},
    endMatch() {
      if (shared.host !== meId) return;
      const before = shared.match;
      shared.match = { phase: 'lobby', n: before.n, min: 1 };
      hostRoom.emit('matchend', shared.match, before);
      pageRoom.emit('matchend', shared.match, before);
    },
    send(data, opts = {}) {
      if (meId === 'p1') shared.outbox.push({ from: meId, to: opts.to, data });
      else shared.toPage.push({ from: meId, to: opts.to, data });
    },
    setPresence(d) {
      room.me.presence = d;
    },
    presenceAt: (id) => shared.players.get(id)?.presence ?? null,
    privateOf: () => ({}),
    setState(k, v) {
      if (v === null || v === undefined) delete shared.state[k];
      else shared.state[k] = v;
    },
    on(e, f) {
      if (!listeners.has(e)) listeners.set(e, new Set());
      listeners.get(e).add(f);
      return () => listeners.get(e).delete(f);
    },
    emit(e, ...a) {
      for (const f of listeners.get(e) ?? []) f(...a);
    },
  };
  return room;
}
const pageRoom = view('p1');
const hostRoom = view('h0');

const { ow, log } = fakePlatform(pageRoom);
const dom = installFakeDom({ ow });
await import('../game/main.js');
const ui = await import('../game/ui.js');
const seen = (t) => dom.stats.texts.includes(t);
const click = (h) => dom.fire('pointerdown', { clientX: h.x + h.w / 2, clientY: h.y + h.h / 2, pointerType: 'touch' });
const key = (code, down = true) => dom.fire(down ? 'keydown' : 'keyup', { code, key: code });

// ---- the other page: a Host standing at its spawn
const self = { x: 1.5, y: 1.5 };
const host = new Host(hostRoom, { nowMs: () => Date.now(), selfBody: () => self, onBadge() {} });
function hostSide(tick) {
  const g = readG(hostRoom);
  if (g) shared.players.get('h0').presence = { x: 1.5, y: 1.5, d: 2, w: 0, r: g.rn, s: 0 };
  if (tick) host.pump();
  // what the page sent to the host arrives, what the host sent to the page arrives
  while (shared.outbox.length) {
    const m = shared.outbox.shift();
    const t = m.data?.t;
    if (t in shared.sent) shared.sent[t]++;
    if (m.to === 'h0') host.onMessage(m.data, { id: m.from });
  }
  while (shared.toPage.length) {
    const m = shared.toPage.shift();
    if (m.to === 'p1') pageRoom.emit('message', m.data, { id: m.from }, Date.now(), pageRoom.matchNow());
  }
}
function frames(n, each) {
  dom.frames(n, 16.7, (i) => {
    hostSide(true);
    each?.(i);
  });
}

function startMatch(participants) {
  const startsAt = Date.now() + 3000;
  shared.match = { phase: 'starting', n: shared.match.n + 1, min: 1, id: `m${shared.match.n + 1}`, seed: 90210 + shared.match.n, participants, startsAt };
  pageRoom.emit('starting', shared.match);
  frames(190);
  const { startsAt: _s, ...rest } = shared.match;
  shared.match = { ...rest, phase: 'playing', startedAt: Date.now() };
  pageRoom.emit('matchstart', shared.match);
  hostRoom.emit('matchstart', shared.match);
  host.adopt();
}

test('the lobby draws the other person in the arena, with their name; only the host has the settings to tap', () => {
  frames(30);
  click(ui.hits.play);
  shared.players.get('h0').presence = { x: 9.5, y: 5.5, d: 2, w: 0, r: 0, s: 0 };
  shared.players.get('h0').ready = true;
  frames(60);
  assert.ok(seen('Hostess'), 'their name tag');
  assert.ok(seen('Pat'), 'mine');
  assert.ok(!ui.hits.wins.on && !ui.hits.map.on, 'only the host can change the settings');
  assert.ok(seen('WINS') && seen('RINGS'), 'but everyone sees them');
  assert.deepEqual(dom.problems, []);
});

test('a match in someone else\'s room: the page follows the host\'s record, asks for bombs, reports its own knock-out', () => {
  dom.stats.texts.length = 0;
  startMatch(['h0', 'p1']);
  const rnd = mulberry32(3);
  const phases = [];
  let last = '';
  let hold = null;
  let sawPending = false;
  for (let i = 0; i < 60 * 60 * 12 && shared.match.phase !== 'lobby'; i++) {
    if (i % 10 === 0) {
      if (hold) key(hold, false);
      hold = rnd() < 0.85 ? ['KeyW', 'KeyA', 'KeyS', 'KeyD'][Math.floor(rnd() * 4)] : null;
      if (hold) key(hold);
      if (rnd() < 0.4) {
        key('Space');
        key('Space', false);
      }
    }
    frames(1);
    const g = readG(pageRoom);
    if (g) {
      const k = `${g.rn}:${g.phase}`;
      if (k !== last) {
        last = k;
        phases.push(k);
      }
    }
  }
  if (hold) key(hold, false);
  assert.deepEqual(dom.problems, []);
  assert.equal(shared.match.phase, 'lobby', `the host ended the match after the podium (${phases.join(' ')})`);
  assert.ok(phases.some((p) => p.endsWith(':play')) && phases.some((p) => p.endsWith(':score')) && phases.at(-1).endsWith(':final'), phases.join(' '));
  const g = shared.state.g;
  assert.ok(g.roster.some((r) => r.id === 'p1') && g.roster.length === 4);
  assert.ok(shared.sent.bomb > 5, `the page asked for bombs (${shared.sent.bomb})`);
  assert.ok(g.bombs !== undefined && sawPending === false);
  assert.ok(seen('LAST ONE STANDING') && seen('RESULTS'));
  assert.ok([...dom.stats.texts].some((t) => ['Nova', 'Echo', 'Blaze', 'Pixel', 'Rook', 'Vex', 'Kai', 'Juno', 'Orbit', 'Zed', 'Mika', 'Rio', 'Ace', 'Sol'].includes(t)), 'the bots were drawn from snapshots, with their names');
  assert.equal(log.saves.length, 1, 'stats saved once');
});

test('the page remembers nothing of the last match: the lobby is back, then a match it only watches', () => {
  frames(60 * 8);
  assert.ok(seen('WINS'));
  dom.stats.texts.length = 0;
  startMatch(['h0']); // this page was not ready in time: it watches
  assert.equal(pageRoom.spectating, true);
  frames(60 * 12);
  assert.ok(seen('WATCHING'), 'a "Watching" label');
  assert.ok(seen('LAST ONE STANDING'));
  assert.equal(log.controls.at(-1), null, 'no controls while watching');
  assert.deepEqual(dom.problems, []);
  assert.ok(pageRoom.me.presence.r === 0 || pageRoom.me.presence.r === undefined, 'a spectator publishes nothing in a round');
});

test('a person who stands still in a blast is taken out by their own page: it says so, the host agrees', () => {
  // finish the watched match, then play one standing still next to a bomb
  for (let i = 0; i < 60 * 60 * 6 && shared.match.phase !== 'lobby'; i++) frames(1);
  assert.equal(shared.match.phase, 'lobby');
  frames(60 * 8);
  shared.sent.out = 0;
  shared.sent.bomb = 0;
  startMatch(['h0', 'p1']);
  frames(60 * 4); // the banner
  assert.equal(readG(pageRoom).phase, 'play');
  key('Space');
  key('Space', false);
  frames(30);
  assert.ok(shared.sent.bomb >= 1, 'the page asked the host for its bomb');
  assert.equal(readG(pageRoom).bombs.length >= 1, true, 'the host placed it');
  assert.ok(readG(pageRoom).bombs.some((b) => b[2] === 1), 'one of them p1\'s');
  frames(60 * 4); // it goes off under the player
  const g = readG(pageRoom);
  assert.ok(shared.sent.out >= 1, 'the page reported the blast');
  assert.ok('p1' in g.out || g.pl.p1[5] === 1, 'the host recorded the knock-out');
  assert.ok(seen('ELIMINATED'), 'and the page says so');
  assert.deepEqual(dom.problems, []);
  assert.ok(T.bannerMs > 0);
});

test('every screen shape: a phone upright and sideways, a tablet, a wide window, reduced motion, low graphics', () => {
  for (let i = 0; i < 60 * 60 * 6 && shared.match.phase !== 'lobby'; i++) frames(1);
  assert.equal(shared.match.phase, 'lobby');
  shared.players.get('h0').ready = true;
  shared.players.get('p1').ready = true;
  shared.players.get('h0').presence = { x: 5.5, y: 3.5, d: 1, w: 1, r: 0, s: 0 };
  const sizes = [[360, 640], [640, 360], [800, 360], [844, 390], [1024, 768], [1366, 768], [1920, 1080], [320, 480], [200, 150]];
  for (const reduced of [false, true]) {
    ow.settings.reducedMotion = reduced;
    ow.settings.quality = reduced ? 'low' : 'high';
    for (const [w, h] of sizes) {
      dom.resize(w, h);
      dom.stats.texts.length = 0;
      frames(40);
      assert.ok(seen('WINS'), `the lobby at ${w}x${h}`);
      assert.equal(dom.canvas.width, w);
    }
  }
  // a match at the smallest and the biggest, so every overlay is drawn at its extremes
  for (const [w, h] of [[360, 640], [640, 360], [1920, 1080], [200, 150]]) {
    dom.resize(w, h);
    dom.stats.texts.length = 0;
    startMatch(['h0', 'p1']);
    const rnd = mulberry32(w);
    let hold = null;
    for (let i = 0; i < 60 * 60 * 9 && shared.match.phase !== 'lobby'; i++) {
      if (i % 14 === 0) {
        if (hold) key(hold, false);
        hold = ['KeyW', 'KeyA', 'KeyS', 'KeyD', null][Math.floor(rnd() * 5)];
        if (hold) key(hold);
        if (rnd() < 0.3) {
          key('Space');
          key('Space', false);
        }
      }
      frames(1);
    }
    if (hold) key(hold, false);
    assert.equal(shared.match.phase, 'lobby', `a whole match at ${w}x${h}`);
    assert.ok(seen('LAST ONE STANDING'));
    assert.deepEqual(dom.problems, [], `${w}x${h}`);
  }
  ow.settings.reducedMotion = false;
  ow.settings.quality = 'high';
});
