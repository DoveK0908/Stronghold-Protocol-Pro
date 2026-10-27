// test/render/vfx-dim.test.js — the per-effect opacity scale (render/vfx/effect.js FX_DIM + materials.js
// compileMaterial `dim`). Owner report behind it (2026-10-26): 「结城理的脚下特效太亮太突兀了」 — the prefabs are the
// official ones, so the brightness is ours to tune, and the tuning lives in one table keyed by the prefab key instead of
// in the extracted assets (a re-extraction must not undo it).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { FX_DIM, dimOf } from '../../public/js/render/vfx/effect.js';
import { compileMaterial } from '../../public/js/render/vfx/materials.js';

const mat = (o = {}) => ({
  name: 'm', shader: o.shader || 'Torappu/Particles/Additive',
  passes: [{ blend: ['SrcAlpha', 'One', 'Zero', 'OneMinusSrcAlpha'], blendOp: 'Add', zTest: 'Disabled', zWrite: false, cull: 'Off', colorMask: 15 }],
  queue: 'Transparent', keywords: [], floats: { ...(o.floats || {}) }, colors: { ...(o.colors || {}) },
  textures: { _MainTex: { tex: 't', st: [1, 1, 0, 0] } },
});

describe('FX_DIM', () => {
  test('unlisted keys are untouched (dim 1)', () => {
    assert.equal(dimOf(undefined), 1);
    assert.equal(dimOf(''), 1);
    assert.equal(dimOf('char_4182_oblvns_attack_01'), 1);
  });

  test('a listed key returns its scale, and every entry is a real 0…1 factor', () => {
    for (const [key, v] of Object.entries(FX_DIM)) {
      assert.ok(typeof key === 'string' && key.length, 'key');
      assert.ok(Number.isFinite(v) && v > 0 && v <= 1, `${key} = ${v}`);
    }
    assert.equal(dimOf('makoto_skill_02_range_01'), FX_DIM.makoto_skill_02_range_01);
  });

  test('every listed key is a prefab in the local fx index (skipped without the assets)', () => {
    const f = 'public/assets/local/fx/index.json';
    if (!existsSync(f)) return;
    const idx = JSON.parse(readFileSync(f, 'utf8'));
    const keys = new Set();
    const walk = (v) => {
      if (!v || typeof v !== 'object') return;
      if (Array.isArray(v)) { for (const x of v) walk(x); return; }
      for (const [k, x] of Object.entries(v)) {
        if (k === 'effects' || k === 'uses') { if (Array.isArray(x)) for (const e of x) if (typeof e === 'string') keys.add(e); }
        else if (k === 'key' && typeof x === 'string') keys.add(x);
        walk(x);
      }
    };
    walk(idx);
    for (const key of Object.keys(FX_DIM)) assert.ok(keys.has(key), `${key} is not in index.json`);
  });
});

describe('compileMaterial dim', () => {
  test('none: the compiled material keeps the authored values', () => {
    const m = compileMaterial(mat({ floats: { _Opacity: 1 }, colors: { _TintColor: [1, 1, 1, 1] } }));
    assert.equal(m.floats._Opacity, 1);
    assert.deepEqual(m.vecs._TintColor, [1, 1, 1, 1]);
  });

  test('a dim factor scales _Opacity and the tint alpha, and invents a tint when the shader has none', () => {
    const a = compileMaterial(mat({ floats: { _Opacity: 0.8 }, colors: { _TintColor: [1, 1, 1, 0.5] } }), { dim: 0.5 });
    assert.equal(a.floats._Opacity, 0.4);
    assert.deepEqual(a.vecs._TintColor, [1, 1, 1, 0.25]);
    const b = compileMaterial(mat(), { dim: 0.4 });
    assert.equal(b.floats._Opacity, 0.4);
    assert.deepEqual(b.vecs._MainColor, [1, 1, 1, 0.4]);
    assert.deepEqual(b.vecs._TintColor, [1, 1, 1, 0.4]);
  });

  test('dim is clamped to 0…1 and junk falls back to 1', () => {
    assert.equal(compileMaterial(mat({ floats: { _Opacity: 1 } }), { dim: 2 }).floats._Opacity, 1);
    assert.equal(compileMaterial(mat(), { dim: -1 }).vecs._MainColor[3], 0);
    assert.equal(compileMaterial(mat(), { dim: NaN }).floats._Opacity, undefined);
  });
});
