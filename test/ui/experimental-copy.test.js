// 实验性选项 copy (owner 2026-10-28): one short name + one explanation per switch, living in a single table so the room
// dialog (ui/experimental.js) and 设置 → 开房默认 (ui/roomDefaultsSection.js) always describe a rule the same way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { experimentalCopy } from '../../public/js/ui/experimental.js';
import { roomDefaultCopy } from '../../public/js/ui/roomDefaultsSection.js';
import { ROOM_DEFAULT_KEYS } from '../../public/js/ui/roomDefaults.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/** Every switch the dialog can show (the two base rules, the optional ones, the numeric one and the stage list). */
const KEYS = [
  'revivalEnabled', 'disableSharedPool', 'playerCapacity', 'disableDuckLord', 'luckConsole', 'bossHitSoftCap',
  'bossQuota', 'bossHpPercent', 'prepUnlimited', 'benchExpand', 'goldPreview', 'shopLeft', 'speedVote', 'bannedStages',
];

test('every option has a short name and a one-line explanation', () => {
  for (const key of KEYS) {
    const copy = experimentalCopy(key);
    assert.ok(Array.isArray(copy) && copy.length === 2, `${key} has copy`);
    const [name, note] = copy;
    assert.ok(name.length > 0 && name.length <= 12, `${key} name: ${name}`);
    assert.ok(note.length > 0, `${key} note`);
    assert.ok(note.length <= 100, `${key} note is ${note.length} chars: ${note}`);
    // The switch itself already shows on/off, so the copy never restates the default or the toggle mechanics.
    assert.ok(!note.includes('默认关闭') && !note.includes('勾选后'), `${key} states the rule, not the switch: ${note}`);
  }
  assert.equal(experimentalCopy('notAKey'), null);
});

test('设置 → 开房默认 shows exactly the dialog copy', () => {
  for (const key of ROOM_DEFAULT_KEYS) assert.deepEqual(roomDefaultCopy(key), experimentalCopy(key), key);
});

test('the surfaces render the table instead of their own literals', () => {
  const ui = read('public/js/ui/experimental.js');
  assert.match(ui, /const ruleLabel = \(key, helpId = null\) => \{/);
  for (const key of ['revivalEnabled', 'disableSharedPool', 'playerCapacity', 'disableDuckLord', 'luckConsole',
    'bossHitSoftCap', 'prepUnlimited', 'benchExpand', 'goldPreview', 'shopLeft', 'speedVote']) {
    assert.match(ui, new RegExp(`ruleLabel\\('${key}'\\)`), key);
  }
  assert.match(ui, /ruleLabel\('bossQuota', 'experimental-boss-quota-help'\)/);
  assert.match(ui, /experimentalCopy\('bannedStages'\)\[0\]/);
  assert.match(read('public/js/ui/roomDefaultsSection.js'), /export function roomDefaultCopy\(key\) \{\n  return experimentalCopy\(key\);/);
});

test('every name and explanation is translated into English', () => {
  const en = JSON.parse(read('public/i18n/en.json'));
  for (const key of KEYS) {
    for (const zh of experimentalCopy(key)) {
      const value = en[zh];
      assert.equal(typeof value, 'string', zh);
      assert.ok(value.length > 0 && !/[\u3400-\u9fff]/.test(value), `${zh} → ${value}`);
    }
  }
});
