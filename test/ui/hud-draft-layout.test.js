// Layout regressions that are cheap to catch statically (maintainer playtests 2026-10-20):
// 1. the strategy draft's order row keeps the same four-column geometry in solo as in co-op — the index column used to be
//    hidden in solo, which pushed the finger / band icon out of the last column;
// 2. the in-match top bar frames 本局信息 and 查看即将迎击的敌方单位 separately, with 回合 / 血量 in their own plates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('the draft order row always draws its index, so the last column holds the finger / band icon in solo too', () => {
  const src = read('public/js/screens/bandDraft.js');
  assert.match(src, /<span class="dorder__idx num">\$\{i \+ 1\}<\/span>/, 'the index is unconditional');
  assert.doesNotMatch(src, /!solo \? html`<span class="dorder__idx/, 'no solo-only guard on the index');
  const css = read('public/css/screens/draft.css');
  const rule = css.match(/\.dorder \{[^}]*\}/)?.[0] ?? '';
  assert.match(rule, /grid-template-columns: auto auto minmax\(0, 1fr\) auto/, 'four columns: index, face, text, box');
});

test('the in-match top bar brackets 本局信息 and 敌方情报 separately and gives 回合 / 血量 their own plates', () => {
  const src = read('public/js/ui/hud.js');
  const center = src.slice(src.indexOf('<div class="gtop__center">'), src.indexOf('<div class="gtop__right">'));
  assert.equal((center.match(/class="gtop__frame"/g) || []).length, 2, 'one bracket frame per check button');
  assert.equal((center.match(/class="gtop__plate(?: gtop__plate--lp)?"/g) || []).length, 2, 'round + LP plates');
  assert.doesNotMatch(center, /gtop__center brackets/, 'the undivided band is gone');
  assert.ok(center.indexOf('gtop__plate') < center.indexOf('gtop__cap'), 'round plate before the capsule');
  assert.ok(center.indexOf('gtop__plate gtop__plate--lp') > center.indexOf('gtop__cap'), 'LP plate after the capsule');

  const css = read('public/css/screens/game.css');
  assert.match(css, /\.gtop__center \{ gap: \.1rem; \}/);
  const plate = css.match(/\.gtop__plate \{[^}]*\}/)?.[0] ?? '';
  assert.match(plate, /height: \.64rem/, 'plates are as tall as the bracket frames');
  assert.match(plate, /border: 1px solid rgba\(200, 206, 208, \.28\)/, 'each plate has its own outline');
});

test('the status strip is back to 已连接 / 延迟 / 服务 with separators (not the one-line pill)', () => {
  const css = read('public/css/screens/game.css');
  const net = css.match(/\.gtop__net \{[^}]*\}/)?.[0] ?? '';
  assert.match(net, /align-items: stretch/, 'three equal cells');
  assert.match(net, /border: 1px solid var\(--line\)/);
  assert.doesNotMatch(net, /border-radius: 99px/, 'the rounded pill experiment is reverted');
  assert.match(css, /\.gtop__net > \* \+ \* \{ border-left: 1px solid var\(--line\); \}/, 'cells are separated by a line');
});
