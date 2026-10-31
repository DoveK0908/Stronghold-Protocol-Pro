// 设置「拖动吸附」 (owner 2026-10-31): the official deploy drag snaps the dragged unit onto the tile under the pointer
// while that is a legal target (forced, the official mode of 2026-10-09); the free deploy drag of 2026-10-15 — the
// model follows the pointer smoothly and never sits on a tile — stays the default here, so an upgrade does not change
// the released feel. This file pins the stored value, the dialog's switch and the renderer's two branches.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const gameLogic = await import('../../public/js/ui/gameLogic.js');
const { DEFAULT_SETTINGS, sanitizeSettings, DRAG_SNAPS } = gameLogic;

describe('设置「拖动吸附」: 平滑吸附 by default, 强制吸附 opt-in', () => {
  test('the stored values are smooth and forced; smooth is the default (the released 2026-10-15 feel)', () => {
    assert.deepEqual([...DRAG_SNAPS], ['smooth', 'forced']);
    assert.equal(DEFAULT_SETTINGS.dragSnap, 'smooth');
    assert.equal(sanitizeSettings(null).dragSnap, 'smooth');
    assert.equal(sanitizeSettings({}).dragSnap, 'smooth');
    assert.equal(sanitizeSettings({ bgm: 0.5 }).dragSnap, 'smooth', 'a profile saved before the switch keeps smooth');
  });

  test('sanitizeSettings keeps an explicit value and falls back to smooth for junk', () => {
    assert.equal(sanitizeSettings({ dragSnap: 'smooth' }).dragSnap, 'smooth');
    assert.equal(sanitizeSettings({ dragSnap: 'forced' }).dragSnap, 'forced');
    assert.equal(sanitizeSettings({ dragSnap: 'snap' }).dragSnap, 'smooth');
    assert.equal(sanitizeSettings({ dragSnap: true }).dragSnap, 'smooth');
    assert.equal(sanitizeSettings({ dragSnap: null }).dragSnap, 'smooth');
  });

  test('the dialog offers a two-option switch under 部署时收起商店', () => {
    const dialog = read('public/js/ui/settings.js');
    assert.match(dialog, /const DRAG_SNAP = \[\['smooth', N_\('平滑吸附'\)\], \['forced', N_\('强制吸附'\)\]\]/);
    assert.match(dialog, /data-testid="drag-snap"[\s\S]{0,200}DRAG SNAP/);
    assert.match(dialog, /data-testid="drag-snap"[\s\S]{0,600}updateSettings\(\{ dragSnap: id \}\)/);
    assert.match(dialog, /data-testid="drag-snap-hint"/);
    // the hint says what each mode does (the owner's wording)
    assert.match(dialog, /平滑吸附：干员模型跟着指针 \/ 手指平滑移动/);
    assert.match(dialog, /强制吸附：与官方原版一致/);
  });

  test('the packs carry the new strings', () => {
    const keys = ['拖动吸附', '平滑吸附', '强制吸附', '平滑吸附：干员模型跟着指针 / 手指平滑移动，不吸附到格子上，松手后滑到落点。强制吸附：与官方原版一致，指针停在可以放置的格子上时，干员立刻站到那一格。'];
    for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
      const pack = read(`public/i18n/${lang}.json`);
      for (const k of keys) assert.ok(pack.includes(JSON.stringify(k)), `${lang}: ${k}`);
    }
  });
});

describe('the renderer: smooth follows the pointer, forced stands on the drop tile', () => {
  test('app.js keeps the drag target and reads the setting every move', () => {
    const app = read('public/js/render/app.js');
    assert.match(app, /dragSnap: 'smooth'/);
    assert.match(app, /settings\.dragSnap === 'forced' \? dragStandTile\(p\) : null/);
    // smooth: the camera ray follows the pointer; forced: the standing tile is written straight in
    assert.match(app, /if \(stand\) \{[\s\S]{0,200}v\._follow = null; v\._tween = null;[\s\S]{0,120}v\.x = w\.x;/);
    assert.match(app, /v\._follow = f;/);
    assert.match(app, /if \(s\.dragSnap === 'forced' \|\| s\.dragSnap === 'smooth'\) settings\.dragSnap = s\.dragSnap;/);
  });

  test('an item plate stays centred on the pointer in both modes (the official drag snaps operators only)', () => {
    const app = read('public/js/render/app.js');
    assert.match(app, /const stand = item \? null : settings\.dragSnap === 'forced'/);
  });

  test('the simplified 2D board snaps its own ghost in forced mode (平滑吸附 keeps it on the pointer)', () => {
    const fb = read('public/js/ui/fallbackField.js');
    assert.match(fb, /const t = st\.settings\.dragSnap === 'forced' \? st\.hoverTarget : null;/);
    assert.match(fb, /tilePos\(L, t\.row, t\.col\) : handPos\(L, t\.idx\)/);
    assert.match(fb, /const left = pos \? L\.left \+ pos\.x : d\.x - hr\.left - L\.tile \/ 2;/);
  });
});
