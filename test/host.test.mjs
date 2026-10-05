import test from 'node:test';
import assert from 'node:assert/strict';
import { COLS, ROWS, N, T, idx, FUSE_MS, spawnOf, roundCap } from '../game/rules.js';
import { Host, readG, readPresence, readBots, createStubRoom } from '../game/net.js';

/** A room as the SDK shows it to a page, with a match clock the test moves. */
function makeRoom({ meId = 'h1', others = ['h2'], seed = 77, settings = { wins: 2, map: 'classic' } } = {}) {
  const clock = { ms: 0, wall: 1000000 };
  const players = new Map();
  const me = { id: meId, name: 'Host', presence: null };
  players.set(me.id, me);
  for (const o of others) players.set(o, { id: o, name: o, presence: null });
  const room = {
    me,
    players,
    host: meId,
    connected: true,
    settings,
    state: {},
    sent: [],
    ended: 0,
    get isHost() {
      return this.connected && this.host === this.me.id;
    },
    get running() {
      return this.match.phase === 'playing' && !this.match.paused;
    },
    match: { phase: 'playing', id: 'm1', seed, participants: [meId, ...others], startedAt: 0 },
    matchNow: () => clock.ms,
    setState(k, v) {
      if (v === null || v === undefined) delete this.state[k];
      else this.state[k] = v;
    },
    send(d, o) {
      this.sent.push({ d, to: o?.to });
    },
    endMatch() {
      this.ended++;
      this.match = { phase: 'lobby', n: 1, min: 1 };
    },
  };
  return { room, clock };
}

function adapter(clock, self = { x: 1.5, y: 1.5 }) {
  const badges = [];
  return { nowMs: () => clock.wall, selfBody: () => self, onBadge: (b) => badges.push(b), badges, self };
}

function step(host, clock, ms, each) {
  for (let t = 0; t < ms; t += 20) {
    clock.ms += 20;
    clock.wall += 20;
    host.pump();
    each?.();
  }
}

const presence = (room, id, x, y, rn, s = 0) => {
  room.players.get(id).presence = { x, y, d: 2, w: 0, r: rn, s };
};

test('a match starts from the room: a valid record with the table, the world and a banner', () => {
  const { room, clock } = makeRoom();
  const host = new Host(room, adapter(clock));
  host.adopt();
  const g = readG(room);
  assert.ok(g, 'a record the pages accept');
  assert.equal(g.phase, 'banner');
  assert.equal(g.by, 'h1');
  assert.equal(g.rid, 'm1.1');
  assert.equal(g.need, 2);
  assert.equal(g.map, 'classic');
  assert.deepEqual(g.roster.map((r) => r.id), ['h1', 'h2', 'bot1', 'bot2']);
  assert.deepEqual(g.roster.map((r) => r.c), [0, 1, 2, 3]);
  assert.ok(g.roster[2].name && g.roster[3].name);
  assert.equal(g.until, T.bannerMs);
  assert.equal(g.t0, T.bannerMs);
  assert.deepEqual(g.wins, { h1: 0, h2: 0, bot1: 0, bot2: 0 });
  assert.equal(g.cr.length, Math.ceil(N / 4));
  assert.deepEqual(g.bombs, []);
  assert.ok(JSON.stringify(g).length < 3500, `${JSON.stringify(g).length} bytes`);
  host.adopt();
  assert.equal(readG(room).rid, 'm1.1', 'adopting again changes nothing');
  assert.equal(room.state.b, undefined);
});

test('a record of another match, or a malformed one, is nobody\'s world', () => {
  const { room, clock } = makeRoom();
  const host = new Host(room, adapter(clock));
  host.adopt();
  const good = room.state.g;
  assert.ok(readG(room));
  const check = (g) => {
    room.state.g = g;
    return readG(room);
  };
  assert.equal(check({ ...good, mid: 'm0' }), null, 'stale');
  room.match.id = 'm9';
  assert.equal(check(good), null, 'a record of the last match');
  room.match.id = 'm1';
  assert.ok(check(good));
  const bad = [
    null,
    5,
    'x',
    [],
    {},
    { ...good, roster: 'no' },
    { ...good, roster: [] },
    { ...good, roster: [{ id: 1, bot: 0, c: 0 }] },
    { ...good, roster: [{ id: 'a', bot: 2, c: 0 }] },
    { ...good, roster: [{ id: 'a', bot: 1, c: 0 }] },
    { ...good, roster: [...good.roster, ...good.roster] },
    { ...good, phase: 'dance' },
    { ...good, rn: 0 },
    { ...good, until: NaN },
    { ...good, t0: -1 },
    { ...good, need: 99 },
    { ...good, map: 'moon' },
    { ...good, wins: [] },
    { ...good, wins: { h1: 'x' } },
    { ...good, cr: 'zz' },
    { ...good, cr: good.cr.slice(1) },
    { ...good, bombs: 'x' },
    { ...good, bombs: [[1, 1]] },
    { ...good, bombs: [[0, 1, 0, 100, 2, 0, 1]] },
    { ...good, bombs: [[1, 1, 9, 100, 2, 0, 1]] },
    { ...good, bombs: [[1, 1, 0, 100, 2, 0, 'x']] },
    { ...good, bombs: Array.from({ length: 100 }, () => [1, 1, 0, 100, 2, 0, 1]) },
    { ...good, fire: [[N, 5]] },
    { ...good, fire: [[1]] },
    { ...good, items: [[3, 99]] },
    { ...good, items: [[-1, 0]] },
    { ...good, pl: { zed: [1, 2, 0, 0, 0, 0, 0] } },
    { ...good, pl: { h1: [1, 2] } },
    { ...good, pl: [] },
    { ...good, sd: [1, 2] },
    { ...good, sd: [1, 2, 'x'] },
    { ...good, win: 5 },
    { ...good, out: { h1: -1 } },
    { ...good, by: 7 },
    { ...good, rid: null },
  ];
  bad.forEach((g, i) => assert.equal(check(g), null, `malformed #${i} is refused`));
  for (const key of Object.keys(good)) {
    const g = { ...good };
    delete g[key];
    assert.equal(check(g), null, `a record without ${key} is refused`);
  }
  assert.ok(check(good), 'and the real one still reads');
});

test('presence and bot snapshots are read defensively', () => {
  assert.equal(readPresence(null, 1), null);
  assert.equal(readPresence({ x: 'a', y: 1, r: 1 }, 1), null);
  assert.equal(readPresence({ x: 1, y: 1, r: 2 }, 1), null, 'another round');
  assert.equal(readPresence({ x: 99, y: 1, r: 1 }, 1), null);
  assert.deepEqual(readPresence({ x: 3.5, y: 2.5, r: 1, d: 7, w: 1, s: 2 }, 1), { x: 3.5, y: 2.5, d: 2, w: 1, s: 2 });
  assert.equal(readBots(null, 'r'), null);
  assert.equal(readBots({ rid: 'x', t: 1, p: [] }, 'r'), null);
  assert.equal(readBots({ rid: 'r', t: 1, p: [[1, 2, 3]] }, 'r'), null);
  assert.equal(readBots({ rid: 'r', t: 1, p: [[1, 2, 3, 0]], k: 5 }, 'r'), null);
  assert.ok(readBots({ rid: 'r', t: 1, p: [[1, 2, 3, 0]], k: [[1, 2, 3]] }, 'r'));
});

test('the banner gives way to play, bombs come from the host\'s check, and refusals tell the page', () => {
  const { room, clock } = makeRoom();
  const game = adapter(clock);
  const host = new Host(room, game);
  host.adopt();
  presence(room, 'h2', 13.5, 11.5, 1);
  presence(room, 'h1', 1.5, 1.5, 1);
  step(host, clock, 2000);
  assert.equal(readG(room).phase, 'banner');
  assert.equal(host.onMessage({ t: 'bomb', rid: 'm1.1', x: 13, y: 11 }, { id: 'h2' }), false, 'nothing during the banner');
  step(host, clock, 800);
  assert.equal(readG(room).phase, 'play');
  const rid = 'm1.1';
  assert.equal(host.onMessage({ t: 'bomb', rid, x: 13, y: 11 }, { id: 'h2' }), true);
  assert.equal(readG(room).bombs.length, 1, 'written at once');
  assert.deepEqual(readG(room).bombs[0].slice(0, 2), [13, 11]);
  assert.equal(readG(room).bombs[0][2], 1, 'p2\'s');
  const refused = (d, from = { id: 'h2' }) => {
    const before = room.sent.length;
    const ok = host.onMessage(d, from);
    return { ok, told: room.sent.length > before ? room.sent[room.sent.length - 1] : null };
  };
  step(host, clock, 200);
  const dup = refused({ t: 'bomb', rid, x: 13, y: 11 });
  assert.equal(dup.ok, false, 'already a bomb there / over the limit');
  assert.deepEqual(dup.told, { d: { t: 'no', rid, x: 13, y: 11 }, to: 'h2' }, 'the page is told so it can drop its guess');
  assert.equal(refused({ t: 'bomb', rid, x: 5, y: 5 }).ok, false, 'miles from where the player is');
  assert.equal(refused({ t: 'bomb', rid: 'old', x: 13, y: 11 }).ok, false, 'a message from another round');
  assert.equal(refused({ t: 'bomb', rid, x: 13.5, y: 11 }).ok, false);
  assert.equal(refused({ t: 'bomb', rid, x: 'a', y: 11 }).ok, false);
  assert.equal(refused({ t: 'bomb', rid, x: 99, y: 11 }).ok, false);
  assert.equal(refused({ t: 'bomb', rid }, { id: 'bot1' }).ok, false, 'a bot is not a page');
  assert.equal(refused({ t: 'bomb', rid, x: 13, y: 11 }, { id: 'stranger' }).ok, false, 'not at the table');
  assert.equal(refused({ t: 'what', rid }).ok, false);
  assert.equal(refused(null).ok, false);
  assert.equal(refused('bomb').ok, false);
  assert.equal(refused({ t: 'bomb', rid, x: 12, y: 11 }).ok, false, 'one bomb at the start');
  // the host's own bomb, with its own position
  game.self.x = 1.5;
  game.self.y = 1.5;
  assert.equal(host.onMessage({ t: 'bomb', rid, x: 1, y: 1 }, room.me), true);
  assert.equal(readG(room).bombs.length, 2);
  assert.ok(!room.sent.some((m) => m.to === 'h1'), 'nobody tells the host no by message');
});

test('a blast that gets someone is theirs to report; a shield takes it; the host answers and records', () => {
  const { room, clock } = makeRoom();
  const game = adapter(clock);
  const host = new Host(room, game);
  host.adopt();
  presence(room, 'h2', 13.5, 11.5, 1);
  presence(room, 'h1', 1.5, 1.5, 1);
  step(host, clock, T.bannerMs + 100);
  const rid = 'm1.1';
  host.onMessage({ t: 'bomb', rid, x: 13, y: 11 }, { id: 'h2' });
  step(host, clock, FUSE_MS + 60);
  const g = readG(room);
  assert.ok(g.fire.some((f) => f[0] === idx(13, 11)), 'the blast is in the record');
  assert.equal(host.onMessage({ t: 'out', rid, f: idx(5, 5) }, { id: 'h2' }), false, 'no fire there');
  assert.equal(host.onMessage({ t: 'out', rid, f: idx(13, 11) }, { id: 'h2' }), true);
  assert.ok(typeof readG(room).out.h2 === 'number', 'h2 is out');
  assert.equal(host.onMessage({ t: 'out', rid, f: idx(13, 11) }, { id: 'h2' }), false, 'once');
  assert.equal(host.onMessage({ t: 'out', rid, f: 'x' }, { id: 'h1' }), false);
  assert.ok(!('h1' in readG(room).out));
});

test('pick-ups: the first to say it gets it, and only if they are close', () => {
  const { room, clock } = makeRoom();
  const host = new Host(room, adapter(clock));
  host.adopt();
  presence(room, 'h2', 13.5, 11.5, 1);
  step(host, clock, T.bannerMs + 100);
  const sim = host.core.sim;
  sim.items.push({ i: idx(13, 10), k: 'r', born: 0 });
  sim.dirty = true;
  assert.equal(host.onMessage({ t: 'take', rid: 'm1.1', i: idx(13, 10) }, { id: 'h2' }), true);
  assert.equal(readG(room).pl.h2[1], 3, 'range up');
  assert.deepEqual(readG(room).items, []);
  assert.equal(host.onMessage({ t: 'take', rid: 'm1.1', i: idx(13, 10) }, { id: 'h2' }), false, 'gone');
  sim.items.push({ i: idx(3, 1), k: 'b', born: 0 });
  assert.equal(host.onMessage({ t: 'take', rid: 'm1.1', i: idx(3, 1) }, { id: 'h2' }), false, 'out of reach');
  assert.equal(host.onMessage({ t: 'take', rid: 'm1.1', i: 1e9 }, { id: 'h2' }), false);
});

test('kicks need the boot and a bomb next to you', () => {
  const { room, clock } = makeRoom();
  const host = new Host(room, adapter(clock));
  host.adopt();
  presence(room, 'h2', 12.5, 11.5, 1);
  step(host, clock, T.bannerMs + 100);
  const sim = host.core.sim;
  sim.stats.get('bot1').b = 1;
  sim.placeBomb('h2', 13, 11);
  host.flush(readG(room), true);
  const kick = { t: 'kick', rid: 'm1.1', x: 13, y: 11, dx: 0, dy: -1 };
  assert.equal(host.onMessage(kick, { id: 'h2' }), false, 'no boot');
  sim.stats.get('h2').k = 1;
  assert.equal(host.onMessage({ ...kick, dx: 3 }, { id: 'h2' }), false);
  assert.equal(host.onMessage({ ...kick, x: 1.5 }, { id: 'h2' }), false);
  assert.equal(host.onMessage(kick, { id: 'h2' }), true);
  const slide = host.core.sim.bombs[0];
  assert.deepEqual([slide.dx, slide.dy], [0, -1]);
  step(host, clock, 200);
  assert.ok(room.state.b && room.state.b.k.length === 1, 'the sliding bomb goes out with the bots\' snapshot');
  assert.equal(room.state.b.rid, 'm1.1');
  assert.ok(readBots(room.state.b, 'm1.1'));
  assert.equal(room.state.b.p.length, 2, 'two bots');
});

test('a whole match: rounds, scores, the final, and endMatch once; the record stays valid all along', () => {
  const { room, clock } = makeRoom({ settings: { wins: 2, map: 'cross' } });
  const game = adapter(clock);
  const host = new Host(room, game);
  host.adopt();
  const phases = [];
  let last = '';
  let rounds = new Set();
  let steps = 0;
  while (room.ended === 0 && steps++ < 30 * 60 * 60) {
    const g = readG(room);
    if (g) {
      if (!room.players.get('h2').presence || room.players.get('h2').presence.r !== g.rn) {
        presence(room, 'h1', 1.5, 1.5, g.rn);
        presence(room, 'h2', 13.5, 11.5, g.rn);
        game.self.x = 1.5;
        game.self.y = 1.5;
      }
      const key = `${g.rn}:${g.phase}`;
      if (key !== last) {
        phases.push(key);
        last = key;
        rounds.add(g.rn);
      }
    }
    step(host, clock, 30);
    if (room.ended === 0) assert.ok(readG(room), `the record is valid at ${clock.ms}`);
  }
  assert.equal(room.ended, 1, 'the host ended the match once the podium was done');
  const g = room.state.g;
  assert.equal(g.phase, 'final');
  const max = Math.max(...Object.values(g.wins));
  assert.ok(max >= 2 || g.rn >= roundCap(2));
  for (const n of rounds) {
    const mine = phases.filter((p) => p.startsWith(`${n}:`)).map((p) => p.split(':')[1]);
    assert.deepEqual(mine.slice(0, 4), ['banner', 'play', 'end', 'score'].slice(0, Math.min(4, mine.length)), `round ${n}: ${mine}`);
    assert.ok(mine.includes('score'), `round ${n} shows its result, the last one too`);
  }
  assert.equal(phases.at(-1), `${g.rn}:final`);
  assert.ok(Object.values(g.wins).reduce((a, b) => a + b, 0) <= g.rn, 'a round gives one win at most');
  host.pump();
  assert.equal(room.ended, 1, 'the match is over: the host does nothing more');
  // ids that belong to people but who stood still all match
  assert.ok(g.wins.h1 + g.wins.h2 <= g.rn);
});

test('a new host carries on from the record, mid-round, and the old one does nothing', () => {
  const { room, clock } = makeRoom({ others: ['h2', 'h3'] });
  const h1 = new Host(room, adapter(clock));
  h1.adopt();
  for (const id of ['h1', 'h2', 'h3']) presence(room, id, 1.5, 1.5, 1);
  presence(room, 'h2', 13.5, 11.5, 1);
  presence(room, 'h3', 13.5, 1.5, 1);
  step(h1, clock, T.bannerMs + 100);
  host1Place(h1, room);
  step(h1, clock, 20000);
  const before = readG(room);
  assert.equal(before.phase, 'play');
  const aliveBefore = before.roster.filter((r) => !(r.id in before.out)).map((r) => r.id);
  // the host drops: the role moves to h2's page
  room.host = 'h2';
  const room2 = Object.create(room);
  room2.me = room.players.get('h2');
  const h2 = new Host(room2, adapter(clock, { x: 13.5, y: 11.5 }));
  const sentBefore = JSON.stringify(room.state.g);
  h1.pump();
  assert.equal(JSON.stringify(room.state.g), sentBefore, 'the old host\'s page does nothing');
  h2.adopt();
  const after = readG(room2);
  assert.equal(after.by, 'h2');
  assert.equal(after.rid, before.rid);
  assert.equal(after.cr, before.cr, 'same crates');
  assert.equal(after.bombs.length, before.bombs.length);
  assert.deepEqual(after.out, before.out);
  step(h2, clock, 5000);
  const later = readG(room2);
  assert.ok(later.phase === 'play' || later.phase === 'end');
  assert.equal(later.by, 'h2');
  const aliveLater = later.roster.filter((r) => !(r.id in later.out)).map((r) => r.id);
  assert.ok(aliveLater.every((id) => aliveBefore.includes(id)), 'nobody came back from the dead');
  assert.ok(room2.state.b === undefined || room2.state.b.rid === later.rid);
  // adopting a banner and a score screen works too
  const { room: r3, clock: c3 } = makeRoom();
  const solo = new Host(r3, adapter(c3));
  solo.adopt();
  r3.state.g = { ...r3.state.g, by: 'gone' };
  const fresh = new Host(r3, adapter(c3));
  fresh.adopt();
  assert.equal(readG(r3).by, 'h1');
  assert.equal(readG(r3).phase, 'banner');
  assert.equal(fresh.core.n, 1);
  step(fresh, c3, T.bannerMs + 200);
  assert.equal(readG(r3).phase, 'play');
});

function host1Place(host, room) {
  host.onMessage({ t: 'bomb', rid: room.state.g.rid, x: 1, y: 1 }, room.me);
}

test('a person who walks away does not hold a round up: sudden death takes them', () => {
  const { room, clock } = makeRoom({ others: [] });
  const game = adapter(clock);
  const host = new Host(room, game);
  host.adopt();
  presence(room, 'h1', 1.5, 1.5, 1);
  let steps = 0;
  while (readG(room)?.phase !== 'end' && steps++ < 30 * 60 * 5) {
    step(host, clock, 33);
    if (steps === 3) presence(room, 'h1', 1.5, 1.5, readG(room).rn);
  }
  const g = readG(room);
  assert.equal(g.phase, 'end');
  assert.ok('h1' in g.out, 'the idle person is out');
  assert.ok(g.win !== 'h1');
});

test('badges: the host tells the right page, and only about real feats', () => {
  const { room, clock } = makeRoom();
  const game = adapter(clock);
  const host = new Host(room, game);
  host.adopt();
  host.badge('h1', 'chain-reaction');
  host.badge('h2', 'triple-trap');
  host.badge('bot1', 'untouched');
  host.badge('h2', 'free-money');
  assert.deepEqual(game.badges, ['chain-reaction']);
  assert.deepEqual(room.sent, [{ d: { t: 'badge', b: 'triple-trap' }, to: 'h2' }]);
});

test('standing in for the platform: the stub room runs a solo match and cleans up after it', () => {
  const room = createStubRoom();
  assert.equal(room.isHost, true);
  assert.equal(room.running, false);
  let started = 0;
  let ended = 0;
  room.on('matchstart', () => started++);
  room.on('matchend', () => ended++);
  const real = global.setTimeout;
  const timers = [];
  global.setTimeout = (fn) => timers.push(fn) && 1;
  try {
    room.startMatch();
    assert.equal(room.match.phase, 'starting');
    timers.shift()();
    assert.equal(room.match.phase, 'playing');
    assert.equal(started, 1);
    assert.equal(room.running, true);
    assert.ok(room.matchNow() >= 0);
    assert.deepEqual(room.participants.map((p) => p.id), ['me']);
    room.setState('g', { a: 1 });
    room.endMatch();
    assert.equal(ended, 1);
    assert.deepEqual(room.state, {});
    assert.equal(room.participants.length, 0);
    room.setSetting('wins', 5);
    assert.equal(room.settings.wins, 5);
    assert.equal(room.settings.map, 'classic');
  } finally {
    global.setTimeout = real;
  }
  assert.ok(COLS > 0 && ROWS > 0 && spawnOf(0)[0] === 1);
});
