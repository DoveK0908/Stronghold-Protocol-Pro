// In-process coverage of the optional normal → Unite → relay state transport; no Worker/browser is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../../server/match/Match.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { buildUniteWave } from '../../server/match/waves.js';
import { planUnite, planUniteRelay, uniteBattleOpts } from '../../server/match/unite.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { DATA, makeMatch, give, legalTileFor } from './harness.js';
import { EXPERIMENTAL_DEFAULTS } from '../../shared/experimental.js';

const enemyKey = 'enemy_1007_slime';
const snapshot = (hp = 21) => ({ v: 1, hp, maxHp: 100, phases: {} });
const leak = (stateCarry = snapshot(), extra = {}) => ({ enemyKey, counted: true, sourcePlayerId: 'p_0',
  lpr: 1, mods: { hpMul: 2 }, stateCarry, ...extra });
const result = (leaked = [], unitsEnd = []) => ({ leaked, unitsEnd, perfect: !leaked.length });

function fixture(t, stateCarry = true) {
  const h = makeMatch({ humans: 8, seed: 9017, experimental: { ...EXPERIMENTAL_DEFAULTS, playerCapacity: 20, stateCarry }, clients: false }).start();
  t.after(() => h.m.dispose());
  h.toPrep(1);
  h.setStage('act2autochess_m04');
  const m = h.m;
  m._normalAliveCount = 8;
  m.lastResults = new Map(m.order.map((p) => [p.playerId, result(p.seat === 0 ? [leak()] : [])]));
  return { h, m, plan: planUnite(m, m.lastResults) };
}

// Inspect the actual options handed through createBattleFromSpec without constructing an extra battle.
class CaptureBattle {
  constructor(opts) { this.opts = opts; }
}

test('Match: stateCarry forces server authority, leaves disabled authority alone and retains eligible worker pools', t => {
  for (const stateCarry of [false, true]) {
    const scheduler = new VirtualScheduler();
    // Constructor eligibility only; no job is submitted and no real scheduler or Worker is made.
    scheduler.virtual = false;
    const pool = { submit() { assert.fail('constructor must not start worker jobs'); } };
    const m = new Match({ roomCode: 'CARRY', mode: 'coop', difficulty: 'NORMAL', data: DATA,
      seats: [{ playerId: 'p_0', seat: 0, name: 'P0', connected: true, isBot: false }],
      scheduler, clientCombat: true, combatPool: pool, trialPool: pool, experimental: { ...EXPERIMENTAL_DEFAULTS, stateCarry },
      send() {}, broadcast() {}, onEnd() {}, log: { info() {}, warn() {}, error() {}, debug() {} } });
    t.after(() => m.dispose());
    assert.equal(m.clientCombat, !stateCarry);
    assert.equal(m.combatPool, stateCarry ? pool : null);
    assert.equal(m.trialPool, stateCarry ? pool : null);
  }
});

test('Match normal/unite options gate the flag and the next normal field never inherits the last result', t => {
  for (const enabled of [false, true]) {
    const { m, plan } = fixture(t, enabled);
    const normal = m._normalOpts(m.players.get('p_0'));
    const unite = m._uniteOpts(plan, 60);
    assert.equal(Object.hasOwn(normal, 'stateCarry'), enabled);
    assert.equal(Object.hasOwn(unite, 'stateCarry'), enabled);
    assert.equal(buildBattleSpec(normal).stateCarry, enabled ? true : undefined);
    assert.equal(buildBattleSpec(unite).stateCarry, enabled ? true : undefined);
    assert.ok(normal.spawns.every((s) => !Object.hasOwn(s, 'stateCarry')));
    assert.ok(normal.players.every((p) => p.units.every((u) => !u.carryState)));
    assert.equal(Object.hasOwn(plan.leaked[0], 'stateCarry'), enabled);
    assert.equal(Object.hasOwn(unite.spawns[0], 'stateCarry'), enabled);
    const next = m._normalOpts(m.players.get('p_0'));
    assert.deepEqual(next, normal, 'building Unite must not contaminate the next normal input');
  }
});

test('spec round trip keeps detached sanitized HP/phase data only for enabled normal/unite', () => {
  const carry = snapshot();
  carry.extra = 'not part of the DTO';
  for (const kind of ['normal', 'unite', 'boss', 'hidden']) for (const enabled of [false, true]) {
    const allowed = enabled && ['normal', 'unite'].includes(kind);
    const input = { kind, stateCarry: enabled, players: [{ playerId: 'p', units: [
      { uid: 'down', carryState: { down: true, redeployRemaining: 0 } },
      { uid: 'up', carryState: { hpPct: 0.5, sp: 3, redeployRemaining: 7 } },
    ] }], spawns: [{ enemyKey, time: 0, stateCarry: carry }] };
    const spec = buildBattleSpec(input);
    assert.equal(Object.hasOwn(spec, 'stateCarry'), allowed);
    assert.deepEqual(spec.spawns[0].stateCarry, allowed ? snapshot() : undefined);
    assert.deepEqual(spec.players[0].units[0].carryState, allowed ? { down: true, redeployRemaining: 0 } : { down: true });
    assert.deepEqual(spec.players[0].units[1].carryState, { hpPct: 0.5, sp: 3 });
    assert.deepEqual(input.spawns[0].stateCarry, carry, 'spec sanitation must not mutate its input');
    const opts = createBattleFromSpec(spec, DATA, { BattleClass: CaptureBattle }).opts;
    assert.equal(opts.stateCarry, allowed ? true : undefined);
    assert.deepEqual(opts.spawns[0].stateCarry, allowed ? snapshot() : undefined);
    if (allowed) {
      spec.spawns[0].stateCarry.hp = 5;
      assert.equal(opts.spawns[0].stateCarry.hp, 21, 'consumer is detached from the wire spec');
    }
  }
});

test('spec consumption independently rejects forged carry and invalid redeploy values', () => {
  const malformed = [null, [], { ...snapshot(), v: 2 }, { ...snapshot(), hp: -1 },
    { ...snapshot(), hp: 101 }, { ...snapshot(), maxHp: 0 }, { ...snapshot(), phases: [] },
    { ...snapshot(), phases: { phase: { values: { nested: {} }, buffs: [] } } }];
  for (const stateCarry of malformed) {
    const spec = { ...buildBattleSpec({ kind: 'unite', stateCarry: true }), spawns: [{ enemyKey, stateCarry }] };
    const opts = createBattleFromSpec(spec, DATA, { BattleClass: CaptureBattle }).opts;
    assert.equal(Object.hasOwn(opts.spawns[0], 'stateCarry'), false);
    assert.equal(Object.hasOwn(spec.spawns[0], 'stateCarry'), true, 'consumer leaves its input alone');
  }
  for (const redeployRemaining of [-1, NaN, Infinity, '5', null]) {
    const spec = buildBattleSpec({ kind: 'unite', stateCarry: true });
    spec.players = [{ playerId: 'p', units: [{ carryState: { down: true, redeployRemaining } }] }];
    const opts = createBattleFromSpec(spec, DATA, { BattleClass: CaptureBattle }).opts;
    assert.deepEqual(opts.players[0].units[0].carryState, { down: true });
  }
  const forged = buildBattleSpec({ kind: 'boss' });
  forged.stateCarry = true;
  forged.spawns = [{ enemyKey, stateCarry: snapshot() }];
  const opts = createBattleFromSpec(forged, DATA, { BattleClass: CaptureBattle }).opts;
  assert.equal(opts.stateCarry, undefined);
  assert.equal(Object.hasOwn(opts.spawns[0], 'stateCarry'), false);
});

test('normal results → plan → wave → actual battle preserve HP without advancing the frozen snapshot', t => {
  const { h, m, plan } = fixture(t);
  const raw = m.lastResults.get('p_0').leaked[0].stateCarry;
  assert.deepEqual(plan.leaked[0].stateCarry, snapshot());
  assert.notEqual(plan.leaked[0].stateCarry, raw);
  const phase = { values: { remaining: 7.25, changed: true }, buffs: [] };
  // Unknown phases may be transported but only the sim's registered adapter can restore them.
  plan.leaked[0].stateCarry.phases.phase = phase;
  const wave = buildUniteWave(m.gd, plan.leaked, plan.helpers.length, 60);
  assert.deepEqual(wave.spawns[0].stateCarry.phases.phase, phase);
  assert.notEqual(wave.spawns[0].stateCarry, plan.leaked[0].stateCarry);
  h.sched.t += 120000; // sample a later wall clock without firing unrelated prep/draft timers
  assert.equal(wave.spawns[0].stateCarry.phases.phase.values.remaining, 7.25);
  // Basic HP continuation uses a real Battle through the same spec path used by workers/replicas.
  plan.leaked[0].stateCarry.phases = {};
  const spec = buildBattleSpec(m._uniteOpts(plan, 60));
  const b = createBattleFromSpec(spec, m.ds, { quiet: true });
  assert.equal(b.stateCarry, true);
  while (b.time < spec.spawns[0].time + 0.1 && !b.finished) b.step();
  const enemy = b.enemies.find((u) => u.sourcePlayerId === 'p_0');
  assert.ok(enemy, 'the leaked enemy is spawned in the real Unite battle');
  assert.equal(enemy.hp, 21);
  assert.equal(raw.hp, 21);
});

test('relay keeps latest escaped snapshot and recovers original unspawned snapshot, frozen and per-entry', t => {
  const { m, plan } = fixture(t);
  const first = snapshot(11), second = snapshot(22), escaped = snapshot(7);
  first.phases.phase = { values: { left: 5.5 }, buffs: [] };
  second.phases.phase = { values: { left: 9.5 }, buffs: [] };
  const spawns = [
    { enemyKey, sourcePlayerId: 'p_0', time: 3, count: 1, stateCarry: first, mods: { hpMul: 2 } },
    { enemyKey, sourcePlayerId: 'p_0', time: 8, count: 1, stateCarry: second, mods: { hpMul: 3 } },
  ];
  const res = { time: 150, perPlayer: { p_1: result([leak(escaped)]) }, unspawned: [
    { enemyKey, sourcePlayerId: 'p_0', time: 8 }, { enemyKey, sourcePlayerId: 'p_0', time: 3 },
  ] };
  const relay = planUniteRelay(m, plan, res, spawns);
  assert.ok(relay);
  assert.deepEqual(relay.leaked.map((l) => l.stateCarry), [escaped, second, first]);
  assert.deepEqual(relay.leaked.slice(1).map((l) => l.mods), [{ hpMul: 3 }, { hpMul: 2 }]);
  assert.deepEqual(relay.helpers.map((p) => p.playerId), ['p_3', 'p_4']);
  assert.deepEqual(buildUniteWave(m.gd, relay.leaked, 2, 150).spawns.map((s) => s.stateCarry), [escaped, second, first]);
  relay.leaked[1].stateCarry.phases.phase.values.left = 0;
  assert.equal(second.phases.phase.values.left, 9.5, 'relay must detach, not mutate source snapshots');
  m.experimental = { ...m.experimental, stateCarry: false };
  const off = planUniteRelay(m, plan, res, spawns);
  assert.ok(off.leaked.every((l) => !Object.hasOwn(l, 'stateCarry')));
});

test('allied carry keeps official HP/SP/summon rules, adding only finite nonnegative down redeploy timers', t => {
  for (const enabled of [false, true]) {
    const { h, m, plan } = fixture(t, enabled);
    const helper = h.ps('p_1');
    const down = give(m, helper, 'chess_char_1_19_a', 'board', legalTileFor(m, helper, 'chess_char_1_19_a'));
    // Capture only the transport map; official PlayerState.battleInput consumes the same Map for real board pieces.
    let carried;
    const battleInput = helper.battleInput.bind(helper);
    helper.battleInput = (o) => { carried = o.carry; return battleInput(o); };
    helper.board.set('9,5', { kind: 'token', uid: 'summon', id: 'token-fixture' });
    m.lastResults.set('p_1', result([], [
      { uid: down.uid, alive: false, sp: 90, redeployRemaining: 4.5 },
      ...[0, -1, Infinity, NaN, '5', null].map((n, i) => ({ uid: `down${i}`, alive: false, redeployRemaining: n })),
      { uid: 'up', alive: true, hpPct: 0.3, sp: 8, skillActive: true, redeployRemaining: 6 },
      { uid: 'summon', alive: true, hpPct: 0.1, sp: 12, redeployRemaining: 7 },
    ]));
    const opts = uniteBattleOpts(m, plan, 60);
    assert.deepEqual(carried.get(down.uid), enabled ? { down: true, redeployRemaining: 4.5 } : { down: true });
    assert.deepEqual(carried.get('down0'), enabled ? { down: true, redeployRemaining: 0 } : { down: true });
    for (let i = 1; i <= 5; i++) assert.deepEqual(carried.get(`down${i}`), { down: true });
    assert.deepEqual(carried.get('up'), { hpPct: 0.3, sp: 8 });
    assert.deepEqual(carried.get('summon'), { sp: 12 });
    assert.deepEqual(opts.players.find((p) => p.playerId === helper.playerId).units.find((u) => u.uid === down.uid).carryState,
      enabled ? { down: true, redeployRemaining: 4.5 } : { down: true });
  }
});
