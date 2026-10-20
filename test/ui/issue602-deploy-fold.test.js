// Public issue #602: "[Feature] 操作体验优化：部署干员、装备时棋盘缩放". 0.3.0 took PR #646: picking a piece up on the
// own prep board (and a legal drop's direction wheel) folded the shop and zoomed the board to issue #5's
// shop-collapsed camera, then restored the player's own fold. The owner removed it on 2026-10-16
// (「移除准备期拖动部署干员时的自动地图缩放」) and put it back on 2026-10-19 as 设置「部署时收起商店」 — OPT-IN in this
// fork (default off), against the official default of on.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GEO } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const gameLogic = await import('../../public/js/ui/gameLogic.js');
const { deployFoldsShop, deployZoomStep, deployZoomRemember, prepDeployCamera, foldCamera, DEFAULT_SETTINGS, sanitizeSettings } = gameLogic;

// ---- the switch: off by default in this fork, only an explicit true turns it on -------------------------------------

describe('设置「部署时收起商店」 is opt-in here', () => {
  test('the default is off (the owner\'s decision of 2026-10-19; the official default is on)', () => {
    assert.equal(DEFAULT_SETTINGS.prepDeployFold, false);
  });

  test('sanitizeSettings turns it on only for an explicit true', () => {
    assert.equal(sanitizeSettings(null).prepDeployFold, false);
    assert.equal(sanitizeSettings({}).prepDeployFold, false);
    assert.equal(sanitizeSettings({ prepDeployFold: false }).prepDeployFold, false);
    assert.equal(sanitizeSettings({ prepDeployFold: true }).prepDeployFold, true);
    assert.equal(sanitizeSettings({ prepDeployFold: 'yes' }).prepDeployFold, false, 'junk stays off');
  });

  test('the dialog offers the switch, under 盟约效果剩余时间', () => {
    const dialog = read('public/js/ui/settings.js');
    assert.match(dialog, /label=\$\{t\('部署时收起商店'\)\} micro="DEPLOY FOLD" value=\$\{s\.prepDeployFold\}/);
    assert.match(dialog, /拿起干员部署、装备或调整位置时/);
  });
});

// ---- what a deploy interaction folds ------------------------------------------------------------------------------

describe('deployFoldsShop: the own prep board, a piece carried or its wheel open', () => {
  const base = { ownPrep: true, editable: true, pen: false };

  test('a drag or the direction wheel folds, on the own editable prep board', () => {
    assert.equal(deployFoldsShop({ ...base, drag: true, enabled: true }), true);
    assert.equal(deployFoldsShop({ ...base, facing: true, enabled: true }), true);
  });

  test('nothing else does: the setting off, the opponent\'s pen, not the own board, nothing carried', () => {
    assert.equal(deployFoldsShop({ ...base, drag: true, enabled: false }), false, 'the switch is off');
    assert.equal(deployFoldsShop({ ...base, drag: true }), true, 'enabled omitted stays on (the 0.3.2 module default); game.js always passes the switch');
    assert.equal(deployFoldsShop({ ...base, drag: true, pen: true, enabled: true }), false, 'over the opponent\'s pen');
    assert.equal(deployFoldsShop({ ...base, ownPrep: false, drag: true, enabled: true }), false, 'watching a teammate');
    assert.equal(deployFoldsShop({ ...base, editable: false, drag: true, enabled: true }), false, 'not our turn');
    assert.equal(deployFoldsShop({ ...base, enabled: true }), false, 'nothing carried');
    assert.equal(deployFoldsShop(null), false);
  });
});

describe('prepDeployCamera: the deploy zoom, then the player\'s own fold again', () => {
  const pl = (id, seat) => ({ playerId: id, seat, alive: true });
  const pub = { round: 6, bossRound: 14, hiddenRound: 15, players: [pl('a', 0), pl('b', 1)] };
  const shopCam = { kind: 'prep', opts: { rect: { ...GEO.NORMAL_RECT }, side: 'L' } };
  const zoomedCam = { kind: 'prep', opts: { rect: { ...GEO.NORMAL_RECT }, side: 'L', shop: false } };

  test('a deploy fold zooms to the shop-collapsed camera, and the zoom is not re-flown once it is in use', () => {
    const first = prepDeployCamera({ pub, myId: 'a', deployFold: true, folded: false, ownPrep: true, pen: false, busy: true, current: shopCam });
    assert.equal(first?.kind, 'prep');
    assert.equal(first?.opts?.shop, false, 'the shop-collapsed framing (issue #5)');
    const again = prepDeployCamera({ pub, myId: 'a', deployFold: true, folded: false, ownPrep: true, pen: false, busy: true, current: first });
    assert.equal(again, null, 'already there: no second flight every frame');
  });

  test('with the switch off a carried piece defers the hand-made fold (issue #5)', () => {
    assert.equal(prepDeployCamera({ pub, myId: 'a', deployFold: false, folded: true, ownPrep: true, pen: false, busy: true, current: shopCam }), null);
  });

  test('releaseDeploy skips that deferral for the one frame the zoom is given back', () => {
    const next = prepDeployCamera({ pub, myId: 'a', deployFold: false, releaseDeploy: true, folded: false, ownPrep: true, pen: false, busy: true, current: zoomedCam });
    assert.equal(next?.opts?.shop, true, 'the player\'s shop camera comes back while the piece is still held');
  });

  test('deployZoomStep / deployZoomRemember: turning the switch off mid-drag releases on that frame only', () => {
    assert.deepEqual(deployZoomStep(false, true), { release: false, zoomed: true });
    assert.deepEqual(deployZoomStep(true, false), { release: true, zoomed: false });
    assert.deepEqual(deployZoomStep(true, true), { release: false, zoomed: true });
    assert.equal(deployZoomRemember({ release: true, zoomed: false }, { next: null, pen: true }), true, 'the pen kept the camera: still owed');
    assert.equal(deployZoomRemember({ release: true, zoomed: false }, { next: { kind: 'prep', opts: {} }, pen: true }), false, 'the release flew: spent');
    assert.equal(deployZoomRemember({ release: true, zoomed: false }, { next: null, pen: false }), false, 'already at the player\'s fold: spent');
    assert.equal(deployZoomRemember({ release: false, zoomed: true }, { next: null, pen: false }), true, 'a deploy zoom in effect stays remembered');
  });

  test('a hand-made fold still flies when nothing is carried', () => {
    const next = prepDeployCamera({ pub, myId: 'a', deployFold: false, folded: true, ownPrep: true, pen: false, busy: false, current: shopCam });
    assert.equal(next?.opts?.shop, false);
    assert.equal(foldCamera({ pub, myId: 'a', folded: true, ownPrep: true, current: shopCam })?.opts?.shop, false);
  });
});

// ---- the wiring (screens/game.js) ---------------------------------------------------------------------------------

describe('game.js wiring', () => {
  const game = read('public/js/screens/game.js');

  test('the deploy fold is derived from the interaction state and the switch', () => {
    assert.match(game, /const deployFold = deployFoldsShop\(\{/);
    assert.match(game, /enabled: playerSettings\.prepDeployFold === true/);
    assert.match(game, /const barCollapsed = collapsed \|\| deployFold;/);
    assert.match(game, /const shopFolded = showShop && \(pen \? penRef\.current\.collapsed : \(collapsed \|\| deployFold\)\);/);
  });

  test('the bar, the layout class, the camera and the reward overlay follow the temporary fold', () => {
    assert.match(game, /const shopOpen = showShop && !barCollapsed;/);
    assert.match(game, /drag && 'is-dragging', barCollapsed && 'is-collapsed',/);
    assert.match(game, /<\$\{ShopBar\}[^\n]*collapsed=\$\{barCollapsed\}[^\n]*onCollapse=\$\{setCollapsed\}/);
    assert.match(game, /<\$\{RewardOverlay\} priv=\$\{priv\} minimized=\$\{rewardMin \|\| barCollapsed\}/);
  });

  test('one camera effect: the deploy zoom and the hand-made fold share it', () => {
    assert.match(game, /const step = deployZoomStep\(deployZoomedRef\.current, deployFold\);/);
    assert.match(game, /const next = prepDeployCamera\(\{/);
    assert.match(game, /deployZoomedRef\.current = deployZoomRemember\(step, \{ next, pen \}\);/);
    assert.equal((game.match(/ms: FOLD_CAMERA_MS/g) || []).length, 1, 'one flight constant, one effect');
  });
});

// ---- the 0.3.0 port: what the merge added on top of the PR (kept) ----------------------------------------------------

describe('0.3.0 port of PR #646 (kept through the removal and the restore)', () => {
  const game = read('public/js/screens/game.js');
  const app = read('public/js/render/app.js');

  test('the camera the pen returns to is remembered without its flight time (a fold\'s 350 ms is not replayed)', () => {
    // togglePen(false) repeats camRef's opts: with `ms: FOLD_CAMERA_MS` kept there, the way back from the pen after a
    // 收起 flew 350 ms instead of the pen's own 0.25 s (render/app.js PEN_CAMERA_MS)
    assert.match(game, /const setCam = useCallback\(\(kind, opts\) => \{[\s\S]{0,400}?const \{ ms: _ms, instant: _instant, \.\.\.framing \} = opts \|\| \{\};\n\s+camRef\.current = \{ kind, opts: framing \};/);
    assert.match(game, /const c = camRef\.current;\n\s+view\.setCamera\(c\.kind, c\.opts\);/, 'the pen\'s way back repeats the remembered framing');
  });

  test('a drag under a still pointer follows a camera flight: the view judges it again every flying frame', () => {
    assert.match(app, /const flying = !!camTo;\n\s+stepCamera\(now\);\n[\s\S]{0,300}?if \(flying && mode === 'prep' && drag\.dragging\) drag\.refresh\(\);/);
  });
});
