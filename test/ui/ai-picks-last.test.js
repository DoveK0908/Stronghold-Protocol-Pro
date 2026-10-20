// The room screen's 「AI 队友最后选择」 switch (GitHub #338; server: room.setAiPicksLast, room.state.aiPicksLast): co-op
// rooms only, the host toggles it, everybody else sees its state read-only; the texts go through t() with English in
// public/i18n/en.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8');
const EN = JSON.parse(readFileSync(path.join(ROOT, 'public/i18n/en.json'), 'utf8'));
const mod = () => import(pathToFileURL(path.join(ROOT, 'public/js/screens/room.js')).href);

const room = (o = {}) => ({
  code: 'ABCD', hostId: 'h', mode: 'coop', difficulty: 'NORMAL', aiPicksLast: false,
  seats: [{ seat: 0, playerId: 'h', name: 'Host', isBot: false, ready: false, connected: true }, { seat: 1, playerId: 'g', name: 'G', isBot: false, ready: false, connected: true }, null, null],
  ...o,
});

test('aiLastOption: hidden in solo, editable by the host only, the state from room.state (off when absent)', async () => {
  const { aiLastOption } = await mod();
  assert.equal(aiLastOption(room({ mode: 'solo' }), 'h'), null, 'solo: no AI teammates');
  assert.deepEqual(aiLastOption(room(), 'h'), { on: false, editable: true });
  assert.deepEqual(aiLastOption(room({ aiPicksLast: true }), 'h'), { on: true, editable: true });
  assert.deepEqual(aiLastOption(room({ aiPicksLast: true }), 'g'), { on: true, editable: false });
  assert.deepEqual(aiLastOption(room({ aiPicksLast: undefined }), 'g'), { on: false, editable: false }, 'an older server');
  assert.equal(aiLastOption(null, 'h'), null);
});

test('room.js sends room.setAiPicksLast { on } and shows the switch through t(); en.json has the English', () => {
  assert.match(SRC, /net\.request\('room\.setAiPicksLast', \{ on \}\)/);
  for (const zh of ['AI 队友最后选择', '策略与机变轮选时，所有博士先于 AI 队友选择', '由创建者设置']) {
    assert.ok(SRC.includes(`t('${zh}')`), zh);
    assert.equal(typeof EN[zh], 'string', `en.json: ${zh}`);
    assert.ok(EN[zh].length > 0 && !/[一-鿿]/.test(EN[zh]), `English for ${zh}`);
  }
});

test('同盟设置 popover is gone: AI-last is a switch next to 实验性选项, the middle keeps only the difficulty pill', () => {
  // 维护者 2026-10-20：「同盟设置就可以去掉了，中间只留这个难度选择的按钮」，AI-last 与实验性选项并排在左下
  assert.doesNotMatch(SRC, /rs-pill__gear/, 'the gear is removed');
  assert.doesNotMatch(SRC, /同盟设置/, 'and so is its popover title');
  assert.match(SRC, /const aiLast = aiLastOption\(room, me\.playerId\);/);
  assert.match(SRC, /class=\$\{`rs-exp rs-exp--ai\$\{aiLast\.on \? ' is-on' : ''\}`\}/, 'the switch sits in the footer bar');
  assert.match(SRC, /<span class=\$\{`rs-exp__switch\$\{aiLast\.on \? ' is-on' : ''\}`\} aria-hidden="true" \/>/);
  assert.match(SRC, /onClick=\$\{\(\) => aiLast\.editable && setAiLast\(!aiLast\.on\)\}/);
  assert.match(SRC, /<div class="rs-foot__center">[\s\S]{0,400}class="rs-pill__diff"/, 'the pill keeps only the difficulty button');
  assert.doesNotMatch(SRC, /function RoomOptions/);
  assert.doesNotMatch(SRC, /function AiLastToggle/);
  const css = readFileSync(path.join(ROOT, 'public/css/screens/lobby.css'), 'utf8');
  assert.ok(css.includes('.rs-exp__switch.is-on'), 'the switch has a visual on state');
  assert.doesNotMatch(css, /\.rs-opts \{/, 'the popover styles are gone');
});
