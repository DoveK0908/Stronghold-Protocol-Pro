// 名片底图 (2026-10-20, the owner): only 模拟场景 + 阵营徽记 survive; the operator-skin cards and the 不使用底图
// option are gone, and nobody with an empty pick sees a bare plate — the default is the 模拟·终极 loading card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('the picker offers exactly 模拟场景 + 阵营徽记', () => {
  const src = read('public/js/ui/namecards.js');
  assert.match(src, /export const DEFAULT_NAMECARD = 'loading:abyss';/);
  assert.equal((src.match(/const LOADING = \[/g) || []).length, 1);
  assert.equal((src.match(/const CAMPS = \[/g) || []).length, 1);
  // the two groups the dialog renders
  assert.match(src, /<h4 class="nc-pick__theme">\$\{t\('模拟场景'\)\}<\/h4>/);
  assert.match(src, /<h4 class="nc-pick__theme">\$\{t\('阵营徽记'\)\}<\/h4>/);
  // and nothing else
  assert.doesNotMatch(src, /不使用底图/, 'the no-card option is gone');
  assert.doesNotMatch(src, /干员皮肤立绘/, 'the operator-skin group is gone');
  assert.doesNotMatch(src, /nc-pick__search/, 'the skin search box is gone');
  assert.doesNotMatch(src, /skinCardView|const shown/, 'the skin tiles are gone');
});

test('an old skin id resolves to nothing, so it falls back to the default card', () => {
  const src = read('public/js/ui/namecards.js');
  assert.match(src, /export function namecardOf\(id\) \{\n  if \(typeof id !== 'string'\) return null;\n  return BY_ID\.get\(id\) \|\| null;/);
  assert.doesNotMatch(src, /kind: 'skin'/);
});

test('every plate uses 模拟·终极 unless a valid pick exists', () => {
  const card = read('public/js/ui/playerCard.js');
  assert.match(card, /bg: namecardOf\(loadPref\(NAMECARD_PREF, ''\)\) \? loadPref\(NAMECARD_PREF, ''\) : DEFAULT_NAMECARD,/);
  assert.match(card, /export function setCardBackground\(bg\) \{ const id = namecardOf\(bg\) \? bg : DEFAULT_NAMECARD;/);
  assert.match(card, /bg: namecardOf\(card\?\.bg\) \? card\.bg : DEFAULT_NAMECARD/);
  assert.match(card, /bg: namecardOf\(card\?\.bg\) \? card\.bg : DEFAULT_NAMECARD, trophies,/);
});

test('the picker CSS no longer carries the skin search / no-card rules', () => {
  const css = read('public/css/screens/lobby.css');
  for (const dead of ['nc-pick__search', 'nc-pick__card--none', 'nc-pick__art--skin', 'nc-pick__theme--skins', 'nc-layer--skin']) {
    assert.ok(!css.includes(dead), `${dead} rule removed`);
  }
});
