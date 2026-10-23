// Card looks (feedback #9 / #24): the seat card's portrait and the 头像 in 精二 / 精一 / a skin of that operator
// (ui/seatArt.js lookUrl / lookOptions), and the room.card message carrying them (ui/playerCard.js cardMessage).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookUrl, lookOptions, seatLook, seatIllust } from '../../public/js/ui/seatArt.js';
import { cardMessage, seatCardMatches, cardStore, setCardAvatar, setCustomAvatar, customAvatarSrc } from '../../public/js/ui/playerCard.js';

const M = {
  chars: {
    char_a: { avatar: '/a1.png', avatarE2: '/a2.png', portrait: '/p1.png', portraitE2: '/p2.png' },
    char_b: { avatar: '/b1.png', portrait: '/q1.png' },
  },
  skins: {
    char_a_x_1: { charId: 'char_a', name: 'X', avatar: '/sa.png', portrait: '/sp.png', illustration: '/si.png' },
    char_b_y_1: { charId: 'char_b', name: 'Y', avatar: '/sb.png', portrait: '/sq.png' },
  },
};

test('lookUrl: 精二 by default, 精一 with e1, a skin only for its own operator', () => {
  assert.equal(lookUrl(M, 'char_a', '', 'avatar'), '/a2.png');
  assert.equal(lookUrl(M, 'char_a', 'e1', 'avatar'), '/a1.png');
  assert.equal(lookUrl(M, 'char_a', 'char_a_x_1', 'portrait'), '/sp.png');
  assert.equal(lookUrl(M, 'char_a', 'char_b_y_1', 'portrait'), '/p2.png', "another operator's skin falls back");
  assert.equal(lookUrl(M, 'char_b', '', 'portrait'), '/q1.png', 'no E2 art: 精一');
  assert.equal(lookUrl(M, 'char_zz', '', 'avatar'), null);
});

test('lookOptions: 精二 + 精一 + skins; an operator without E2 art offers 精一 as its default', () => {
  assert.deepEqual(lookOptions(M, 'char_a', 'portrait').map((o) => [o.id, o.src]), [['', '/p2.png'], ['e1', '/p1.png'], ['char_a_x_1', '/sp.png']]);
  assert.deepEqual(lookOptions(M, 'char_b', 'avatar').map((o) => [o.id, o.src]), [['', '/b1.png'], ['char_b_y_1', '/sb.png']]);
  assert.deepEqual(lookOptions(M, 'char_zz', 'avatar'), []);
});

test('cardMessage sends a look only with its operator; seatCardMatches compares the looks', () => {
  const msg = cardMessage({ charId: 'char_a', look: 'e1', avatar: '', avatarLook: 'e1', bg: 'skin:char_a_x_1', trophies: 3 });
  assert.equal(msg.look, 'e1');
  assert.equal(msg.avatarLook, '', 'no avatar operator: no avatar look');
  // 名片底图现在有默认款（ui/namecards.js DEFAULT_NAMECARD），认不出的皮肤底图回落到默认款而不是空串
  assert.equal(msg.bg, 'loading:abyss', 'an unknown skin card falls back to the default name card');
  assert.equal(seatCardMatches({ charId: 'char_a', look: 'e1', bg: 'loading:abyss', trophies: 3 }, msg), true);
  assert.equal(seatCardMatches({ charId: 'char_a', trophies: 3 }, msg), false);
});


// 2026-10-22 维护者：选择「精一/精二/皮肤」必须真能切——席位卡只认「更换立绘」这一处的选择
// （自己读本机 card.look，队友读 room.state 里的 seat.card.look）；干员调配里的皮肤不参与，
// 否则选了皮肤就永远切不回精一/精二。
test('seatLook: the card look wins, own and teammate alike; loadout skins stay out of the seat card', () => {
  const ctx = { myId: 'p_me', myCard: 'char_a', myLook: 'e1', mySkins: { char_a: 'char_a_x_1' } };
  const mine = { playerId: 'p_me', card: { charId: 'char_a', look: '' } };
  assert.equal(seatLook(mine, 'char_a', ctx), 'e1', 'own seat follows my own card look, not the loadout skin');
  const mate = { playerId: 'p_mate', card: { charId: 'char_a', look: '' }, skins: { char_a: 'char_a_x_1' } };
  assert.equal(seatLook(mate, 'char_a', ctx), '', 'a teammate seat follows its card look and ignores seat.skins');
  const plain = { playerId: 'p_mate', card: { charId: 'char_a', look: 'e1' } };
  assert.equal(seatLook(plain, 'char_a', ctx), 'e1', '精一 from a teammate');
  const auto = { playerId: 'p_me', card: { charId: 'char_a', look: '' } };
  assert.equal(seatLook(auto, 'char_a', { ...ctx, myLook: '' }), '', 'own seat: 精二 look');
});

test('seatIllust: 精二/精一/皮肤 all draw the illustration of that look', () => {
  const m = { chars: { char_a: { portrait: '/p1.png', portraitE2: '/p2.png', illust: '/i2.png', illustE1: '/i1.png',
    skins: { char_a_x_1: { charId: 'char_a', name: 'X', portrait: '/sp.png', illust: '/si.png' } } } } };
  const byChar = new Map([['char_a', { charId: 'char_a' }]]);
  const base = { byChar, m, myId: 'p_me', myCard: 'char_b', myLook: '' };
  const mateSkin = { playerId: 'p_mate', card: { charId: 'char_a', look: 'char_a_x_1' } };
  assert.equal(seatIllust(mateSkin, base), '/si.png', 'a skin picked in 更换立绘 draws its illustration');
  const plainMate = { playerId: 'p_mate', card: { charId: 'char_a', look: 'e1' } };
  assert.equal(seatIllust(plainMate, base), '/i1.png', '精一 has its own full-body illustration');
  assert.equal(seatLook(plainMate, 'char_a', base), 'e1');
});

// 2026-10-23 维护者：「在准备大厅调整头像连自己都不生效」——头像 是三选一的一格（默认 / 干员官方头像 / 自传图片），
// 自传图片曾经一直排在前面，于是换成官方头像后界面完全不变，队友也一直看到旧图；清掉自传图片则根本发不出去。
test('头像 is one slot: picking an official avatar drops the uploaded picture and tells the room about it', () => {
  const id = '0123456789abcdef';
  setCustomAvatar(id);
  assert.equal(cardStore.get().avatarImg, id, '上传后立刻生效');
  assert.equal(cardStore.get().avatarImgSaved, id, '上传的 id 留着，选择器还能换回来');
  assert.equal(customAvatarSrc(cardStore.get()), `/avatar/${id}`);
  assert.equal(cardMessage(cardStore.get()).avatarImg, id, 'room.card 里带上这张图');

  setCardAvatar('char_a');
  assert.equal(cardStore.get().avatar, 'char_a');
  assert.equal(cardStore.get().avatarImg, '', '选了官方头像就必须把自传图片让开，否则界面毫无变化');
  assert.equal(customAvatarSrc(cardStore.get()), '', '换成官方头像后画的是干员头像');
  assert.equal(cardStore.get().avatarImgSaved, id, '图本身没删，还能换回上传的那张');
  assert.equal(cardMessage(cardStore.get()).avatarImg, '', 'room.card 里清掉，队友也跟着换');

  setCustomAvatar(cardStore.get().avatarImgSaved);
  assert.equal(cardStore.get().avatarImg, id, '选择器里那一格能换回上传的图片');

  setCardAvatar('');
  assert.equal(cardStore.get().avatarImg, '', '默认 也把自传图片让开');
  assert.equal(cardMessage({ ...cardStore.get(), avatarImg: 'nonsense' }).avatarImg, '', '非法 id 不上行');
  const base = { charId: '', avatar: '', bg: 'loading:abyss', trophies: 0, look: '', avatarLook: '' };
  assert.equal(seatCardMatches({ ...base, avatarImg: id }, { ...base, avatarImg: '' }), false, 'avatarImg 变了就算没同步');
  assert.equal(seatCardMatches({ ...base, avatarImg: id }, { ...base, avatarImg: id }), true);
});
