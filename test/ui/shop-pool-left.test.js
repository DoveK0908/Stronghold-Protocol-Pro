// U08 界面#08 卡池剩余: the shop card prints the copies left in the pool bottom-right. The server field is pinned by
// test/match/shop-pool-left.test.js; this file pins the client side (markup, style, translations).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';


const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const shopBar = read('public/js/ui/shopBar.js');
const css = read('public/css/screens/game-shop.css');
const en = JSON.parse(read('public/i18n/en.json'));

test('the chess card renders the count only when the server sent one', () => {
  assert.match(shopBar, /Number\.isFinite\(slot\.left\)/, 'the badge is conditional on the slot field');
  assert.match(shopBar, /class="scard__left" data-left=\$\{slot\.left\}/, 'the badge exposes the raw count for tests');
  assert.match(shopBar, /t\('剩余 \{n\} 张', \{ n: slot\.left \}\)/, 'the visible label');
  assert.match(shopBar, /t\('卡池中还剩 \{n\} 张', \{ n: slot\.left \}\)/, 'the hover title');
});

test('the badge sits bottom-right without taking the class row’s space', () => {
  const rule = css.match(/\.scard__left \{([\s\S]*?)\}/);
  assert.ok(rule, '.scard__left rule exists');
  const body = rule[1];
  assert.match(body, /position: absolute/);
  assert.match(body, /right:/);
  assert.match(body, /bottom:/);
  assert.match(body, /white-space: nowrap/);
});

test('both strings are translated (zh msgid → en)', () => {
  assert.equal(en['剩余 {n} 张'], '{n} left in pool');
  assert.equal(en['卡池中还剩 {n} 张'], '{n} more copies in the pool');
});

test('the server sends the count for chess slots only', () => {
  const views = read('server/match/player/views.js');
  assert.match(views, /s\.kind === 'chess' \? \{ left: this\.poolOf\(s\.id\)\.left\(s\.id\) \}/);
});
