// 结城理 (char_4217_makoto): the 自选-only 傀儡师 whose 替身 is a different 人格面具 per skill.
// The switch itself is professions.js installDollkeeper; this covers what the kit adds — the per-skill form names, T0's
// 停顿 + 人格面具 boosts, S3's 塔纳托斯 → 俄耳甫斯 takeover and T1's 总攻击.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, checkInvariants } from '../helpers/battleHarness.js';

const MAKOTO = 'char_4217_makoto';
const SLOT = 'chess_char_6_diy1_a';

/** Field 结城理 through a tier-6 自选 slot with `skillIndex`. */
const field = (skillIndex, hooks = ['dollSwap', 'fx']) => {
  const h = makeBattle({
    units: [{ diy: { slot: SLOT, charId: MAKOTO, skillIndex }, row: 10, col: 3 }],
    autoFinish: false, timeLimit: 300, hooks,
  });
  h.step();
  return h;
};
/** A lethal body hit switches to the 替身 (the trait's fatal hook). */
const kill = (h, u) => h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });

for (const [skillIndex, form] of [[0, 'doll1'], [1, 'doll2'], [2, 'doll3p1']]) {
  test(`结城理 S${skillIndex + 1}: the 自选 slot fields him and the copy the selected skill summons is '${form}'`, () => {
    const h = field(skillIndex);
    const u = h.unit(1);
    assert.equal(u.def.charId, MAKOTO);
    assert.ok(u.kit && !u.kit.generic, 'the operator kit is loaded, not the generic one');
    assert.equal(u.form, null, 'the 本体 by default');
    kill(h, u);
    assert.ok(u.alive && u.deployed && u.trait.doll, 'a lethal hit switches to the 替身');
    assert.equal(u.form, form);
    const fx = h.eventsOf('fx').filter((e) => e[1] === 'substitute');
    assert.equal(fx.at(-1)?.[4]?.form, form, 'the client is told which copy to draw');
    const swaps = h.hooksOf('dollSwap').filter((c) => c.unit === u);
    assert.equal(swaps.at(-1)?.form, form);
    checkInvariants(h.b);
  });
}

test('结城理 S3: 塔纳托斯 takes the next lethal blow for her and 俄耳甫斯 comes out instead', () => {
  const h = field(2);
  const u = h.unit(1);
  kill(h, u);
  assert.equal(u.form, 'doll3p1');
  h.run(2); // clear the 1 s switch animation
  kill(h, u); // would knock 塔纳托斯 out
  assert.ok(u.alive && u.deployed, 'the 替身 is not knocked out');
  assert.equal(u.form, 'doll3p2', '俄耳甫斯 replaces it');
  assert.equal(h.hooksOf('dollSwap').filter((c) => c.unit === u).at(-1)?.form, 'doll3p2');
  h.run(2);
  kill(h, u); // 俄耳甫斯 has no second chance: the 替身 is knocked out
  h.run(1);
  assert.equal(u.alive, false);
  checkInvariants(h.b);
});

test('结城理 T0: the switch 停顿s the enemies around her and the 替身 fights harder for its 20 s', () => {
  const h = field(0);
  const u = h.unit(1);
  // a 40× 史莱姆: it has to outlive the 替身's first two attacks for the 停顿 to be observable — and the extra step
  // after the spawn is what puts it in the enemy index (a spawn mid-tick is not in `_eb` yet)
  const e = h.spawn('enemy_1007_slime', { pos: [10, 4], mods: { hpMul: 40 } });
  h.step();
  const atkBefore = u.s.atk, hpBefore = u.s.maxHp;
  kill(h, u);
  h.step();
  assert.ok(e.buffs.some((b) => b.status === 'stun' && b.timeLeft > 7), '停顿 for the talent’s 8 s');
  assert.equal(u.form, 'doll1');
  assert.ok(u.s.atk > atkBefore * 1.5, `the 替身's ATK (was ${atkBefore}, now ${u.s.atk})`);
  assert.ok(u.s.maxHp > hpBefore, 'and its max HP');
  assert.ok(u.buffs.some((b) => b.key === 'makoto:doll'));
  checkInvariants(h.b);
});

test('结城理 T1: the 总攻击 lands when the 替身 ends, and the next switch is the 本体 again', () => {
  const h = field(0);
  const u = h.unit(1);
  const e = h.spawn('enemy_1007_slime', { pos: [10, 4], mods: { hpMul: 40 } });
  h.step();
  kill(h, u);
  h.run(2);
  const before = e.hp;
  assert.ok(before > 0, `the enemy survived the 替身's opening hits (${before} HP left)`);
  h.b.removeBuff(u, 'trait:substitute'); // the 20 s run out
  h.step();
  assert.equal(u.form, null, 'back to the 本体');
  assert.ok(e.hp < before, 'the squad’s 总攻击 hit the enemy next to her');
  assert.ok(!u.buffs.some((b) => b.key === 'makoto:doll'), 'the 人格面具’s boosts are gone');
  checkInvariants(h.b);
});

test('结城理 S1: 俄耳甫斯 heals a hurt ally in her range instead of striking', () => {
  const h = makeBattle({
    units: [
      { diy: { slot: SLOT, charId: MAKOTO, skillIndex: 0 }, row: 10, col: 3 },
      { chessId: 'chess_char_4_04_a', row: 10, col: 2 },
    ],
    autoFinish: false, timeLimit: 300, hooks: ['dollSwap', 'fx'],
  });
  h.step();
  const u = h.unit(1);
  const ally = h.allies().find((a) => a !== u);
  h.b.dealDamage(null, ally, { amount: ally.s.maxHp * 0.7, type: 'true' });
  const hurt = ally.hp;
  assert.ok(hurt > 0 && hurt / ally.s.maxHp < 0.5, `the ally stands below half HP (${hurt} of ${ally.s.maxHp})`);
  h.spawn('enemy_1007_slime', { pos: [10, 4], mods: { hpMul: 40, speedMul: 0.01 } });
  h.step();
  kill(h, u);
  assert.equal(u.form, 'doll1');
  h.run(4); // at least one attack goes out with 俄耳甫斯 on the field
  assert.ok(ally.hp > hurt, `the strike became a heal (${hurt} → ${ally.hp})`);
  checkInvariants(h.b);
});

test('结城理 S2: 塔纳托斯的 arts hit reaches up to three targets at once', () => {
  const h = field(1);
  const u = h.unit(1);
  const a = h.spawn('enemy_1007_slime', { pos: [10, 4], mods: { hpMul: 40, speedMul: 0.01 } });
  const b = h.spawn('enemy_1007_slime', { pos: [11, 3], mods: { hpMul: 40, speedMul: 0.01 } });
  h.step();
  const hpA = a.hp, hpB = b.hp;
  kill(h, u);
  assert.equal(u.form, 'doll2');
  h.run(4);
  assert.ok(a.hp < hpA, 'the target of the swing is hit');
  assert.ok(b.hp < hpB, `the second enemy in range is hit too (${hpB} → ${b.hp})`);
  checkInvariants(h.b);
});

test('傀儡师: the 替身 blocks nothing, and S3’s 俄耳甫斯 gets the +2 back', () => {
  const base = field(0);
  assert.equal(base.unit(1).s.blockCnt, 2, 'the 本体 blocks 2');
  const h = field(2);
  const u = h.unit(1);
  kill(h, u);
  assert.equal(u.form, 'doll3p1');
  assert.equal(u.s.blockCnt, 0, '塔纳托斯 blocks nothing (PRTS 替身阻挡数为 0)');
  h.run(2);
  kill(h, u); // P1 would be knocked out ⇒ 俄耳甫斯
  assert.equal(u.form, 'doll3p2');
  assert.equal(u.s.blockCnt, 2, '俄耳甫斯: 阻挡数 +2 (a −99 offset used to flatten it to 0 for ever)');
  checkInvariants(h.b);
});

test('结城理 S2: 击倒 needs the fear — the same low-HP enemy dies only once feared', () => {
  const h = field(1);
  const u = h.unit(1);
  const e = h.spawn('enemy_1007_slime', { pos: [10, 4], mods: { hpMul: 400, speedMul: 0.01 } });
  h.step();
  kill(h, u);
  assert.equal(u.form, 'doll2');
  // a hit of hers is 1.6 × ATK, the kill line is 230 % ATK: park it between the two so one swing hurts but cannot kill
  // and only the 击倒 can finish it
  const swing = u.s.atk * 1.6;
  const line = u.s.atk * 2.3;
  const parked = Math.round((swing + line) / 2);
  assert.ok(swing < parked && parked < line, `parked HP ${parked} sits between ${Math.round(swing)} and ${Math.round(line)}`);
  /** Advance until she swings at `e` once (dmg events are ['dmg', targetId, amount, type]). */
  const oneSwing = () => {
    const before = h.eventsOf('dmg').filter((x) => x[1] === e.id).length;
    for (let i = 0; i < 120; i += 1) {
      h.step();
      if (h.eventsOf('dmg').filter((x) => x[1] === e.id).length > before) return true;
    }
    return false;
  };
  const unfeared = () => { for (const b of e.buffs.slice()) if ((b.status ?? b.key) === 'fear') h.b.removeBuff(e, b); };
  e.hp = parked;
  unfeared();
  assert.ok(oneSwing(), 'she swings at it');
  assert.ok(e.hp > 0, `no fear ⇒ no 击倒 (hp ${e.hp} of max ${e.s.maxHp})`);
  // positive control: the same HP, now feared ⇒ the swing knocks it out
  e.hp = parked;
  h.b.applyStatus(e, 'fear', { duration: 8, source: u });
  assert.ok(oneSwing(), 'the next swing goes out');
  assert.equal(e.hp, 0, 'feared + under 230 % ATK ⇒ 击倒');
  checkInvariants(h.b);
});

test('结城理 S3: pressing the skill while 塔纳托斯 stands switches to 俄耳甫斯 (「开启技能…改为召唤俄耳甫斯」)', () => {
  const h = field(2);
  const u = h.unit(1);
  kill(h, u);
  assert.equal(u.form, 'doll3p1');
  h.run(2);
  u.trait.dollEnter?.();            // the skill press goes through `unit.trait.dollEnter` for S1/S2…
  // …but S3's own onStart is what the player triggers; exercise it directly:
  const kit = u.kit;
  kit.skills.skchr_makoto_3.onStart({ unit: u, battle: h.b });
  assert.equal(u.form, 'doll3p2', 'P1 → 俄耳甫斯 without a lethal hit');
  checkInvariants(h.b);
});
