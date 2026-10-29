import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { EXPERIMENTAL_DEFAULTS } from '../../shared/experimental.js';
import { CombatEngine } from '../../server/match/combat/engine.js';
import { WorkerFieldRunner } from '../../server/match/combat/runner.js';
import { FakeBattle } from './fakeBattle.js';
import { normalizeRecord, compactRecord, recordToResult } from '../../public/js/ui/stats.js';

function fixture(hidden = false, opts = {}) {
  const h = makeMatch({ humans: 3, bots: 1, instant: false, fake: true, clientCombat: true,
    clients: false, experimental: { ...EXPERIMENTAL_DEFAULTS, bossQuota: true, bossHpPercent: 150 }, ...opts }).start();
  h.toPrep(1);
  const m = h.m;
  m.round = hidden ? m.gd.hiddenRound : m.gd.bossRound;
  m.bossId = 'boss_1';
  m.hiddenBossId = 'boss_9';
  m._planBossWaves();
  m.startFinalAssault(hidden);
  return h;
}

for (const hidden of [false, true]) {
  test(`quota ${hidden ? 'hidden' : 'boss'}: authoritative clock, frozen participants, stats ledger and resync`, () => {
    const h = fixture(hidden);
    const m = h.m;
    try {
      assert.ok(m.runner);
      assert.ok(m.fields.every(f => !f.cc && f.battle), 'quota never trusts separate browser pool reports');
      assert.deepEqual(m.bossPool.quota.players, ['p_0', 'p_1', 'p_2', 'ai_0']);
      assert.equal(m.bossPool.quota.share, m.bossPool.maxHp / 4);
      assert.equal(m._damageServerOwned, true);
      assert.ok(m._damagePacket().owners.length > 0, 'client-mode match publishes authoritative quota DPS');
      assert.notEqual(m._damagePacket().available, false);
      const q = m.bossPool.quota;
      const nominal = m.bossOvertimeStartReal * m.gd.combatTimeScale;
      const unlock = (m.bossOvertimeStartReal + 1) * m.gd.combatTimeScale;
      assert.equal(q.unlockAt, unlock);
      assert.equal(m.gd.bossOvertimeDue(nominal, m.bossOvertimeStartReal), 0);
      assert.ok(m.gd.bossOvertimeDue(unlock, m.bossOvertimeStartReal) > 0);
      assert.equal(m.bossPool.damage('p_0', m.bossPool.maxHp, 1), q.share);
      assert.equal(m.bossPool.damage('p_0', m.bossPool.maxHp, nominal), 0);
      assert.equal(m.bossPool.damage('p_0', 10, unlock - 1 / 30), 0);
      assert.equal(m.bossPool.damage('p_0', 10, unlock), 10);
      assert.deepEqual(q.players, ['p_0', 'p_1', 'p_2', 'ai_0']);
      // A reload loses the old watch assignment; reconstruct the own server field, not a client b.start.
      m.watchers.delete('p_0'); h.sent.length = 0;
      m._resync(h.ps('p_0'));
      assert.ok(m.watchers.get('p_0'));
      assert.ok(h.sent.some(([id, msg]) => id === 'p_0' && msg.t === 'm.field'));
      assert.ok(h.sent.some(([id, msg]) => id === 'p_0' && msg.t === 'b.snap'));
      assert.equal(h.sent.some(([id, msg]) => id === 'p_0' && msg.t === 'b.start'), false);
      // A new spectator gets a followed field and subsequent streamed updates too.
      const spectator = { playerId: 's_new', spectator: true, alive: false, connected: true };
      m.spectators.set(spectator.playerId, spectator);
      h.sent.length = 0;
      m._resync(spectator);
      assert.ok(m.watchers.get(spectator.playerId));
      assert.ok(h.sent.some(([id, msg]) => id === spectator.playerId && msg.t === 'm.field'));
    } finally { m.dispose(); }
  });
}

test('quota rankings: ties, unfinished players, two independent rounds and local-record roundtrip', () => {
  const h = fixture(); const m = h.m;
  try {
    const pool = m.bossPool, share = pool.quota.share;
    pool.damage('p_2', share, 12);
    pool.damage('p_1', share, 10);
    pool.damage('p_0', share, 10);
    m._recordBossQuota(false);
    const final = m.bossQuotaRounds[0];
    assert.deepEqual(final.players.map(p => [p.playerId, p.rank, p.time]), [
      ['p_0', 1, 10 / m.gd.combatTimeScale], ['p_1', 1, 10 / m.gd.combatTimeScale], ['p_2', 3, 12 / m.gd.combatTimeScale], ['ai_0', null, null],
    ]);
    // Hidden starts fresh with the final's participant count, not its used counters/timestamps.
    m.round = m.gd.hiddenRound;
    m.startFinalAssault(true);
    assert.ok([...m.bossPool.quota.completed.values()].every(time => time === null));
    m.bossPool.damage('p_1', m.bossPool.quota.share, 3);
    m._recordBossQuota(true);
    assert.equal(m.bossQuotaRounds.length, 2);
    assert.deepEqual(m.bossQuotaRounds[0], final);
    const raw = { id: 'quota-record', at: 1, playerId: 'p_0', bossQuota: m.bossQuotaRounds, players: [{ playerId: 'p_0', name: 'P0' }] };
    const normalized = normalizeRecord(raw);
    assert.deepEqual(normalized.bossQuota, raw.bossQuota);
    assert.deepEqual(compactRecord(normalized).bossQuota, raw.bossQuota);
    assert.deepEqual(recordToResult(normalized).bossQuota, raw.bossQuota);
    assert.equal('bossQuota' in normalizeRecord({ id: 'legacy', players: raw.players }), false);
  } finally { m.dispose(); }
});

test('worker DTO preserves completion times and mirror never caps already accepted overtime damage again', () => {
  const h = fixture(); const m = h.m;
  const q = m.bossPool.quota;
  const engine = new CombatEngine({ specs: [{ fieldId: 'quota-worker', kind: 'boss', players: [{ playerId: 'p_0' }], spawns: [] }],
    boss: { maxHp: m.bossPool.maxHp, hp: m.bossPool.hp, teamLp: 100, quota: q.snapshot() } },
  { BattleClass: FakeBattle });
  const mirror = new WorkerFieldRunner(m, [], { onDone() {} });
  try {
    engine.pool.damage('p_0', q.share * 2, 4);
    engine.pool.damage('p_0', q.share / 2, q.unlockAt);
    const out = engine.state();
    assert.equal(out.boss.quota.completed[0].time, 4);
    mirror._apply({ ...out, fields: [], frames: [], ext: [], damageFrames: [] });
    assert.equal(m.bossPool.hp, engine.pool.hp);
    assert.equal(m.bossPool.byPlayer.get('p_0'), q.share * 1.5);
    assert.equal(m.bossPool.quota.perPlayer.get('p_0'), q.share * 1.5);
    assert.equal(m.bossPool.quota.completed.get('p_0'), 4);
    assert.equal(h.ps('p_0').stats.bossDamage, q.share * 1.5);
    assert.equal(engine.state().effects.length, 0, 'accepted effects are consumed once');
  } finally { engine.dispose(); m.dispose(); }
});

test('quota off: client authority and absent result extension are unchanged', () => {
  const h = fixture(false, { experimental: { ...EXPERIMENTAL_DEFAULTS } });
  try {
    assert.equal(h.m.bossPool.quota, undefined);
    assert.ok(h.m.fields.every(f => f.cc));
    assert.equal(h.m.bossQuotaRounds, undefined);
    assert.equal(h.m._damagePacket().available, false);
  } finally { h.m.dispose(); }
});
