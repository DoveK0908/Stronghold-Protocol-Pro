// Shots leave the weapon, not the middle of the sprite: the launch point of a procedural projectile is offset by the
// drawn model's Muzzle bone (the attack clip's strike pose), and falls back to the old body-centred point when the unit
// has no drawn skeleton (2D board, no spine, a harness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { muzzleOffset } from '../../public/js/render/fx/projectiles.js';

test('muzzleOffset reads the Muzzle bone of the drawn model, at the strike frame', () => {
  const calls = [];
  const view = {
    boneOffset(names, out, strike) {
      calls.push({ names, strike });
      out.x = 0.21; out.up = 0.55; out.angle = 0; out.flip = 1;
      return out;
    },
  };
  const o = muzzleOffset(view);
  assert.deepEqual(o, { x: 0.21, up: 0.55, angle: 0, flip: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].strike, true, 'posed at the attack clip strike frame');
  assert.deepEqual(calls[0].names, ['Muzzle', 'MuzzlePoint', 'muzzle'], 'the same names as render/vfx/mounts.js');
});

test('muzzleOffset is null without a model / a bone / finite numbers', () => {
  assert.equal(muzzleOffset(null), null);
  assert.equal(muzzleOffset({}), null, 'no boneOffset (2D board path)');
  assert.equal(muzzleOffset({ boneOffset: () => null }), null, 'no such bone on this model');
  assert.equal(muzzleOffset({ boneOffset: () => ({ x: NaN, up: 0 }) }), null);
});

test('the shot origin and the muzzle flash both take the offset, scaled from tiles to pixels', () => {
  const src = readSource();
  assert.match(src, /const mo = muzzleOffset\(src\);\n\s*pr\.ox = mo \? mo\.x : 0; pr\.oy = mo \? -mo\.up : 0;/, 'attack() records it');
  assert.match(src, /if \(pr\.ox \|\| pr\.oy\) \{ p\.x \+= pr\.ox \* p\.s; p\.y \+= pr\.oy \* p\.s; \}/, '_shotPoint applies it in screen space');
  assert.match(src, /const p = this\._shotPoint\(pr, 0, cam, this\._g\);/, 'the muzzle flash starts where the shot does');
  assert.match(src, /if \(k < pr\.rise && \(pr\.ox \|\| pr\.oy\)\)/, 'a mortar shell leaves the barrel, not the body');
});

function readSource() {
  const url = new URL('../../public/js/render/fx/projectiles.js', import.meta.url);
  return readFileSync(url, 'utf8');
}
