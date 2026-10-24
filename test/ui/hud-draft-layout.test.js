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

test('the in-match top bar centre is the official undivided band (one bracket, white round plate, official capsule)', () => {
  const src = read('public/js/ui/hud.js');
  const center = src.slice(src.indexOf('<div class="gtop__center brackets">'), src.indexOf('<div class="gtop__right">'));
  assert.ok(center.length > 0, 'the centre is one .gtop__center.brackets band');
  assert.doesNotMatch(center, /class="gtop__frame"/, 'no per-button bracket frames');
  assert.doesNotMatch(center, /class="gtop__plate/, 'no per-item plates');
  assert.ok(center.indexOf('重(roundbox') < center.indexOf('gtop__cap'), 'round before the capsule');
  assert.ok(center.indexOf('gtop__cap') < center.indexOf('<${LpTower}'), 'LP after the capsule');

  const css = read('public/css/screens/game.css');
  const band = css.match(/\.gtop__center\.brackets \{[^}]*\}/)?.[0] ?? '';
  assert.match(band, /height: \.78rem/, 'the band is as tall as the official one');
  assert.match(band, /gap: \.18rem/, 'official spacing');
  assert.match(band, /padding: 0 \.24rem 0 \.14rem/, 'official padding');
  assert.doesNotMatch(css, /\.gtop__center\.brackets \.capsule \{ min-width: 1\.9rem/, 'the capsule keeps the official 2.2rem pill');
});

test('the status strip is back to 已连接 / 延迟 / 服务 with separators (not the one-line pill)', () => {
  const css = read('public/css/screens/game.css');
  const net = css.match(/\.gtop__net \{[^}]*\}/)?.[0] ?? '';
  assert.match(net, /align-items: stretch/, 'three equal cells');
  assert.match(net, /border: 1px solid var\(--line\)/);
  assert.doesNotMatch(net, /border-radius: 99px/, 'the rounded pill experiment is reverted');
  assert.match(css, /\.gtop__net > \* \+ \* \{ border-left: 1px solid var\(--line\); \}/, 'cells are separated by a line');
});

test('the 选择策略 order row draws the same 头像 as everywhere else and carries no corner badge', () => {
  const band = read('public/js/screens/bandDraft.js');
  const css = read('public/css/screens/draft.css');
  // one component for every row: PlayerAvatar resolves 自传头像 + 精一/精二/皮肤 + the fallback glyph itself
  assert.match(band, /<span class="dorder__face"><\$\{PlayerAvatar\} player=\$\{p\} self=\$\{self\} \/><\/span>/);
  assert.doesNotMatch(band, /dorder__img/, 'no raw <Img> face left in the row');
  assert.doesNotMatch(band, /const faceOf = /, 'the row no longer pre-computes a face');
  // the 「我」 corner badge is gone (owner playtest 2026-10-24)
  assert.doesNotMatch(band, /dorder__me/);
  assert.doesNotMatch(css, /\.dorder__me/);
});
