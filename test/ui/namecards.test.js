// 名片底图 (2026-10-20, the owner): only 模拟场景 + 阵营徽记 survive; the operator-skin cards and the 不使用底图
// option are gone, and nobody with an empty pick sees a bare plate — the default is the 模拟·终极 loading card.
// A third kind was added on 2026-10-22 (自传名片底图): `custom:<16 lowercase hex>` is the browser's own upload, served
// back at /namecard/<id> — see public/js/ui/customNamecard.js and server/namecards.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NAMECARDS, DEFAULT_NAMECARD, namecardOf, namecardSrc } from '../../public/js/ui/namecards.js';

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
  assert.doesNotMatch(src, /kind: 'skin'/);
  // the shipped cards resolve by id, and the default pick is one of them
  for (const card of NAMECARDS) assert.equal(namecardOf(card.id), card, card.id);
  assert.equal(namecardOf(DEFAULT_NAMECARD).id, DEFAULT_NAMECARD, 'the default is a 模拟场景 card');
  // an old operator-skin id, an empty pick, an unknown key of a known group, and a non-string: no card (the caller
  // then falls back to DEFAULT_NAMECARD), never a made-up one
  for (const id of ['skin:char_498_inside@kitchen#2', '', 'loading:nope', 'camp:', 'custom:', 'CAMP:yan', null, undefined, 7, {}, ['camp:yan']]) {
    assert.equal(namecardOf(id), null, JSON.stringify(id) ?? String(id));
  }
});

test('a 自传 upload is a `custom:<16 hex>` id served at /namecard/<id>, and nothing looser', () => {
  const hex = '0123456789abcdef';
  assert.deepEqual(namecardOf(`custom:${hex}`),
    { id: `custom:${hex}`, kind: 'custom', name: null, image: `/namecard/${hex}` }, 'the server path, not an asset key');
  // the shape server/namecards.js mints and server/lobby.js validates: 16 lower-case hex, nothing else (an id that only
  // LOOKS like one is a 404 card, and the picker must not advertise it)
  for (const bad of [`custom:${'a'.repeat(15)}`, `custom:${'a'.repeat(17)}`, `custom:${'A'.repeat(16)}`,
    'custom:0123456789abcdeg', `custom:${hex}0`, `custom:/${hex}`, ` custom:${hex}`, `${hex}`]) {
    assert.equal(namecardOf(bad), null, bad);
  }
  // the picture the layer draws: the custom path as written, and null for anything a url could not hold
  assert.equal(namecardSrc(namecardOf(`custom:${hex}`)), `/namecard/${hex}`);
  assert.equal(namecardSrc({ kind: 'custom', image: '"/><script>' }), null, 'safeUrl refuses an injected url');
  assert.equal(namecardSrc({ kind: 'custom', image: null }), null);
  assert.equal(namecardSrc({ kind: 'loading', assetKey: 'loading/loading_ac_abyss' }, null), null, 'no asset index: no picture');
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
