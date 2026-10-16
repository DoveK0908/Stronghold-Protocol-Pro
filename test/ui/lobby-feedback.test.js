import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEEDBACK_GROUP, copyFeedbackGroup } from '../../public/js/ui/lobbyFeedback.js';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('lobby feedback copies only the existing public group number', async () => {
  const copied = [], messages = [];
  assert.equal(FEEDBACK_GROUP, '243859707');
  assert.equal(await copyFeedbackGroup(async text => { copied.push(text); return true; }, (...args) => messages.push(args)), true);
  assert.deepEqual(copied, ['243859707']);
  assert.deepEqual(messages, [['已复制反馈群号 243859707', 'success']]);
});

for (const mode of ['unavailable', 'denied']) test(`lobby feedback ${mode} does not claim successful copying`, async () => {
  const messages = [];
  const copy = async text => { assert.equal(text, '243859707'); if (mode === 'denied') throw new Error('denied'); return false; };
  assert.equal(await copyFeedbackGroup(copy, (...args) => messages.push(args)), false);
  assert.deepEqual(messages, [['复制失败，请手动复制', 'warn']]);
});

test('this deployment hides the lobby feedback chip (the maintainer, 2026-10-16); the copy path stays intact', () => {
  const lobby = source('../../public/js/screens/lobby.js'), feedback = source('../../public/js/ui/lobbyFeedback.js');
  // 仍然挂在 hub-contact 里，只是组件本身不画东西 —— 要恢复，把 LobbyFeedback 的 return null 换回那个按钮即可
  assert.match(lobby, /<div class="hub-contact"><\$\{LobbyFeedback\} \/>/);
  assert.match(feedback, /export function LobbyFeedback\(\) \{\n  return null;\n\}/);
  assert.doesNotMatch(feedback, /href=|window\.open|2225664821|net\.request|localStorage/);
  assert.match(feedback, /copied \? 'success' : 'warn'/);
  const css = source('../../public/css/screens/lobby.css');
  assert.match(css, /\.lobby-feedback \{[^}]*min-height: 40px/);
});
