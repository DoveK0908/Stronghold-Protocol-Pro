// 界面#10: the 名片 button, 我的信息, 名字#四位 claims and the displays that no longer say `DOCTOR #NNNN`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('the lobby 名片 button: avatar + 名字#四位, opens 我的信息', () => {
  const info = read('public/js/ui/myInfo.js');
  assert.match(info, /export function MeCard\(/);
  assert.match(info, /data-testid="me-card"/);
  // the card prints 名字#四位 on ONE line (the same playerLabel every other display uses)
  assert.match(info, /data-testid="me-card-tag">\$\{playerLabel\(me\?\.name, me\?\.tag\)\}/);
  assert.ok(info.includes('<${NameCardLayer} card=${card.bg} />'), 'the name card is the button background');
  const lobby = read('public/js/screens/lobby.js');
  assert.match(lobby, /<\$\{MeCard\} me=\$\{me\} onOpen=\$\{\$?\{?\(\) => setInfoOpen\(true\)/);
  assert.match(lobby, /infoOpen \? html`<\$\{MyInfoDialog\} me=\$\{me\}/);
  assert.doesNotMatch(lobby, /me-chip/, 'the old 统计数据 chip is gone');
});

test('我的信息: 修改头像 / 修改名片 / 统计数据 and the 代号 + 四位 editor', () => {
  const info = read('public/js/ui/myInfo.js');
  for (const label of ['修改头像', '修改名片', '统计数据']) assert.match(info, new RegExp(`t\\('${label}'\\)`));
  assert.match(info, /data-testid="me-info-name-input"/);
  assert.match(info, /data-testid="me-info-tag-input"/);
  assert.match(info, /const tagOk = \/\^\\d\{4\}\$\/\.test\(draftTag\)/);
  // one hello carries both, so the digits are never claimed under the old name first
  assert.match(info, /net\.setIdentity\(name, draftTag\)/);
  assert.doesNotMatch(info, /net\.setTag\(draftTag\);\s*\n\s*net\.setName\(name\)/);
  // the club rule and its refusal
  assert.match(info, /net\.on\('welcome'/);
  assert.match(info, /net\.on\('helloError'/);
  assert.match(info, /这个「代号#四位数字」已经被占用，换一组再试。/);
  // the card's buttons open the shared pickers
  assert.match(info, /<\$\{NameCardPicker\} current=\$\{card\.bg\}/);
  assert.match(info, /<\$\{AvatarPicker\} current=\$\{card\.avatar\}/);
});

test('net: hello carries tag + uid, welcome keeps the tag, NAME_TAKEN waits for a new pair', () => {
  const net = read('public/js/net.js');
  assert.match(net, /const K_TAG = 'sp\.tag'/);
  assert.match(net, /const K_UID = 'sp\.uid'/);
  assert.match(net, /if \(tag\) msg\.tag = tag;/);
  assert.match(net, /msg\.uid = identity\.uid\(\)/);
  assert.match(net, /if \(typeof msg\.tag === 'string' && \/\^\\d\{4\}\$\/\.test\(msg\.tag\)\) \{ this\.tag = msg\.tag; this\.wantTag = msg\.tag; identity\.saveTag\(msg\.tag\); \}/);
  assert.match(net, /if \(msg\.code === 'NAME_TAKEN'\) this\.name = null;/);
  assert.match(net, /setIdentity\(name, tag\) \{/);
  assert.match(net, /loadTag: \(\) => \(sget\(local, K_TAG\) \|\| ''\)\.slice\(0, 4\)/);
});

test('the server claims 名字#四位 only for a client that names a uid', () => {
  const src = read('server/net.js');
  assert.match(src, /const tag = isTag\(msg\.tag\) \? msg\.tag : \(uid \? previous\?\.tag \|\| this\.tags\.pick\(name\) \|\| '0000' : null\);/);
  assert.match(src, /if \(uid && tag\) \{/);
  assert.match(src, /errorMsg\(ERR\.NAME_TAKEN, rid, `\$\{name\}#\$\{tag\}`\)/);
  assert.match(src, /this\.tags\.releaseOthers\?\.\(uid, name, tag\)/);
  assert.match(src, /tag: session\.tag/);
  const lobby = read('server/lobby.js');
  assert.match(lobby, /\.\.\.\(s\.tag \? \{ tag: s\.tag \} : \{\}\)/);
  const views = read('server/match/match/views.js');
  assert.match(views, /\.\.\.\(ps\.tag \? \{ tag: ps\.tag \} : \{\}\)/);
});

test('no display still says DOCTOR #NNNN', () => {
  for (const p of ['public/js/screens/lobby.js', 'public/js/screens/room.js', 'public/js/ui/achievements.js', 'public/js/ui/myInfo.js']) {
    assert.doesNotMatch(read(p), /DOCTOR #\$\{?doctorNo/, `${p} no longer prints DOCTOR #`);
  }
  // the seat's 名片 prints 名字#四位 on the name line; bots keep AUTONOMOUS UNIT on the small line
  assert.match(read('public/js/screens/room.js'), /playerLabel\(seat\.name, seat\.tag\)/);
  assert.match(read('public/js/screens/room.js'), /seat\.isBot \? html`<small class="rseat__doc">AUTONOMOUS UNIT<\/small>` : null/);
  // both cards print ONE 名字#四位 line (no second, smaller ID line under the name)
  assert.match(read('public/js/ui/achievements.js'), /<span class="ach-card__name">\$\{playerLabel\(me\?\.name, me\?\.tag\)\}<\/span>/);
  assert.match(read('public/js/ui/myInfo.js'), /<span class="ach-card__name" data-testid="me-info-tag">\$\{playerLabel\(me\?\.name, me\?\.tag\)\}<\/span>/);
  for (const p of ['public/js/ui/achievements.js', 'public/js/ui/myInfo.js']) assert.doesNotMatch(read(p), /ach-card__id/);
});

test('English strings for the dialog exist', () => {
  const en = JSON.parse(read('public/i18n/en.json'));
  for (const k of ['我的信息', '修改头像', '修改名片', '代号', '编号', '这个「代号#四位数字」已经被占用，换一组再试。']) {
    assert.equal(typeof en[k], 'string', `${k} translated`);
  }
});
