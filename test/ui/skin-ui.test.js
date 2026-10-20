// 皮肤 UI (2026-10-20, the owner): the tile shows the skin's HALF-BODY portrait (1:2, the same picture the detail panel
// draws) at a size that fits it whole — the 立绘 is only the click-to-enlarge preview (界面#11). The name sits under the
// art instead of behind it, and 卡片视图 follows the pick at once instead of waiting for a reload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('a skin tile is the half-body portrait; the 立绘 is only the enlarged preview', () => {
  const picker = read('public/js/ui/skinPicker.js');
  assert.match(picker, /art: row\.portrait \|\| row\.avatar \|\| row\.illust \|\| null/);
  assert.match(picker, /const previewArt = previewRow \? \(previewRow\.illust \|\| previewRow\.portrait \|\| previewRow\.avatar\) : null;/);
});

test('the art box is the positioning parent, so the name is not painted over', () => {
  const css = read('public/css/screens/loadout.css');
  assert.match(css, /\.lo-skin__art \{ position: relative; display: flex;/);
  // 界面#11: a 1:2 box that fits the whole portrait, three to a row
  assert.match(css, /\.lo-skin__art \{[^}]*aspect-ratio: 1 \/ 2;/);
  assert.match(css, /\.lo-skins \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.lo-skin__art img \{ position: absolute; inset: 0;/);
});

test('卡片视图 paints the live skin selection instead of a loadout snapshot', () => {
  const loadout = read('public/js/screens/loadout.js');
  const start = loadout.indexOf('export function OpCard(');
  const next = loadout.indexOf('\nexport function ', start + 10);
  const block = loadout.slice(start, next > 0 ? next : loadout.length);
  assert.ok(block.includes('<${OperatorImage} m=${m} chess=${chess} portrait avatarFallback'), 'OperatorImage subscribes to the skins store');
  assert.doesNotMatch(block, /ownAppearance\(chess, \{ skins \}\)/, 'no stale loadout skins map for the card art');
});
