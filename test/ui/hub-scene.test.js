// test/ui/hub-scene.test.js — the drawn lobby scenes (ui/hubScene.js): which layers each theme carries now that the
// skyline is layered for parallax (far / mid / near ridge groups, ui/lobby.css `hub-parallax-*`), 霜原's aurora curtain,
// the light band of 霜原 / 烬野, and nothing of the sort on 静默. The reduced-motion and the dialog's 动效 switch are CSS
// (`@media (prefers-reduced-motion) .hub-scene *`, `[data-motion="off"] *`), so this also reads css/screens/lobby.css to
// keep both guards in place — the animations are decorative and must all be stoppable from one place.
// Hook-free vnode trees, like test/ui/lobby-hub.test.js: no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { HubScene, SCENE_IDS, HUB_SCENES } = await import('../../public/js/ui/hubScene.js');
const CSS = readFileSync(path.join(ROOT, 'public/css/screens/lobby.css'), 'utf8');

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const byClass = (tree, c) => [...walk(tree)].filter((v) => hasClass(v, c));

test('HubScene: 默认背景 draws nothing (the event’s own backdrop stays), the four drawn themes draw', () => {
  assert.equal(HubScene({ theme: 'official' }), null);
  assert.equal(HubScene({ theme: 'custom' }), null);
  for (const id of SCENE_IDS.filter((x) => x !== 'official')) {
    const v = HubScene({ theme: id });
    assert.ok(v, `${id} draws a scene`);
    assert.equal(v.props['data-hub-theme'], id);
    assert.equal(v.props['data-testid'], 'hub-scene');
    assert.ok(hasClass(v, 'hub-scene'));
  }
  assert.deepEqual(HUB_SCENES.map((s) => s.id), ['official', 'night', 'frost', 'ember', 'calm']);
});

test('the skyline is three parallax layers, the fortress and its lights in the middle one', () => {
  for (const theme of ['night', 'frost', 'ember', 'calm']) {
    const tree = HubScene({ theme });
    for (const k of ['hub-bg__layer--far', 'hub-bg__layer--mid', 'hub-bg__layer--near']) {
      assert.equal(byClass(tree, k).length, 1, `${theme}: one ${k}`);
    }
    const mid = byClass(tree, 'hub-bg__layer--mid')[0];
    assert.equal(byClass(mid, 'hub-bg__fort').length, 1, `${theme}: the fortress drifts with the middle ridge`);
    assert.equal(byClass(mid, 'hub-bg__windows').length, 1);
    assert.equal(byClass(mid, 'hub-bg__beacons').length, 1);
    // the far layer keeps the rim line and the two masts of the far range
    const far = byClass(tree, 'hub-bg__layer--far')[0];
    assert.equal(byClass(far, 'hub-bg__rim').length, 1, `${theme}: the rim belongs to the far layer`);
  }
});

test('霜原 has the aurora and the light band; 烬野 only the band; 静默 neither, and no motes', () => {
  const frost = HubScene({ theme: 'frost' });
  assert.equal(byClass(frost, 'hub-bg__aurora').length, 1);
  assert.equal(byClass(frost, 'hub-bg__sweep').length, 1);
  assert.equal(byClass(frost, 'hub-bg__mote').length, 26);
  assert.equal(byClass(frost, 'hub-bg__stars').length, 1);

  const ember = HubScene({ theme: 'ember' });
  assert.equal(byClass(ember, 'hub-bg__aurora').length, 0, 'ember keeps its own warm ridge, no aurora');
  assert.equal(byClass(ember, 'hub-bg__sweep').length, 1);

  const calm = HubScene({ theme: 'calm' });
  assert.equal(byClass(calm, 'hub-bg__aurora').length, 0);
  assert.equal(byClass(calm, 'hub-bg__sweep').length, 0);
  assert.equal(byClass(calm, 'hub-bg__mote').length, 0, '静默 has always been the still one');
  assert.equal(byClass(calm, 'hub-bg__stars').length, 0);
});

test('the animations: every new one is declared, and reduced motion / 动效 off stop them all', () => {
  for (const k of ['hub-parallax-far', 'hub-parallax-mid', 'hub-parallax-near', 'hub-haze', 'hub-aurora', 'hub-sweep-band']) {
    assert.match(CSS, new RegExp(`@keyframes ${k}\\b`), `${k} is defined`);
  }
  assert.match(CSS, /\.hub-bg__layer\s*\{[^}]*animation:\s*hub-parallax-far/);
  assert.match(CSS, /\.hub-bg__layer--mid\s*\{[^}]*hub-parallax-mid/);
  assert.match(CSS, /\.hub-bg__layer--near\s*\{[^}]*hub-parallax-near/);
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.hub-scene \* \{ animation: none; \}/,
    'prefers-reduced-motion stops every scene animation');
  assert.match(CSS, /\[data-motion="off"\] \*[^{]*\{ animation: none !important; \}/,
    'the dialog’s 动效 switch stops them too');
});
