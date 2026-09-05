import assert from 'node:assert/strict';
import test from 'node:test';
import { LayerReveal } from '../src/studio/engine/layerReveal.ts';

for (const angle of [0, 90, -90, 180, 45]) {
  test(`reveal endpoints remain exact, angle ${angle}`, () => {
    const mask = new LayerReveal(200, 80);
    for (const feather of [0, 20, 1000]) {
      for (const [progress, expected] of [[0, 0], [100, 1]]) {
        mask.update(progress!, angle, feather);
        for (const u of [0, 0.5, 1]) for (const v of [0, 0.5, 1]) {
          assert.equal(mask.alphaAt(u, v), expected);
        }
      }
    }
  });
}

test('horizontal and vertical swipes respect source coordinates', () => {
  const mask = new LayerReveal(200, 80);
  mask.update(50, 0, 0);
  assert.equal(mask.alphaAt(0.25, 0.5), 1);
  assert.equal(mask.alphaAt(0.75, 0.5), 0);
  mask.update(50, 180, 0);
  assert.equal(mask.alphaAt(0.25, 0.5), 0);
  assert.equal(mask.alphaAt(0.75, 0.5), 1);
  mask.update(50, 90, 0);
  assert.equal(mask.alphaAt(0.5, 0.75), 1);
  assert.equal(mask.alphaAt(0.5, 0.25), 0);
});

test('feather is continuous and remains inside the opening edge', () => {
  const mask = new LayerReveal(200, 80);
  mask.update(50, 0, 20);
  assert.equal(mask.alphaAt(0.4, 0.5), 1);
  assert.ok(Math.abs(mask.alphaAt(0.5, 0.5) - 0.5) < 1e-10);
  assert.equal(mask.alphaAt(0.6, 0.5), 0);
  mask.update(99.999, 0, 20);
  assert.ok(mask.alphaAt(1, 0.5) > 0.999);
});
