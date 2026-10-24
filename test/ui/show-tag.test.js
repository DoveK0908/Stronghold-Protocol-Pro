// 设置「显示名字后面的编号」 (the owner's request of 2026-10-24): the four digits a session was given are printed after
// the 代号 (`名字#1234`; the official HUD does the same). The switch is a pure client preference — never sent — and every
// display reads it through usePlayerLabel, so flipping it in 设置 redraws the names where they stand.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const { DEFAULT_SETTINGS, sanitizeSettings } = await import('../../public/js/ui/gameLogic/settings.js');
const { playerLabel } = await import('../../public/js/ui/myInfo.js');

describe('设置「显示名字后面的编号」', () => {
  test('on by default, and only an explicit false turns it off', () => {
    assert.equal(DEFAULT_SETTINGS.showTag, true);
    assert.equal(sanitizeSettings(null).showTag, true);
    assert.equal(sanitizeSettings({}).showTag, true);
    assert.equal(sanitizeSettings({ showTag: 'yes' }).showTag, true, 'junk keeps the default on');
    assert.equal(sanitizeSettings({ showTag: false }).showTag, false);
    assert.equal(sanitizeSettings({ showTag: true }).showTag, true);
  });

  test('playerLabel prints 名字#四位, and the bare 代号 when the switch is off', () => {
    assert.equal(playerLabel('HostA', '1234'), 'HostA#1234');
    assert.equal(playerLabel('HostA', '1234', true), 'HostA#1234');
    assert.equal(playerLabel('HostA', '1234', false), 'HostA');
    assert.equal(playerLabel('HostA', null), 'HostA', 'no digits claimed yet');
    assert.equal(playerLabel('HostA', '12'), 'HostA', 'only four digits count');
  });

  test('every display goes through usePlayerLabel, so the switch redraws the names live', () => {
    const owner = read('public/js/ui/myInfo.js');
    assert.match(owner, /export function usePlayerLabel\(\)/);
    assert.match(owner, /useStore\(\(s\) => s\.showTag !== false, Object\.is, settingsStore\)/);
    for (const p of ['public/js/screens/room.js', 'public/js/ui/teamPanel.js', 'public/js/screens/bandDraft.js', 'public/js/ui/achievements.js']) {
      const src = read(p);
      assert.match(src, /import \{ usePlayerLabel \} from '.*myInfo\.js';/, `${p} imports the hook`);
      assert.match(src, /const label = usePlayerLabel\(\);/, `${p} subscribes to the switch`);
      assert.doesNotMatch(src, /\bplayerLabel\(/, `${p} never calls the raw helper`);
    }
  });

  test('the dialog offers the switch beside 部署时收起商店', () => {
    const dialog = read('public/js/ui/settings.js');
    assert.match(dialog, /label=\$\{t\('显示名字后面的编号'\)\} micro="PLAYER TAG" value=\$\{s\.showTag !== false\}/);
    assert.match(dialog, /关闭后只显示代号/);
  });

  test('English strings exist for the switch', () => {
    const en = JSON.parse(read('public/i18n/en.json'));
    assert.equal(typeof en['显示名字后面的编号'], 'string');
    assert.equal(typeof en['关闭后只显示代号，不再显示「代号#四位数字」。房间席位、同盟名单、决策顺序和名片的显示一起生效；只影响你自己的画面，不影响别人看到的名字。'], 'string');
  });
});
