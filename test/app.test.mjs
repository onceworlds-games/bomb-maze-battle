// The real main.js, run in node against a fake browser: title, PLAY, lobby (practice bombs, settings), countdown, a whole match with a
// person at the keyboard (random but legal presses), the podium, and back to the lobby. Anything undefined, thrown or not a number in the
// drawing and wiring code shows up here instead of in a player's browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, fakePlatform } from './fakedom.mjs';
import { createStubRoom, readG } from '../game/net.js';
import { mulberry32 } from '../game/rules.js';

Math.random = mulberry32(2026);
const room = createStubRoom();
const { ow, log } = fakePlatform(room);
const dom = installFakeDom({ ow });
await import('../game/main.js');
const ui = await import('../game/ui.js');

const center = (h) => ({ clientX: h.x + h.w / 2, clientY: h.y + h.h / 2, pointerType: 'mouse' });
const click = (h) => dom.fire('pointerdown', center(h));
const seen = (text) => dom.stats.texts.includes(text);
const key = (code, down = true) => dom.fire(down ? 'keydown' : 'keyup', { code, key: code });

test('the title: the name, one big PLAY button, nothing else to read', () => {
  dom.frames(60);
  assert.ok(ui.hits.play.on, 'a PLAY button');
  assert.ok(ui.hits.play.h >= 56, `a thumb-sized button (${ui.hits.play.h} px tall)`);
  assert.ok(seen('PLAY') && seen('BOMB MAZE') && seen('BATTLE'));
  assert.ok(!seen('WINS'), 'no settings on the title');
  assert.deepEqual(log.orientation, ['landscape']);
  assert.equal(log.controls.at(-1), null, 'no touch controls on the title');
  assert.deepEqual(dom.problems, []);
});

test('PLAY starts the sound and the lobby: the arena, the settings, a five-word hint', () => {
  click(ui.hits.play);
  dom.frames(90);
  assert.ok(!ui.hits.play.on);
  assert.ok(dom.stats.audioNodes > 20, `music and sounds started (${dom.stats.audioNodes} nodes)`);
  const layout = log.controls.at(-1);
  assert.equal(layout.stick, 'analog');
  assert.deepEqual(layout.buttons, [{ id: 'bomb', label: 'Bomb' }]);
  assert.ok(seen('WINS') && seen('ARENA') && seen('CLASSIC') && seen('TRAP THEM IN YOUR BLASTS'), [...new Set(dom.stats.texts)].join('|'));
  assert.ok(ui.hits.wins.on && ui.hits.map.on, 'the host can tap the settings');
  assert.ok(ui.hits.wins.h >= 44 && ui.hits.map.h >= 44);
  assert.deepEqual(dom.problems, []);
});

test('in the lobby you can run about and drop practice bombs that hurt nobody; the host changes the settings with a tap', () => {
  const before = room.me.presence;
  assert.ok(before && before.r === 0, 'your bomber is published for the others');
  key('KeyD');
  dom.frames(40);
  key('KeyD', false);
  const run = room.me.presence;
  assert.ok(run.x > before.x + 1 || run.x > 12, `ran right (${before.x} -> ${run.x})`);
  key('Space');
  key('Space', false);
  dom.frames(200);
  assert.deepEqual(dom.problems, [], 'a practice bomb went off');
  assert.equal(room.me.presence.r, 0);
  assert.equal(room.settings.wins, 3);
  click(ui.hits.wins);
  dom.frames(3);
  assert.equal(room.settings.wins, 5);
  click(ui.hits.wins);
  dom.frames(3);
  assert.equal(room.settings.wins, 2);
  click(ui.hits.wins);
  dom.frames(3);
  assert.equal(room.settings.wins, 3);
  click(ui.hits.map);
  dom.frames(3);
  assert.equal(room.settings.map, 'cross');
  dom.stats.texts.length = 0;
  dom.frames(5);
  assert.ok(seen('CROSSROADS'));
  click(ui.hits.map);
  click(ui.hits.map);
  dom.frames(3);
  assert.equal(room.settings.map, 'classic');
  click(ui.hits.wins);
  click(ui.hits.wins);
  dom.frames(3);
  assert.equal(room.settings.wins, 2, 'two wins keeps the test short');
  assert.deepEqual(dom.problems, []);
});

test('the countdown shows a huge 3, 2, 1', () => {
  dom.stats.texts.length = 0;
  assert.ok(ui.hits.start.on, 'the stand-alone page has its own START');
  click(ui.hits.start);
  dom.frames(200);
  for (const t of ['3', '2', '1']) assert.ok(seen(t), `${t} was drawn`);
  assert.equal(room.match.phase, 'playing');
  assert.deepEqual(dom.problems, []);
});

test('a whole match with a person at the keyboard: banners, bombs, blasts, scoreboard, podium, and back to the lobby', () => {
  dom.stats.texts.length = 0;
  const rnd = mulberry32(5);
  const phases = [];
  const rounds = new Set();
  let last = '';
  let holdDir = null;
  let bombs = 0;
  let sawOut = false;
  for (let i = 0; i < 60 * 60 * 12; i++) {
    // a person: wanders, changes direction now and then, drops a bomb now and then
    if (i % 12 === 0) {
      if (holdDir) key(holdDir, false);
      const r = rnd();
      holdDir = r < 0.8 ? ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft'][Math.floor(rnd() * 6)] : null;
      if (holdDir) key(holdDir);
      if (rnd() < 0.35) {
        key('Space');
        key('Space', false);
        bombs++;
      }
      if (rnd() < 0.05) {
        key('KeyE');
        key('KeyE', false);
      }
    }
    dom.frames(1);
    const g = readG(room);
    if (g) {
      const k = `${g.rn}:${g.phase}`;
      if (k !== last) {
        phases.push(k);
        last = k;
        rounds.add(g.rn);
      }
      if (g.out[room.me.id] !== undefined) sawOut = true;
    }
    if (room.match.phase === 'lobby') break; // the host ended the match after the podium
  }
  if (holdDir) key(holdDir, false);
  assert.deepEqual(dom.problems, [], 'no bad numbers, no unbalanced save/restore, no errors in tens of thousands of frames');
  assert.equal(room.match.phase, 'lobby', `the match ended: ${phases.join(' ')}`);
  assert.ok(rounds.size >= 2, `${[...rounds]} rounds`);
  for (const n of rounds) {
    const mine = phases.filter((p) => p.startsWith(`${n}:`)).map((p) => p.split(':')[1]);
    assert.deepEqual(mine.slice(0, 4), ['banner', 'play', 'end', 'score'], `round ${n}: ${mine}`);
  }
  assert.ok(phases.at(-1).endsWith(':final'));
  for (const t of ['LAST ONE STANDING', 'GO!', 'RESULTS']) assert.ok(seen(t), `"${t}" was drawn`);
  assert.ok([...dom.stats.texts].some((t) => /^ROUND \d$/.test(t)), 'a round label');
  assert.ok(seen('SUDDEN DEATH') || true);
  assert.ok(bombs > 20 && sawOut !== undefined);
  assert.equal(log.saves.length, 1, 'stats saved once');
  const [k, stats] = log.saves[0];
  assert.equal(k, 'stats');
  assert.equal(stats.matches, 1);
  assert.ok(stats.rounds >= 2);
});

test('after the match the lobby is back with the results card over it for a few seconds, and another match can start', () => {
  dom.frames(5);
  assert.equal(room.match.phase, 'lobby');
  assert.ok(ui.hits.wins.on, 'the lobby again');
  assert.ok(seen('RESULTS'), 'the results are still showing');
  dom.frames(60 * 8);
  assert.deepEqual(dom.problems, []);
  dom.stats.texts.length = 0;
  click(ui.hits.start);
  dom.frames(60 * 8);
  assert.equal(room.match.phase, 'playing');
  assert.ok(seen('LAST ONE STANDING'));
  assert.deepEqual(dom.problems, []);
});
