// Experimental 联防状态继承 — the enemy side of the codec against REAL content phases: capture at the moment an enemy
// leaves, waiting never advances the snapshot, and the destination rebuilds the native phase (not just its numbers).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle } from '../helpers/battleHarness.js';
import { captureEnemyCarry, restoreEnemyCarry, sanitizeEnemyCarry } from '../../server/sim/enemyCarry.js';

const OP = { chessId: 'chess_char_1_01_a', row: 10, col: 5 };
const statueKey = 'enemy_1172_dugago';        // 守墓石像: 折射 + 1st KO → 10 s statue → arts flyer
const rebornKey = 'enemy_10098_crhro';        // 主角阵营角色: 重生 3 s, hp_ratio 1
const huskKey = 'enemy_1288_duskls';          // 深池逐火战士: 1 s 重生 ⇒ 5-hit ember, back after 10 s

/** A battle with the state-carry switch on, no auto-finish (a carried enemy may be off the field for a while). */
function carryBattle(opts = {}) {
  const setup = opts.setup;
  return makeBattle({
    units: [OP], enemies: [], autoFinish: false, ...opts,
    setup: (b) => { b.stateCarry = true; setup?.(b); },
  });
}

function kill(h, key) {
  const e = h.enemy(key);
  assert.ok(e, `${key} should have spawned`);
  h.b.dealDamage(h.unit(OP.chessId), e, { amount: 1e9, type: 'true' });
  return e;
}

/** The same battle without any scheduled enemies; spawn one with a snapshot. */
function spawnWith(dto, key) {
  const h = carryBattle();
  return { h, e: h.spawn(key, { stateCarry: dto }) };
}

test('a statue-phase enemy keeps its phase, frozen statue timer and rebound native flyer', () => {
  const h = carryBattle({ enemies: [{ key: statueKey, time: 0 }] });
  h.run(0.5);
  const e = kill(h, statueKey);
  assert.equal(e.alive, true, 'the statue is a rebirth, not a death');
  const stone = e.findBuff('ab:stone');
  assert.ok(stone, 'the statue phase entered');
  assert.ok(stone.timeLeft > 0);
  h.run(2);
  const dto = captureEnemyCarry(h.b, e);
  assert.ok(dto, 'the statue carries');
  assert.equal(dto.phases.statue.values.done, true);
  const left = dto.phases.statue.buffs.find((b) => b.key === 'ab:stone').left;
  assert.ok(left > 0 && left < stone.duration, `the statue timer is sampled mid-phase (got ${left})`);
  assert.equal(dto.hp, e.s.maxHp, 'the statue refills HP at the knock-out');
  // Detached data: the source battle moving on must not reach into the snapshot.
  const before = JSON.stringify(dto);
  h.run(3);
  assert.equal(JSON.stringify(dto), before, 'the snapshot is detached from the source battle');

  const { h: h2, e: e2 } = spawnWith(dto, statueKey);
  assert.ok(e2);
  assert.equal(e2.form, 'stone', 'the destination is in the carried statue phase');
  assert.equal(e2.hp, dto.hp);
  const held = e2.findBuff('ab:stone');
  assert.ok(held, 'the statue buff exists in the destination');
  assert.ok(Math.abs(held.timeLeft - left) < 1e-9, 'the carried timer is the sampled remainder, not restarted');
  assert.ok(e2.mem.ab.immune.has('levitate'), 'the statue immunity is restored by its adapter');
  h2.runUntil(() => !e2.findBuff('ab:stone'), 30);
  assert.equal(e2.alive, true, 'the statue should still be on the field when its timer runs out');
  assert.equal(e2.motion, 'FLY', 'the rebound onExpire turns it into the native flyer');
  assert.ok(e2.findBuff('ab:flight'), 'the flyer phase content is rebuilt, not just its numbers');
});

test('a reborn enemy resumes the carried remainder instead of restarting the phase', () => {
  const h = carryBattle({ enemies: [{ key: rebornKey, time: 0 }] });
  h.run(0.5);
  const e = kill(h, rebornKey);
  assert.equal(e.form, 'reborn', 'the enemy entered its native reborn phase');
  h.run(0.5);
  const held = e.findBuff('ab:reborn');
  assert.ok(held && held.timeLeft > 0 && held.timeLeft < held.duration);
  h.run(1);
  const dto = captureEnemyCarry(h.b, e);
  assert.ok(dto);
  assert.equal(dto.phases.reborn.values.state, 'reborn');
  const elapsed = dto.phases.reborn.values.elapsed;
  assert.ok(elapsed >= 1, `the elapsed phase time is carried (got ${elapsed})`);
  const left = dto.phases.reborn.buffs.find((b) => b.key === 'ab:reborn').left;

  const { h: h2, e: e2 } = spawnWith(dto, rebornKey);
  assert.equal(e2.form, 'reborn');
  const held2 = e2.findBuff('ab:reborn');
  assert.ok(Math.abs(held2.timeLeft - left) < 1e-9, 'the reborn timer is the carried remainder');
  h2.runUntil(() => e2.form !== 'reborn', left + 5);
  assert.equal(e2.alive, true);
  assert.equal(e2.form, 'form2', 'the rebound onExpire finishes the native rebirth');
  assert.ok(e2.hp > 0);
});

test('a husk enemy keeps its ember state and revives at the carried remainder', () => {
  const h = carryBattle({ enemies: [{ key: huskKey, time: 0 }] });
  h.run(0.5);
  const e = kill(h, huskKey);
  assert.equal(e.form, 'husk', 'the enemy became its ember');
  h.run(2);
  const dto = captureEnemyCarry(h.b, e);
  assert.ok(dto, 'the ember carries');
  assert.equal(dto.phases.husk.values.state, 'husk');
  const revive = dto.phases.husk.values.reviveRemaining;
  assert.ok(revive > 0 && revive < 12, `the revive remainder is sampled (got ${revive})`);
  const hp = dto.hp;

  const { h: h2, e: e2 } = spawnWith(dto, huskKey);
  assert.equal(e2.form, 'husk', 'the destination is the carried ember');
  assert.equal(e2.hp, hp, 'the ember keeps its absolute HP');
  h2.runUntil(() => e2.form !== 'husk', revive + 5);
  assert.equal(e2.alive, true, 'the ember should still be on the field at its carried revive time');
  assert.equal(e2.form, 'revived', 'the re-armed revive schedule fires at the carried remainder');
  assert.equal(e2.hp, e2.s.maxHp, 'the native revive refills HP');
});

test('the switch off keeps the leak payload and the fresh spawn untouched', () => {
  const h = makeBattle({ units: [OP], enemies: [{ key: statueKey, time: 0 }], autoFinish: false });
  h.run(0.5);
  const e = kill(h, statueKey);
  assert.equal(captureEnemyCarry(h.b, e), null, 'no carry record without the switch');
  const h2 = makeBattle({ units: [OP], enemies: [], autoFinish: false });
  const e2 = h2.spawn(statueKey, { stateCarry: { v: 1, hp: 1, maxHp: 99, phases: {} } });
  assert.equal(e2.hp, e2.s.maxHp, 'a snapshot cannot be restored into a room that did not enable the rule');
});

test('boss and hidden leader pools never carry', () => {
  const h = carryBattle({ sharedBoss: { hp: 5000, players: ['p1'] }, enemies: [] });
  const e = h.b.spawnEnemy(statueKey, { tag: 'boss', bossPool: true });
  if (!e) return;                       // a stage without a leader pool refuses boss spawns: nothing to assert
  assert.equal(captureEnemyCarry(h.b, e), null);
  assert.equal(restoreEnemyCarry(h.b, e, { v: 1, hp: 1, maxHp: 2, phases: {} }), false);
});

test('the stored HP is applied after phase buffs, so a phase that refills HP stays refilled', () => {
  const h = carryBattle({ enemies: [{ key: rebornKey, time: 0 }] });
  h.run(0.5);
  const e = kill(h, rebornKey);          // the reborn knock-out drops HP to 1
  const dto = captureEnemyCarry(h.b, e);
  assert.ok(dto.hp <= 1 + 1e-9, `the knock-out HP is what carries (got ${dto.hp})`);
  const { e: e2 } = spawnWith(dto, rebornKey);
  assert.ok(Math.abs(e2.hp - dto.hp) < 1e-9, 'the absolute carried HP wins over the destination spawn value');
});

test('sanitize rejects incompatible records instead of clamping them', () => {
  const ok = { v: 1, hp: 50, maxHp: 100, phases: {} };
  assert.ok(sanitizeEnemyCarry(ok));
  for (const bad of [
    { ...ok, v: 2 }, { ...ok, hp: -1 }, { ...ok, maxHp: 0 }, { ...ok, hp: 101 }, { ...ok, phases: [] },
    { ...ok, phases: { __proto__: { values: {}, buffs: [] } } },
    { ...ok, phases: { p: { values: {}, buffs: [{ key: 'x', left: -1, mods: {}, flags: {}, stacks: 1, acc: 0 }] } } },
    { ...ok, phases: { p: { values: {}, buffs: [{ key: 'x', left: 1, mods: {}, flags: {}, stacks: 0, acc: 0 }] } } },
  ]) assert.equal(sanitizeEnemyCarry(bad), null, `should reject ${JSON.stringify(bad).slice(0, 60)}`);
  const clean = sanitizeEnemyCarry(ok);
  clean.hp = 3;
  assert.equal(ok.hp, 50, 'sanitize returns a detached copy');
});

test('an adapter-incompatible unit block is refused and leaves the fresh enemy alone', () => {
  const h = carryBattle();
  const base = { v: 1, hp: 50, maxHp: 100, phases: {} };
  for (const values of [{ motion: 'SWIM' }, { motion: 'WALK', baseMaxHp: -1 },
    { motion: 'WALK', baseMaxHp: 1, rangeRadius: 0, times: 0, atkType: null },
    { motion: 'WALK', baseMaxHp: 1, rangeRadius: 0, times: null, atkType: 'fire' },
    { motion: 'WALK', baseMaxHp: 1, rangeRadius: 0, times: null, atkType: null, extra: 1 }]) {
    const e = h.spawn(rebornKey, {});
    const hp0 = e.hp;
    assert.equal(restoreEnemyCarry(h.b, e, { ...base, phases: { unit: { values, buffs: [] } } }), false,
      `should refuse ${JSON.stringify(values)}`);
    assert.equal(e.hp, hp0, 'a refused record must not mutate the fresh enemy');
    e.alive = false;
  }
});

// ── the ally side: only the remaining redeployment time is carried ────────────────────────────────────────────────
const OP2 = { chessId: 'chess_char_1_02_a', row: 10, col: 7 };

test('a knocked-out ally keeps its remaining redeployment time, not the full respawn timer', () => {
  const h = carryBattle({ units: [OP, OP2], timeLimit: 3 });
  h.run(0.5);
  const a = h.unit(OP.chessId);
  const b = h.unit(OP2.chessId);
  h.b.dealDamage(a, b, { amount: 1e9, type: 'true' });
  assert.equal(b.alive, false, 'the second operator is down');
  assert.ok(Number.isFinite(b.respawnAt) && b.respawnAt > h.b.time, 'the official redeploy timer is armed');
  const official = b.respawnAt - h.b.time;
  const res = h.runToEnd(20);
  const end = res.perPlayer.p1.unitsEnd.find((u) => u.uid === 2);
  assert.equal(end.alive, false);
  assert.ok(Number.isFinite(end.redeployRemaining), 'the remaining redeployment time is carried');
  assert.ok(end.redeployRemaining >= 0 && end.redeployRemaining < official + 1e-6, 'the remainder is what is left, not a restart');
});

test('without the switch the ally result keeps its official shape', () => {
  const h = makeBattle({ units: [OP, OP2], timeLimit: 3 });
  h.run(0.5);
  h.b.dealDamage(h.unit(OP.chessId), h.unit(OP2.chessId), { amount: 1e9, type: 'true' });
  const res = h.runToEnd(20);
  const end = res.perPlayer.p1.unitsEnd.find((u) => u.uid === 2);
  assert.equal('redeployRemaining' in end, false, 'no carry field without the rule (goldens stay put)');
});

test('a forced-out ally re-enters on the carried remainder instead of the official timer', () => {
  const carry = { down: true, redeployRemaining: 3 };
  const on = carryBattle({ units: [{ ...OP, carryState: carry }, OP2], timeLimit: 8 });
  const off = makeBattle({ units: [{ ...OP, carryState: carry }, OP2], timeLimit: 8 });
  on.run(0.1); off.run(0.1);
  const uOn = on.unit(OP.chessId);
  const uOff = off.unit(OP.chessId);
  assert.equal(uOn.alive, false);
  assert.equal(uOn.carry.redeployRemaining, 3);
  assert.ok(Math.abs(uOn.respawnAt - 3) < 1e-9, `the carried remainder arms the timer (got ${uOn.respawnAt})`);
  assert.ok(uOff.respawnAt > 30, `the official timer is the full respawn time (got ${uOff.respawnAt})`);
  on.runUntil(() => uOn.alive, 10);
  assert.equal(uOn.alive, true, 'the operator comes back when the carried remainder runs out');
});

test('a carried zero remainder is honoured, a malformed one is ignored', () => {
  const zero = carryBattle({ units: [{ ...OP, carryState: { down: true, redeployRemaining: 0 } }], timeLimit: 8 });
  zero.run(0.1);
  assert.equal(zero.unit(OP.chessId).respawnAt, 0, '0 is a valid remainder: it re-enters at the first opportunity');
  for (const bad of [-1, NaN, Infinity, '3']) {
    const h = carryBattle({ units: [{ ...OP, carryState: { down: true, redeployRemaining: bad } }], timeLimit: 8 });
    h.run(0.1);
    const u = h.unit(OP.chessId);
    assert.ok(u.respawnAt > 30, `a malformed remainder (${String(bad)}) falls back to the official timer`);
  }
});

test('the option reaches a battle only for the normal and Unite kinds', async () => {
  const { buildBattleSpec } = await import('../../server/sim/spec.js');
  const { getDefaultSource } = await import('../../server/sim/simdata.js');
  const data = getDefaultSource();
  const base = { data, stage: data.getStage(data.raw.stages?.[0]?.id ?? Object.keys(data.raw.stages)[0]), players: [] };
  for (const kind of ['normal', 'unite']) {
    assert.equal(buildBattleSpec({ ...base, kind, stateCarry: true }).stateCarry, true, `${kind} may carry`);
    assert.equal('stateCarry' in buildBattleSpec({ ...base, kind }), false, `${kind} is off by default`);
  }
  for (const kind of ['boss', 'hidden']) {
    assert.equal('stateCarry' in buildBattleSpec({ ...base, kind, stateCarry: true }), false, `${kind} never carries`);
  }
  // A payload smuggled into a room that did not enable the rule is dropped, unit side included.
  const payload = { v: 1, hp: 5, maxHp: 100, phases: {} };
  const dirty = { ...buildBattleSpec({ ...base, kind: 'normal' }),
    spawns: [{ time: 1, enemyKey: statueKey, routeIndex: 0, stateCarry: payload }],
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
      units: [{ uid: 1, kind: 'chess', chessId: OP.chessId, carryState: { down: true, redeployRemaining: 5 } }] }] };
  const clean = buildBattleSpec(dirty);
  assert.equal('stateCarry' in clean, false);
  assert.equal('stateCarry' in clean.spawns[0], false, 'an enemy payload without the rule is dropped');
  assert.equal('redeployRemaining' in clean.players[0].units[0].carryState, false, 'an ally remainder without the rule is dropped');
});
