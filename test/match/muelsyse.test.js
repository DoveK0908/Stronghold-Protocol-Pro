// Official dev §37.42–§37.44: ordinary bot Muelsyse sale, promotion timing, 9 炎 and Sargon equipment lending.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botPrepBegin, equipItems, arrange, itemTarget } from '../../server/match/bot.js';
import { makeMatch, give, giveItem, legalTileFor, DATA } from './harness.js';

const MLYSS = 'chess_char_6_11_a'; // 缪尔赛思
const MORPH = 'chess_item_6_09_e_a'; // 变形同构体
const PROMO_NOW = 'chess_item_5_06_e_b'; // 进阶博士投影
const bots = [{ seat: 0, playerId: 'ai_0', name: 'AI-1', isBot: true, connected: true }];

function setup(t, round = 11) {
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', seed: 5, seats: bots }).start().toPrep();
  t.after(() => h.m.dispose());
  const m = h.m, ps = m.order[0];
  ps.hand.fill(null);
  ps.board.clear();
  ps.bandId = 'band_sarkazb'; // 歌利亚: no strategy bond
  delete ps._botFocus;
  delete ps._botFocusId;
  m.round = round;
  ps.shop.level = 5;
  ps.shop.upgradePrice = 100;
  ps.shop.slots = [];
  ps.funds = 0;
  ps.recompute();
  return { m, ps };
}

/** Visible members belonging to no other core bond, lowest tier first, with copies in this seat's pool. */
const membersOf = (m, bond, n) => DATA.bonds[bond].visibleMembers.map((id) => DATA.chess[id])
  .filter((c) => c && m.pool.left(c.chessId) >= 1 && !c.bonds.some((b) => b !== bond && DATA.bonds[b]?.isCore))
  .sort((a, b) => a.tier - b.tier).slice(0, n);
const deploy = (m, ps, c) => give(m, ps, c.chessId, 'board', legalTileFor(m, ps, c.chessId));
const morphs = (ps) => [...ps.hand, ...ps.temp].filter((p) => p && p.id === MORPH).length
  + ps.allChess().reduce((n, p) => n + (p.items || []).filter((it) => it.id === MORPH).length, 0);
const owns = (m, ps, id) => ps.allChess().some((p) => m.gd.baseIdOf(p.id) === id);

test('§37.42: outside 炎 a 缪尔赛思 from an offer is sold at once — her 变形同构体 stays, the copy returns to the pool', (t) => {
  const { m, ps } = setup(t);
  for (const c of membersOf(m, 'siracusaShip', 5)) deploy(m, ps, c);
  const left = m.pool.left(MLYSS);
  ps.pushRewardOffer('merge', { tier: 6, ids: [MLYSS] });
  botPrepBegin(m, ps);
  assert.equal(owns(m, ps, MLYSS), false, 'sold');
  assert.equal(morphs(ps), 1, 'the 变形同构体 she brought stays');
  assert.equal(m.pool.left(MLYSS), left, 'her copy is back in the pool');
});

test('§37.42: with 炎 the focus (its top tier 9 exceeds the deploy cap) she stays', (t) => {
  const { m, ps } = setup(t);
  for (const c of membersOf(m, 'yanShip', 4)) deploy(m, ps, c);
  ps.pushRewardOffer('merge', { tier: 6, ids: [MLYSS] });
  botPrepBegin(m, ps);
  assert.equal(owns(m, ps, MLYSS), true);
});

test('§37.42: one that arrives another way (not from an offer) is sold by the item step', (t) => {
  const { m, ps } = setup(t);
  for (const c of membersOf(m, 'siracusaShip', 3)) deploy(m, ps, c);
  give(m, ps, MLYSS, 'hand');
  equipItems(m, ps);
  assert.equal(owns(m, ps, MLYSS), false);
});

test('§37.42: the 博士投影 that promotes at once waits for a deployed tier-4+ normal operator, then promotes it', (t) => {
  const { m, ps } = setup(t, 2);
  const low = Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.tier <= 2 && m.pool.left(c.chessId) >= 1).slice(0, 2);
  for (const c of low) deploy(m, ps, c);
  giveItem(m, ps, PROMO_NOW, 'hand');
  equipItems(m, ps);
  assert.ok(ps.hand.some((p) => p && p.id === PROMO_NOW), 'kept while only tier ≤ 2 operators stand');
  const t4 = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier === 4 && m.pool.left(c.chessId) >= 1);
  deploy(m, ps, t4);
  equipItems(m, ps);
  assert.ok(!ps.hand.some((p) => p && p.id === PROMO_NOW), 'used');
  assert.ok([...ps.board.values()].some((p) => p.kind === 'chess' && m.gd.isGolden(p.id)), 'an elite on the board');
});

test('§37.42: in the Final Assault prep the 博士投影 that promotes at once is used on whoever stands', (t) => {
  const { m, ps } = setup(t);
  m.round = m.gd.bossRound;
  const low = Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.tier <= 2 && m.pool.left(c.chessId) >= 1).slice(0, 2);
  for (const c of low) deploy(m, ps, c);
  giveItem(m, ps, PROMO_NOW, 'hand');
  equipItems(m, ps);
  assert.ok(!ps.hand.some((p) => p && p.id === PROMO_NOW));
});

test('§37.42: elite 缪尔赛思 and advisor-protected normal 缪尔赛思 are not sold outside 炎', (t) => {
  for (const elite of [true, false]) {
    const { m, ps } = setup(t);
    for (const c of membersOf(m, 'siracusaShip', 3)) deploy(m, ps, c);
    const her = give(m, ps, elite ? m.gd.goldenIdOf(MLYSS) : MLYSS, 'hand');
    if (!elite) m.externalAI = { planFor: () => ({ keep: [MLYSS] }) };
    equipItems(m, ps);
    assert.ok(ps.find(her.uid), elite ? 'elite stays' : 'advisor protection stays');
    delete m.externalAI;
  }
});

test('§37.42: a tier-4 operator on the bench does not unlock early immediate promotion', (t) => {
  const { m, ps } = setup(t, 2);
  const low = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier === 1 && m.pool.left(c.chessId) >= 1);
  const high = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier === 4 && m.pool.left(c.chessId) >= 1);
  deploy(m, ps, low);
  give(m, ps, high.chessId, 'hand');
  const item = giveItem(m, ps, PROMO_NOW, 'hand');
  equipItems(m, ps);
  assert.ok(ps.find(item.uid), 'requires a deployed tier-4 operator');
});

test('§37.42: an advisor item plan may promote a deployed low-tier operator immediately', (t) => {
  const { m, ps } = setup(t, 2);
  const low = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier === 1 && m.pool.left(c.chessId) >= 1);
  deploy(m, ps, low);
  const item = giveItem(m, ps, PROMO_NOW, 'hand');
  m.externalAI = { planFor: () => ({ items: { equip: [{ id: PROMO_NOW, target: low.chessId }] } }) };
  equipItems(m, ps);
  assert.equal(ps.find(item.uid), null, 'advisor bypasses the delay');
  assert.ok(ps.allChess().some((p) => m.gd.isGolden(p.id)));
  delete m.externalAI;
});

const DAGGER = 'chess_item_3_04_e_a'; // 炎国短刀
const strongOutsiders = (m, n) => Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.tier === 6
  && !c.bonds.includes('yanShip') && !c.bonds.some((b) => DATA.bonds[b]?.activeType === 'MANI') && m.pool.left(c.chessId) >= 1).slice(0, n);

test('§37.43: with 炎 the focus, 缪尔赛思 on the bench takes the held 炎国短刀 and 变形同构体', (t) => {
  const { m, ps } = setup(t, 12);
  for (const c of membersOf(m, 'yanShip', 6)) deploy(m, ps, c);
  for (const c of Object.values(DATA.chess).filter((c) => c.visible && c.isGolden && c.tier === 6 && !c.bonds.includes('yanShip')
    && !c.bonds.some((b) => DATA.bonds[b]?.activeType === 'MANI')).slice(0, 2)) deploy(m, ps, c);
  const her = give(m, ps, MLYSS, 'hand');
  giveItem(m, ps, DAGGER, 'hand');
  giveItem(m, ps, MORPH, 'hand');
  equipItems(m, ps);
  assert.deepEqual((her.items || []).map((it) => it.id).sort(), [DAGGER, MORPH].sort());
});

test('§37.43: 缪尔赛思 converted and seven 炎 owned — the lineup fields her with seven 炎 for 9 炎', (t) => {
  const { m, ps } = setup(t, 12);
  const yan = membersOf(m, 'yanShip', 7);
  assert.equal(yan.length, 7, 'seven 炎 operators');
  for (const c of yan.slice(0, 6)) deploy(m, ps, c);
  for (const c of strongOutsiders(m, 2)) deploy(m, ps, c);
  give(m, ps, yan[6].chessId, 'hand');
  const her = give(m, ps, MLYSS, 'hand');
  for (const id of [DAGGER, MORPH]) { const it = giveItem(m, ps, id, 'hand'); ps.equip(it.uid, her.uid); }
  arrange(m, ps);
  assert.equal(ps.bonds.yanShip.count, 9, '7 炎 + 缪尔赛思 converted + 调和');
  assert.ok([...ps.board.values()].some((p) => p.uid === her.uid), 'she is deployed');
});

test('§37.44: equipment prefers a 萨尔贡 member over a stronger outsider only under the lending strategy', (t) => {
  const { m, ps } = setup(t, 9);
  const member = membersOf(m, 'sargonShip', 1)[0];
  const outsider = Object.values(DATA.chess).find((c) => c.visible && c.isGolden && c.tier === 6
    && !c.bonds.includes('sargonShip') && c.attackKind !== 'heal' && c.attackKind !== 'none'
    && !c.bonds.some((b) => DATA.bonds[b]?.activeType === 'MANI'));
  const weak = deploy(m, ps, member);
  const strong = deploy(m, ps, outsider);
  const item = giveItem(m, ps, 'chess_item_1_01_e_a');
  ps.bandId = 'band_narant';
  assert.equal(itemTarget(m, ps, item).uid, weak.uid, 'lending member first');
  ps.bandId = 'band_sarkazb';
  assert.equal(itemTarget(m, ps, item).uid, strong.uid, 'ordinary damage-dealer preference');
});

test('§37.44: with 娜仁图亚 and four 萨尔贡 a tier-3+ combat item is bought for a 萨尔贡 member; another strategy buys none', (t) => {
  const item = Object.values(DATA.items).find((r) => r.itemType === 'EQUIP' && r.tier === 4 && !r.isGolden && !r.giveBondId && !r.canGiveBond
    && Array.isArray(r.buffs) && r.buffs.length && !String(r.buffs[0].key).startsWith('use_') && !String(r.buffs[0].key).includes('coin')
    && !(typeof r.kind === 'string' && r.kind.startsWith('consume')) && r.category !== 'SURVIVAL' && r.price <= 4);
  for (const [band, want] of [['band_narant', true], ['band_sarkazb', false]]) {
    const { m, ps } = setup(t, 9);
    ps.bandId = band;
    for (const c of membersOf(m, 'sargonShip', 4)) deploy(m, ps, c);
    ps.funds = 6;
    ps.shop.slots = [{ kind: 'item', id: item.id, basePrice: item.price, sold: false }];
    botPrepBegin(m, ps);
    const carrier = ps.allChess().find((p) => (p.items || []).some((it) => it.id === item.id));
    assert.equal(!!carrier, want, `${band}: ${item.name}`);
    if (want) assert.ok(m.gd.chess(carrier.id).bonds.includes('sargonShip'), 'worn by a 萨尔贡 member');
  }
});
