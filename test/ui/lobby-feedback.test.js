import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEEDBACK_GROUP, LobbyFeedback } from '../../public/js/ui/lobbyFeedback.js';
import { FEEDBACK_BOARD, STATUS_BOARD } from '../../public/js/ui/siteBoards.js';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the lobby chip opens the in-game board and copies no group number (the board replaced it, 2026-10-26)', () => {
  const feedback = source('../../public/js/ui/lobbyFeedback.js');
  assert.equal(FEEDBACK_GROUP, '243859707', 'the upstream group number stays documented, unused');
  // a chip without anything to open renders nothing, so no dead control on a screen that mounts it without a handler
  assert.equal(LobbyFeedback({}), null);
  assert.match(feedback, /export function LobbyFeedback\(\{ onOpen \}\)/);
  // the board is ours: no external page, no group number, no network call from the chip itself
  assert.doesNotMatch(feedback, /href=|window\.open|copyFeedbackGroup|net\.request|localStorage/);
});

test('the lobby mounts the chip and the board dialog, both inside the screen', () => {
  const lobby = source('../../public/js/screens/lobby.js');
  assert.match(lobby, /<\$\{LobbyFeedback\} onOpen=\$\{\(\) => setFeedbackOpen\(true\)\} \/>/);
  assert.match(lobby, /const \[feedbackOpen, setFeedbackOpen\] = useState\(false\)/);
  assert.match(lobby, /feedbackOpen \? html`<\$\{FeedbackBoard\} onClose=\$\{\(\) => setFeedbackOpen\(false\)\} \/>` : null/);
  assert.match(lobby, /import \{ FeedbackBoard \} from '\.\.\/ui\/feedbackBoard\.js'/);
});

test('the board talks to one same-origin route and never to another host', () => {
  const board = source('../../public/js/ui/feedbackBoard.js');
  assert.match(board, /import \{ FEEDBACK_PATH, FEEDBACK_STATUSES, FEEDBACK_STATUS_LABEL \} from '\.\.\/\.\.\/\.\.\/shared\/feedback\.js'/);
  assert.match(board, /fetch\(FEEDBACK_PATH/);
  assert.doesNotMatch(board, /https?:\/\//, 'no absolute URL: the board is served by this server only');
  assert.match(board, /method: 'POST'/);
  // an anonymous board says so up front
  assert.match(board, /发帖不记录任何身份/);
});

test('only the browser that wrote a post sees its edit and withdraw buttons', () => {
  const board = source('../../public/js/ui/feedbackBoard.js');
  // one gate, and it is the browser's own secret — not the maintainer session, not "any open card"
  assert.match(board, /const mine = \(p\) => !!secrets\[p\.id\]/);
  assert.doesNotMatch(board, /const may =/, 'no second gate: a maintainer session must not reveal author controls');
  assert.match(board, /\$\{mine\(p\) \? html`<div class="fb-manage">/);
  assert.match(board, /await call\(\{ action: 'edit', id: editing\.id, title, body, secret: secrets\[editing\.id\] \}\)/);
  assert.match(board, /await call\(\{ action: 'withdraw', id, secret \}\)/);
  assert.doesNotMatch(board, /action: 'withdraw'[^)]*token/, 'the session token is never offered as authorship');
});

test('the chip keeps the lobby-contact styling', () => {
  const css = source('../../public/css/screens/lobby.css');
  assert.match(css, /\.lobby-feedback \{[^}]*min-height: 40px/);
  assert.match(css, /\.fb-columns \{ display: grid; grid-template-columns: repeat\(4/);
});

test('this deployment hides the external feedback board and the status page (the maintainer, 2026-10-17); the entry points stay in the module', () => {
  assert.equal(FEEDBACK_BOARD, '/feedback/');
  assert.equal(STATUS_BOARD, '/monitor/');
  const boards = source('../../public/js/ui/siteBoards.js');
  assert.match(boards, /export function SiteBoards\(\) \{\n\s*return null;\n\}/);
  assert.doesNotMatch(boards, /<a class="btn/);
});
