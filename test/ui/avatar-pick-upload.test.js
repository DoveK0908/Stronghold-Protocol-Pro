// 头像 = 一格 (the owner's request of 2026-10-24: 「头像应该可选是自己上传的头像还是预制的干员的精一精二或皮肤头像」):
// the one avatar slot takes three kinds of picture — none (默认), an operator's official avatar (with its 精一 / 精二 /
// skin variants in the 外观 row), or the doctor's own uploaded image. The upload can only be chosen from the picker, so
// every dialog that opens ui/opPicker.js's AvatarPicker has to hand it the `uploaded` tile — otherwise the uploaded
// picture is unreachable there, and picking an operator (which clears avatarImg) silently loses it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/** the three places an avatar is picked: the room seat card, the lobby's 我的信息 dialog, the achievements card editor */
const PICKERS = [
  'public/js/screens/room.js',
  'public/js/ui/myInfo.js',
  'public/js/ui/achievements.js',
];

describe('头像 picker offers the uploaded picture everywhere', () => {
  test('the picker has a 上传的图片 tile fed by avatarImgSaved', () => {
    const src = read('public/js/ui/opPicker.js');
    assert.match(src, /export function AvatarPicker\(\{ current, list, m, onPick, onClose, looks = null, uploaded = null \}\)/);
    assert.match(src, /picked=\$\{uploaded \?/, 'AvatarPicker forwards it as the picked tile');
    assert.match(src, /t\('上传的图片'\)/, 'tile label');
    assert.match(src, /t\('换成上次上传的那张图'\)/, 'its tooltip');
  });

  for (const p of PICKERS) {
    test(`${p} hands the picker the uploaded tile`, () => {
      const src = read(p);
      assert.match(src, /<\$\{AvatarPicker\} /, 'opens the picker');
      assert.match(src, /uploaded=\$\{\w+\.avatarImgSaved \?/, 'the tile exists once something was uploaded');
      assert.match(src, /src: `\/avatar\/\$\{\w+\.avatarImgSaved\}`/, 'and shows that upload');
      assert.match(src, /on: !!\w+\.avatarImg/, 'marked chosen only while it is the live picture');
      assert.match(src, /setCustomAvatar\(\w+\.avatarImgSaved\)/, 'picking it switches the avatar back to the upload');
    });
  }

  test('an operator pick clears the upload, so the two never show at once', () => {
    const src = read('public/js/ui/playerCard.js');
    const fn = src.slice(src.indexOf('export function setCardAvatar'), src.indexOf('export function setCustomAvatar'));
    assert.match(fn, /if \(cardStore\.get\(\)\.avatarImg\) setCustomAvatar\(''\)/);
  });
});
