// Luck 外挂只在房间勾选「Luck 测试插件」时影响对局：没勾选时服务端把整进程的改动收回、倍速交回游戏自己、
// 录制不写。补丁本体在 mods/luck/patches/L7-gate.patch.json（应用在 source/luck 这份上游克隆上）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PATCH = path.join(ROOT, 'mods', 'luck', 'patches', 'L7-gate.patch.json');
const SOURCE = path.resolve(ROOT, '..', 'source', 'luck', 'src', 'server-patch.mjs');

test('the luck overlay carries the off-gate: no option, no effect', () => {
  const patch = JSON.parse(fs.readFileSync(PATCH, 'utf8'));
  const all = patch.hunks.map((h) => h.replace).join('\n');
  assert.match(all, /if \(!\(this\.experimental && this\.experimental\.luckConsole === true\)\) \{[\s\S]*?for \(const k of FEATURE_KEYS\)[\s\S]*?rollbackFeature\(this, state, k\)[\s\S]*?state\.speed = null;/, 'start() takes back every process-wide change and hands the speed back');
  assert.match(all, /if \(!\(match && match\.experimental && match\.experimental\.luckConsole === true\)\) return;/, 'the recorder stays silent for matches without the option');
  for (const h of patch.hunks) {
    assert.ok(!h.find.includes('luckConsole'), `hunk ${h.id} anchors on upstream text, not on our own edit`);
    assert.ok(h.replace.length > h.find.length);
  }
});

test('when the upstream clone is present, the gate is applied there too', (t) => {
  if (!fs.existsSync(SOURCE)) return t.skip('source/luck is a sibling clone (not in the repo); the patch is the source of truth');
  const src = fs.readFileSync(SOURCE, 'utf8');
  assert.match(src, /for \(const k of FEATURE_KEYS\) \{\n\s*try \{ rollbackFeature\(this, state, k\); \} catch/, 'the start gate is applied');
  assert.match(src, /state\.speed = null;\n\s*\}\n\s*\/\/ the lobby builds a fresh Match/, 'the speed goes back to the game');
  assert.match(src, /if \(!\(match && match\.experimental && match\.experimental\.luckConsole === true\)\) return;/, 'recordIntent is gated');
});

test('the panel itself is inert without the option (client gate)', (t) => {
  const overlay = path.resolve(ROOT, '..', 'source', 'luck', 'public', 'overlay.js');
  if (!fs.existsSync(overlay)) return t.skip('source/luck is not present');
  const src = fs.readFileSync(overlay, 'utf8');
  assert.match(src, /if \(pub && pub\.experimental\?\.luckConsole !== true\) return null;/, 'view() returns null, so the FAB and the panel never render');
});
