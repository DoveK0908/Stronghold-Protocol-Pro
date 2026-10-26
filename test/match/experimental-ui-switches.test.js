// 查看下回合资金 (experimental goldPreview) and the two presentation switches the owner moved into 实验性选项 on
// 2026-10-26 (牌库剩余张数 shopLeft, 二倍速 speedVote). Both of those ship ON, so a room that never mentions them keeps
// today's UI; goldPreview ships OFF and adds m.private.nextGold only when the room asked for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import {
  EXPERIMENTAL_OPTIONAL, EXPERIMENTAL_OPTIONAL_DEFAULTS, optionalValue, experimentalOptions, experimentalKey,
  sameExperimental, isExperimental,
} from '../../shared/experimental.js';

const base = extra => ({ revivalEnabled: false, disableSharedPool: false, ...extra });

test('the three switches: 剩余张数 and 二倍速 default on, 下回合资金 defaults off', () => {
  for (const key of ['shopLeft', 'speedVote', 'goldPreview']) assert.ok(EXPERIMENTAL_OPTIONAL.includes(key), key);
  assert.equal(EXPERIMENTAL_OPTIONAL_DEFAULTS.shopLeft, true);
  assert.equal(EXPERIMENTAL_OPTIONAL_DEFAULTS.speedVote, true);
  assert.equal(EXPERIMENTAL_OPTIONAL_DEFAULTS.goldPreview, false);
  // optionalValue reads the rule's own default when the room never mentions the switch
  assert.equal(optionalValue({}, 'shopLeft'), true);
  assert.equal(optionalValue({}, 'goldPreview'), false);
  assert.equal(optionalValue({ shopLeft: false }, 'shopLeft'), false);
});

test('the wire: a room at the defaults keeps its two-flag shape, an off switch rides as false', () => {
  assert.deepEqual(experimentalOptions(base()), base(), 'no switch rides at its default');
  assert.deepEqual(experimentalOptions(base({ shopLeft: false })), base({ shopLeft: false }));
  assert.deepEqual(experimentalOptions(base({ goldPreview: true })), base({ goldPreview: true }));
  // turning a true-default switch back on is the same as saying nothing
  assert.deepEqual(experimentalOptions(base({ shopLeft: true })), base());
  // the room key and the equality check see the switch (a forgotten one is silently dropped by room.setExperimental)
  assert.notEqual(experimentalKey(base()), experimentalKey(base({ shopLeft: false })));
  assert.match(experimentalKey(base({ shopLeft: false })), /:noshop\b/);
  assert.match(experimentalKey(base({ speedVote: false })), /:nospeed\b/);
  assert.match(experimentalKey(base({ goldPreview: true })), /:gold\b/);
  assert.equal(sameExperimental(base(), base()), true);
  assert.equal(sameExperimental(base(), base({ shopLeft: false })), false);
  assert.equal(sameExperimental(base(), base({ goldPreview: true })), false);
  assert.equal(isExperimental(base({ speedVote: 'yes' })), false, 'the switches are booleans only');
});

test('m.private.nextGold: only when the room asked, and it predicts the next round start', (t) => {
  const on = makeMatch({ humans: 2, experimental: base({ goldPreview: true }), seed: 91, fake: true }).start();
  t.after(() => on.m.dispose());
  const ps = [...on.m.players.values()][0];
  const priv = ps.privateView();
  assert.ok(priv.nextGold, 'the field rides the private view');
  assert.equal(priv.nextGold.round, on.m.round + 1);
  assert.equal(priv.nextGold.income, on.m.gd.income(on.m.round + 1));
  assert.equal(priv.nextGold.pending, ps.pendingFunds);

  const off = makeMatch({ humans: 2, experimental: base(), seed: 91, fake: true }).start();
  t.after(() => off.m.dispose());
  const quiet = [...off.m.players.values()][0].privateView();
  assert.equal(quiet.nextGold, undefined, 'an ordinary room keeps its private view unchanged');
});
