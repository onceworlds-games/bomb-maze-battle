// The real main.js as the HOST of a room with one other person (scripted): the other page's requests arrive as messages, the host's page
// decides, writes the record and sends badges; and when the host's role moves to the other page, this page carries on as a guest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, fakePlatform } from './fakedom.mjs';
import { readG } from '../game/net.js';
import { mulberry32, idx, FUSE_MS, T } from '../game/rules.js';

Math.random = mulberry32(11);

const shared = {
  state: {},
  players: new Map([
    ['p1', { id: 'p1', name: 'Pat', presence: null }],
    ['g2', { id: 'g2', name: 'Gus', presence: null }],
  ]),
  match: { phase: 'lobby', n: 0, min: 1 },
  settings: { wins: 2, map: 'classic' },
  host: 'p1',
  sent: [],
};
const listeners = new Map();
const room = {
  me: shared.players.get('p1'),
  players: shared.players,
  state: shared.state,
  kind: 'private',
  connected: true,
  get host() {
    return shared.host;
  },
  get isHost() {
    return shared.host === 'p1';
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
    return shared.match.phase === 'lobby' ? [] : shared.match.participants.map((id) => shared.players.get(id));
  },
  get spectating() {
    return shared.match.phase !== 'lobby' && !shared.match.participants.includes('p1');
  },
  get online() {
    return [...shared.players.values()];
  },
  isParticipant: (id = 'p1') => shared.match.phase !== 'lobby' && shared.match.participants.includes(id),
  matchNow: () => (shared.match.phase === 'playing' ? Date.now() - shared.match.startedAt : 0),
  setReady() {},
  clearReady() {},
  hideLobby() {},
  admit() {},
  setOpen() {},
  setSetting() {},
  startMatch() {},
  endMatch() {
    const before = shared.match;
    shared.match = { phase: 'lobby', n: before.n, min: 1 };
    emit('matchend', shared.match, before);
  },
  send(d, o) {
    shared.sent.push({ d, to: o?.to });
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
  },
};
function emit(e, ...a) {
  for (const f of listeners.get(e) ?? []) f(...a);
}

const { ow, log } = fakePlatform(room);
const dom = installFakeDom({ ow });
await import('../game/main.js');
const ui = await import('../game/ui.js');
const key = (code, down = true) => dom.fire(down ? 'keydown' : 'keyup', { code, key: code });
const guest = (rid, d) => emit('message', { rid, ...d }, { id: 'g2' }, Date.now(), room.matchNow());
const guestAt = (x, y) => {
  const g = readG(room);
  shared.players.get('g2').presence = { x, y, d: 2, w: 0, r: g ? g.rn : 1, s: 0 };
};

test('the host page places the guest\'s bomb, records its blast and its knock-out, and tells nobody a secret', () => {
  dom.frames(20);
  dom.fire('pointerdown', { clientX: ui.hits.play.x + 4, clientY: ui.hits.play.y + 4 });
  dom.frames(30);
  const startsAt = Date.now() + 3000;
  shared.match = { phase: 'starting', n: 1, min: 1, id: 'm1', seed: 4242, participants: ['p1', 'g2'], startsAt };
  emit('starting', shared.match);
  dom.frames(190);
  const { startsAt: _s, ...rest } = shared.match;
  shared.match = { ...rest, phase: 'playing', startedAt: Date.now() };
  emit('matchstart', shared.match);
  dom.frames(2);
  let g = readG(room);
  assert.ok(g, 'the host page wrote the record');
  assert.equal(g.by, 'p1');
  assert.deepEqual(g.roster.slice(0, 2).map((r) => r.id), ['p1', 'g2']);
  guestAt(13.5, 11.5);
  dom.frames(Math.ceil((T.bannerMs + T.openingMs) / 16.7) + 10);
  g = readG(room);
  assert.equal(g.phase, 'play');
  const rid = g.rid;
  guest(rid, { t: 'bomb', x: 13, y: 11 });
  dom.frames(5);
  g = readG(room);
  assert.ok(g.bombs.some((b) => b[0] === 13 && b[1] === 11 && b[2] === 1), 'the guest\'s bomb is in the record');
  guest(rid, { t: 'bomb', x: 5, y: 5 });
  dom.frames(3);
  assert.ok(shared.sent.some((m) => m.to === 'g2' && m.d.t === 'no'), 'a bomb from nowhere near is refused and the guest is told');
  dom.frames(Math.ceil(FUSE_MS / 16.7) + 10);
  g = readG(room);
  assert.ok(g.fire.some((f) => f[0] === idx(13, 11)), 'the blast is in the record');
  guest(rid, { t: 'out', f: idx(13, 11) });
  dom.frames(3);
  assert.ok('g2' in readG(room).out, 'the guest\'s knock-out is recorded');
  assert.deepEqual(dom.problems, []);
});

test('with both people out the round ends, the walls stop, and the match carries on to its end', () => {
  for (let i = 0; i < 60 * 60 * 10 && shared.match.phase !== 'lobby'; i++) {
    dom.frames(1);
    const g = readG(room);
    if (g && g.phase === 'play') guestAt(13.5, 11.5);
  }
  assert.equal(shared.match.phase, 'lobby');
  assert.deepEqual(dom.problems, []);
  assert.equal(log.saves.length, 1);
});

test('when the role moves to the other page this page carries on as a guest, from the same record', () => {
  dom.frames(60 * 8);
  const startsAt = Date.now() + 3000;
  shared.match = { phase: 'starting', n: 2, min: 1, id: 'm2', seed: 99, participants: ['p1', 'g2'], startsAt };
  emit('starting', shared.match);
  dom.frames(190);
  const { startsAt: _s, ...rest } = shared.match;
  shared.match = { ...rest, phase: 'playing', startedAt: Date.now() };
  emit('matchstart', shared.match);
  guestAt(13.5, 11.5);
  dom.frames(Math.ceil((T.bannerMs + T.openingMs) / 16.7) + 400);
  const before = readG(room);
  assert.equal(before.phase, 'play');
  // the host drops: g2's page takes over (here: nobody writes, the record just stands)
  shared.host = 'g2';
  emit('host', 'g2');
  dom.frames(120);
  assert.equal(room.isHost, false);
  assert.equal(readG(room).by, 'p1', 'this page writes nothing any more');
  key('KeyD');
  dom.frames(30);
  key('KeyD', false);
  assert.deepEqual(dom.problems, []);
  assert.ok(room.me.presence.x >= 1, 'it still moves its own bomber and publishes it');
});
