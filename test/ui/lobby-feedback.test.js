import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEEDBACK_GROUP, copyFeedbackGroup } from '../../public/js/ui/lobbyFeedback.js';
import { FEEDBACK_BOARD, STATUS_BOARD } from '../../public/js/ui/siteBoards.js';

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

test('this deployment hides the feedback group (243859707 is the upstream site\'s) and keeps the copy path', () => {
  const lobby = source('../../public/js/screens/lobby.js'), feedback = source('../../public/js/ui/lobbyFeedback.js');
  assert.match(lobby, /<div class="hub-contact"><div class="hub-contact__row"><\$\{LobbyFeedback\} \/><\$\{SiteBoards\} \/><\/div>/);
  assert.match(feedback, /export function LobbyFeedback\(\) \{\n\s*return null;\n\}/);
  assert.match(feedback, /FEEDBACK_GROUP = '243859707'/);
  assert.match(feedback, /copied \? 'success' : 'warn'/);
  assert.doesNotMatch(feedback, /href=|window\.open|2225664821|net\.request|localStorage/);
  const css = source('../../public/css/screens/lobby.css');
  assert.match(css, /\.lobby-feedback \{[^}]*min-height: 40px/);
});

test('this deployment hides the feedback board and the status page (the maintainer, 2026-10-17); the entry points stay in the module', () => {
  assert.equal(FEEDBACK_BOARD, '/feedback/');
  assert.equal(STATUS_BOARD, '/monitor/');
  const boards = source('../../public/js/ui/siteBoards.js');
  assert.match(boards, /export function SiteBoards\(\) \{\n\s*return null;\n\}/);
  assert.doesNotMatch(boards, /<a class="btn/);
  assert.match(source('../../public/css/screens/lobby.css'), /\.hub-board \{[^}]*min-height: 40px/);
});
