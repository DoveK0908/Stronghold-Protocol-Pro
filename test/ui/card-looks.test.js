// Card looks (feedback #9 / #24): the seat card's portrait and the 头像 in 精二 / 精一 / a skin of that operator
// (ui/seatArt.js lookUrl / lookOptions), and the room.card message carrying them (ui/playerCard.js cardMessage).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookUrl, lookOptions, seatLook, seatIllust } from '../../public/js/ui/seatArt.js';
import { cardMessage, seatCardMatches } from '../../public/js/ui/playerCard.js';

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


// 2026-10-21 维护者：席位卡「对方怎么选的就怎么显示」——皮肤（干员调配）优先于名片外观，自己的读本机 store、
// 队友的读 room.state seat.skins；没有皮肤才回落到名片的那一档（'' 精二 / 'e1' 精一）。
test('seatLook: the owner skin wins over the card look, own and teammate alike', () => {
  const ctx = { myId: 'p_me', myCard: 'char_a', myLook: 'e1', mySkins: { char_a: 'char_a_x_1' } };
  const mine = { playerId: 'p_me', card: { charId: 'char_a', look: '' } };
  assert.equal(seatLook(mine, 'char_a', ctx), 'char_a_x_1', 'own seat uses the local skin store');
  const mate = { playerId: 'p_mate', card: { charId: 'char_a', look: '' }, skins: { char_a: 'char_a_x_1' } };
  assert.equal(seatLook(mate, 'char_a', ctx), 'char_a_x_1', 'a teammate seat uses the broadcast skins');
  const plain = { playerId: 'p_mate', card: { charId: 'char_a', look: 'e1' } };
  assert.equal(seatLook(plain, 'char_a', ctx), 'e1', 'no skin: the card look is the answer');
  const auto = { playerId: 'p_me', card: { charId: 'char_a', look: '' } };
  assert.equal(seatLook(auto, 'char_a', { ...ctx, mySkins: {} }), 'e1', 'no skin of my own: my card look');
  assert.equal(seatLook(auto, 'char_a', { ...ctx, mySkins: {}, myLook: '' }), '', 'no skin and 精二 look');
});

test('seatIllust: a skin draws its illustration; without one it draws the card look art', () => {
  const m = { chars: { char_a: { portrait: '/p1.png', portraitE2: '/p2.png', illust: '/i2.png', illustE1: '/i1.png',
    skins: { char_a_x_1: { charId: 'char_a', name: 'X', portrait: '/sp.png', illust: '/si.png' } } } } };
  const byChar = new Map([['char_a', { charId: 'char_a' }]]);
  const base = { byChar, m, myId: 'p_me', myCard: 'char_b', myLook: '', mySkins: { char_a: 'char_a_x_1' } };
  const mate = { playerId: 'p_mate', card: { charId: 'char_a', look: '' }, skins: { char_a: 'char_a_x_1' } };
  assert.equal(seatIllust(mate, base), '/si.png');
  const plainMate = { playerId: 'p_mate', card: { charId: 'char_a', look: 'e1' } };
  assert.equal(seatIllust(plainMate, base), '/i1.png', '精一 has its own full-body illustration');
  assert.equal(seatLook(plainMate, 'char_a', base), 'e1');
});
