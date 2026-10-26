// Shots leave the weapon, not the middle of the sprite. Two layers do it:
//   * UnitView.muzzlePoint() (render/units.js) answers "where is the weapon in CANVAS pixels" off the drawn spine;
//   * FxSystem._launchOffsetLive / _viewMuzzleOffset (render/fx/projectiles.js) turn that into a per-frame screen delta
//     from the shot's own projected start point, faded out along the flight so the shot still lands on the target.
// A model that is not drawn (2D board, no spine, a harness) has no muzzle point: the tile offset `attack()` measures
// (`pr.ox` / `pr.oy`) is the fallback then, and it still goes through the camera's scale.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { muzzleOffset, muzzleBones } from '../../public/js/render/fx/projectiles.js';
import { boneNames } from '../../public/js/render/vfx/mounts.js';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';

const cam = presetCamera('normal', { width: 1600, height: 900 });

let fake, FX;
before(async () => {
  fake = installFakePixi();
  FX = await import('../../public/js/render/fx.js');
});
after(() => fake.restore());

/** A unit view as the FX layer reads it. */
const unit = (id, x, y, o = {}) => ({ id, x, y, z: 0, hover: 0, _headTiles: 1.2, alive: true, destroyed: false, info: { defId: 'char_x' }, onHit() {}, ...o });

function makeFx(views) {
  const P = fake.P;
  const ctx = fakeViewCtx(P);
  const map = new Map(views.map((v) => [v.id, v]));
  const fx = new FX.FxSystem({
    P, layers: ctx.layers, cam: () => cam, heightAt: () => 0, settings: { quality: 'high', damageNumbers: true },
    timeScale: () => 2, loadLevel: () => 0, subProfOf: () => null, view: (id) => map.get(id) || null,
    screenSize: () => ({ width: 1600, height: 900 }), fieldTop: () => 120,
  });
  return { fx, map };
}

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
  assert.deepEqual(calls[0].names, boneNames('muzzle'), 'the very same candidate list the official-effect layer uses (render/vfx/mounts.js)');
});

test('the weapon bones of the official-effect layer are what the procedural shots look for too', () => {
  const names = boneNames('muzzle');
  // The two lists had drifted apart: mounts.js grew `OriginMuzzle` / `Gun` / `Weapon` / the hands and the fuzzy name
  // patterns (伊内丝's `F_OriginMuzzle`, 德克萨斯's `F_Gun`), while this path still tried the bare `Muzzle` names only —
  // so those operators kept shooting from the middle of the sprite.
  for (const n of ['Muzzle', 'F_Muzzle', 'B_Muzzle', 'MuzzlePoint', 'OriginMuzzle', 'F_OriginMuzzle', 'Gun', 'F_Gun', 'Weapon', 'HandHold', 'R_Hand', 'L_Hand']) {
    assert.ok(names.includes(n), `${n} is tried`);
  }
  assert.ok(names.some((n) => n instanceof RegExp && n.test('F_GunPoint')), 'a weapon bone named off-pattern still matches');
  assert.ok(!names.some((n) => n instanceof RegExp && n.test('HeadPoint')), 'the muzzle patterns do not swallow the head bone');
  assert.equal(muzzleBones().length, names.length, 'muzzleBones() is that list, not a copy that can drift again');
});

test('a Special point asks for its own bone, then the weapon / hand bones (not an empty list)', () => {
  // Spawn Special0..Special5 (index `s0`..`s5`) are the client's per-skin targets for casts, auras and funnels. They had
  // no POINT_NAMES entry, so the candidate list came back empty and every effect on one was placed at the chest.
  const s0 = boneNames('s0'), s2 = boneNames('s2');
  assert.ok(s0.length > 0, 'a Special point has bones to look for');
  for (const n of ['SpecialPoint0', 'F_SpecialPoint0', 'B_SpecialPoint0', 'F_Muzzle', 'F_Gun', 'F_HandHold']) assert.ok(s0.includes(n), `${n} is tried for s0`);
  for (const n of ['SpecialPoint2', 'F_SpecialPoint2', 'F_Muzzle']) assert.ok(s2.includes(n), `${n} is tried for s2`);
  assert.equal(boneNames('muzzle').length, 40, 'the muzzle list is the weapon / hand fallback the Special points add to');
  for (const n of boneNames('muzzle').filter((n) => typeof n === 'string')) assert.ok(s0.includes(n), `${n} is still tried on a Special point`);
});

test('muzzleOffset is null without a model / a bone / finite numbers', () => {
  assert.equal(muzzleOffset(null), null);
  assert.equal(muzzleOffset({}), null, 'no boneOffset (2D board path)');
  assert.equal(muzzleOffset({ boneOffset: () => null }), null, 'no such bone on this model');
  assert.equal(muzzleOffset({ boneOffset: () => ({ x: NaN, up: 0 }) }), null);
});

describe('the launch correction is a per-frame screen delta onto the bone', () => {
  test('at k = 0 the shot head sits exactly on muzzlePoint(); the delta fades to 0 by the target', () => {
    const src = unit(1, 3, 10), tgt = unit(2, 9, 10, { isEnemy: true });
    const { fx } = makeFx([src, tgt]);
    // the bone answer is deliberately far from the body centre: the correction must move the head all the way there
    const bone = { x: 1000, y: 500, bone: 'F_Gun' };
    src.muzzlePoint = () => bone;
    fx.attack(src, tgt, 'arrow');
    const pr = fx.projs[0];
    const base = cam.project(pr.x0, pr.y0, pr.z0, { x: 0, y: 0, s: 0, depth: 0 });
    const head = fx._shotPoint(pr, 0, cam, { x: 0, y: 0, s: 0, depth: 0 });
    assert.ok(Math.abs(head.x - bone.x) < 1e-6 && Math.abs(head.y - bone.y) < 1e-6, `launched on the weapon (${head.x}, ${head.y} ≈ ${bone.x}, ${bone.y})`);
    assert.equal(pr.bone, 'F_Gun', 'the bone it fired from is recorded for debugging');
    const end = fx._shotPoint(pr, 1, cam, { x: 0, y: 0, s: 0, depth: 0 });
    const plainEnd = cam.project(pr.tx, pr.ty, pr.tz, { x: 0, y: 0, s: 0, depth: 0 });
    assert.ok(Math.abs(end.x - plainEnd.x) < 1e-6 && Math.abs(end.y - plainEnd.y) < 1e-6, 'the offset is spent: it still lands on the target');
    // half way: half the offset (a linear fade, not an on/off switch)
    const half = fx._shotPoint(pr, 0.5, cam, { x: 0, y: 0, s: 0, depth: 0 });
    const plainHalf = cam.project(pr.x0 + (pr.tx - pr.x0) * 0.5, pr.y0 + (pr.ty - pr.y0) * 0.5, pr.z0 + (pr.tz - pr.z0) * 0.5, { x: 0, y: 0, s: 0, depth: 0 });
    assert.ok(Math.abs(half.x - plainHalf.x - (bone.x - base.x) * 0.5) < 1e-6, `half way is half the correction (${half.x - plainHalf.x})`);
  });

  test('the correction follows the camera every frame instead of being frozen at fire time', () => {
    const src = unit(1, 3, 10), tgt = unit(2, 9, 10, { isEnemy: true });
    let bone = { x: 400, y: 300, bone: 'Muzzle' };
    src.muzzlePoint = () => bone;
    const { fx } = makeFx([src, tgt]);
    fx.attack(src, tgt, 'arrow');
    const pr = fx.projs[0];
    const a = fx._shotPoint(pr, 0, cam, { x: 0, y: 0, s: 0, depth: 0 }).x;
    bone = { x: 700, y: 300, bone: 'Muzzle' };
    const b = fx._shotPoint(pr, 0, cam, { x: 0, y: 0, s: 0, depth: 0 }).x;
    assert.ok(Math.abs(a - 400) < 1e-6 && Math.abs(b - 700) < 1e-6, `re-measured each frame (${a} → ${b})`);
  });

  test('a model with no muzzle point falls back to the tile offset attack() measured', () => {
    const src = unit(1, 3, 10), tgt = unit(2, 9, 10, { isEnemy: true });
    const { fx } = makeFx([src, tgt]);        // no muzzlePoint on this view
    fx.attack(src, tgt, 'arrow');
    const pr = fx.projs[0];
    assert.ok(pr.ox > 0 && pr.oy < 0, `the weapon-side guess is kept (${pr.ox}, ${pr.oy})`);
    const o = fx._launchOffsetLive(pr, { dx: 0, dy: 0 });
    const s = cam.project(pr.x0, pr.y0, pr.z0, { x: 0, y: 0, s: 0, depth: 0 }).s;
    assert.ok(Math.abs(o.dx - pr.ox * s) < 1e-6 && Math.abs(o.dy - pr.oy * s) < 1e-6, 'applied through the camera scale, as before');
    assert.equal(pr.bone, null);
  });

  test('a non-finite bone point is dropped, not turned into an off-screen effect', () => {
    const src = unit(1, 3, 10), tgt = unit(2, 9, 10, { isEnemy: true });
    src.muzzlePoint = () => ({ x: NaN, y: 100, bone: 'Muzzle' });
    const { fx } = makeFx([src, tgt]);
    fx.attack(src, tgt, 'arrow');
    const pr = fx.projs[0];
    const o = fx._launchOffsetLive(pr, { dx: 0, dy: 0 });
    assert.ok(Number.isFinite(o.dx) && Number.isFinite(o.dy));
    assert.equal(o.dx, pr.ox * cam.project(pr.x0, pr.y0, pr.z0, { x: 0, y: 0, s: 0, depth: 0 }).s, 'a broken bone leaves the fallback');
  });

  test('a beam (and the fire jet) take the same correction; a chain bounce keeps its chest origin', () => {
    const a = unit(1, 3, 10), b = unit(2, 8, 10, { isEnemy: true });
    a.muzzlePoint = () => ({ x: 900, y: 400, bone: 'F_Gun' });
    const { fx } = makeFx([a, b]);
    // the base is the point the effect is DRAWN from, so it is passed in already projected
    const base = fx._bodyPt(a, 0.45, { x: 0, y: 0, s: 0, depth: 0 });
    const o = fx._viewMuzzleOffset(a, base);
    assert.equal(o.has, true, 'the real bone was used');
    assert.ok(Math.abs(o.dx - (900 - base.x)) < 1e-6 && Math.abs(o.dy - (400 - base.y)) < 1e-6, 'a plain same-space subtraction');
    // no model → no correction, the old chest point stands
    const o2 = fx._viewMuzzleOffset(unit(3, 5, 5), { x: 5, y: 5 });
    assert.equal(o2.has, false);
    assert.equal(o2.dx, 0);
    const o3 = fx._viewMuzzleOffset(null, { x: 5, y: 5 });
    assert.equal(o3.has, false);
    const o4 = fx._viewMuzzleOffset(a, { x: NaN, y: 0 });
    assert.equal(o4.has, false, 'a broken base point is refused, not turned into an off-screen effect');
    // the wires themselves: a plain beam asks for the muzzle, a chain bounce does not
    const beamSrc = readSource('beams.js');
    assert.match(beamSrc, /if \(!bm\.chain\) \{/, 'a bounce keeps the previous target\'s chest as its origin');
    assert.match(beamSrc, /const o = this\._viewMuzzleOffset\(bm\.a, p\);/, 'a beam leaves the caster\'s weapon, corrected from the point it draws');
    assert.match(beamSrc, /const mo = this\._viewMuzzleOffset\(sv, m\);/, 'the fire jet leaves the dragon\'s mouth/weapon, not its chest centre');
    assert.doesNotMatch(beamSrc, /bodyZ\(/, 'never re-project a world height to find the base: the drawn lift is a screen lift');
  });
});

test('the shot origin, the muzzle flash and the shell rise all use the live correction', () => {
  const src = readSource();
  // the fallback measured at fire time stays (a model that is not drawn has nothing better)
  assert.match(src, /const mo = muzzleOffset\(src\);/, 'attack() still asks the model for the tile offset');
  assert.match(src, /if \(mo\) \{ pr\.ox = mo\.x; pr\.oy = -mo\.up; \}/, 'a drawn model: the muzzle bone wins');
  assert.match(src, /pr\.ox = \(\(src\.visFacing \?\? src\.facing \?\? 1\) < 0 \? -1 : 1\) \* 0\.14;/, 'no model yet: the weapon side, not the middle');
  assert.match(src, /pr\.oy = -0\.36 \* head;/, 'no model yet: chest height');
  assert.match(src, /pr\.bone = null;/, 'reset per shot: the bone is recorded by the live path');
  // …and the live path: a canvas-pixel delta from the shot's own projected start, faded out along the flight
  assert.match(src, /_launchOffsetLive\(pr, out\) \{/, 'the per-frame measurement');
  assert.match(src, /dx = mp\.x - base\.x; dy = mp\.y - base\.y;/, 'a same-space subtraction (never a cam.unproject)');
  assert.match(src, /const w = 1 - k;/, 'the correction fades with the flight');
  assert.match(src, /const o = this\._launchOffsetLive\(pr, this\._launchO\);/, '_shotPoint takes it every frame');
  assert.match(src, /p\.x \+= o\.dx \* w; p\.y \+= o\.dy \* w;/, 'applied in screen pixels, weighted by (1 - k)');
  assert.match(src, /const p = this\._shotPoint\(pr, 0, cam, this\._g\);/, 'the muzzle flash starts where the shot does');
  assert.match(src, /if \(k < pr\.rise\) \{/, 'a mortar shell leaves the barrel, not the body');
  assert.match(src, /const w = 1 - k \/ pr\.rise;/, 'and its rise spends the same correction');
  // …and the flash of a mortar shell: its base is the drawn point, not a re-projection of a world height
  assert.match(src, /const mo = this\._viewMuzzleOffset\(src, p\);/, 'the shell\'s flash is corrected from the point it draws');
});

function readSource(file = 'projectiles.js') {
  const url = new URL(`../../public/js/render/fx/${file}`, import.meta.url);
  return readFileSync(url, 'utf8');
}
