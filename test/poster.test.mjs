// Store art: every poster draws at its exact size with the real renderer, says when it is ready, needs no platform, and is the same
// picture every time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fakedom.mjs';

const SIZES = { cover: [1280, 720], action: [1280, 720], win: [1280, 720], icon: [512, 512], 'badge-first-win': [256, 256], 'badge-chain-reaction': [256, 256], 'badge-triple-trap': [256, 256], 'badge-untouched': [256, 256] };

test('every poster: its size, no platform, ready when drawn, drawn the same way twice', async () => {
  const dom = installFakeDom({ width: 100, height: 100 });
  const { runPoster } = await import('../game/poster.js');
  for (const [name, [w, h]] of Object.entries(SIZES)) {
    dom.problems.length = 0;
    const sums = [];
    for (let run = 0; run < 2; run++) {
      document.body.dataset.ready = '';
      dom.stats.sum = 0;
      dom.stats.texts.length = 0;
      const before = dom.stats.calls;
      await runPoster(name);
      sums.push(dom.stats.sum);
      assert.equal(document.body.dataset.ready, '1', `${name}: ready`);
      assert.equal(dom.canvas.width, w, `${name}: width`);
      assert.equal(dom.canvas.height, h, `${name}: height`);
      assert.ok(dom.stats.calls - before > 25, `${name}: something was drawn`);
      assert.equal(globalThis.onceworlds, undefined, 'no platform needed');
    }
    assert.deepEqual(dom.problems, [], `${name}: no bad numbers`);
    assert.equal(sums[0], sums[1], `${name}: the same picture every time`);
    if (name === 'cover') assert.deepEqual(dom.stats.texts, ['BOMB MAZE', 'BATTLE'], 'the cover has only the title');
    else assert.ok(!dom.stats.texts.some((t) => t.length > 1), `${name}: no words`);
  }
  assert.ok(Object.keys(SIZES).length === 8);
  await runPoster('nonsense');
  assert.equal(document.body.dataset.ready, '1', 'an unknown name still draws something');
});
