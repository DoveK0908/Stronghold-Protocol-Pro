import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BossQuota } from '../../shared/bossQuota.js';
import { SharedBossPool, CreditPool } from '../../server/match/finalAssault.js';
import { LocalBossPool, ReplayBossPool, buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const config = () => ({ players: ['p1', 'p2', 'p3'], unlockAt: 240 });
const factories = {
  shared: (hp, quota) => new SharedBossPool(hp, { quota }),
  local: (hp, quota) => new LocalBossPool(hp, hp, quota),
  replay: (hp, quota) => new ReplayBossPool(hp, hp, quota),
};

for (const [name, make] of Object.entries(factories)) {
  test(`${name}: freeze IDs, clamp overflow, retain first time and never bank damage`, () => {
    const quota = config(), p = make(900, quota);
    quota.players.push('intruder');
    assert.equal(p.damage('intruder', 900, 1), 0);
    assert.equal(p.damage(null, 900, 1), 0);
    assert.equal(p.damage('p1', 100, 2), 100);
    assert.equal(p.damage('p1', 1000, 3.5), 200);
    assert.equal(p.damage('p1', 1000, 4), 0);
    assert.equal(p.hp, 600);
    assert.deepEqual(p.quota.snapshot(), {
      players: ['p1', 'p2', 'p3'], unlockAt: 240, share: 300,
      completed: [{ playerId: 'p1', time: 3.5 }, { playerId: 'p2', time: null }, { playerId: 'p3', time: null }],
      perPlayer: [{ playerId: 'p1', damage: 300 }, { playerId: 'p2', damage: 0 }, { playerId: 'p3', damage: 0 }],
    });
    assert.equal(p.damage('p1', 1, 240), 1, 'unlock boundary, not any previously rejected damage');
    assert.equal(p.hp, 599);
    assert.equal(p.damage('intruder', 999, 241), 599, 'limit released for everyone');
    assert.equal(p.hp, 0);
    assert.equal(p.quota.completed.get('p1'), 3.5);
  });

  test(`${name}: three fractional shares empty the pool without gifting a sub-1-HP share`, () => {
    for (const hp of [1, 2, 10, 1000, 40000, 1800000]) {
      const p = make(hp, config());
      for (const [i, pid] of config().players.entries()) {
        const dealt = p.damage(pid, hp, i);
        assert.ok(Math.abs(dealt - hp / 3) <= Number.EPSILON * hp * 16);
        if (i < 2) assert.ok(p.hp > 0, 'other players still own their share');
      }
      assert.equal(p.hp, 0);
      assert.ok(p.quota.snapshot().completed.every(c => c.time !== null));
    }
  });

  test(`${name}: option absent retains legacy sub-1-HP final-hit cleanup`, () => {
    const p = make(1000, null);
    assert.equal(p.quota, undefined);
    p.damage('p1', 998.7);
    assert.ok(Math.abs(p.damage('p2', 0.5) - 1.3) < 1e-9);
    assert.equal(p.hp, 0);
  });
}

test('quota ignores invalid and healing inputs, missing time cannot unlock, snapshots are isolated', () => {
  const q = new BossQuota(900, config());
  for (const amount of [0, -100, NaN, Infinity]) assert.equal(q.damage('p1', amount, 1, 900), 0);
  assert.equal(q.damage('unknown', 900, undefined, 900), 0);
  assert.equal(q.damage('p1', 300, 250, 900), 300);
  assert.equal(q.completed.get('p1'), 250, 'first quota achievement may occur in overtime');
  const snapshot = q.snapshot();
  snapshot.players.push('other'); snapshot.completed[0].time = 999;
  assert.equal(q.completed.get('p1'), 250);
  assert.equal(q.players.length, 3);
});

test('CreditPool forwards quota identity and game time without banking capped hits', () => {
  const pool = new SharedBossPool(900, { quota: config() });
  const credited = [];
  const wrapper = new CreditPool(pool, { onCredit: (id, n) => credited.push([id, n]) });
  assert.equal(wrapper.quota, pool.quota);
  assert.equal(wrapper.damage('p1', 500, 7), 300);
  assert.equal(wrapper.damage('p1', 100, 8), 0);
  assert.equal(wrapper.damage('p1', 1, 240), 1);
  assert.equal(pool.quota.completed.get('p1'), 7);
  assert.deepEqual(credited, [['p1', 300], ['p1', 1]]);
});

test('BattleSpec preserves quota without mutating its input; local construction configures it', () => {
  const quota = config();
  const spec = buildBattleSpec({ kind: 'boss', boss: { poolHp: 900, poolMax: 900, quota } });
  assert.deepEqual(spec.boss.quota, quota);
  quota.players.push('late');
  class StubBattle { constructor(o) { Object.assign(this, o); } }
  const b = createBattleFromSpec(spec, {}, { BattleClass: StubBattle });
  assert.ok(b.sharedBoss.quota instanceof BossQuota);
  assert.deepEqual(b.sharedBoss.quota.players, ['p1', 'p2', 'p3']);
  assert.equal(b.sharedBoss.damage('p1', 500, 12), 300);
  assert.equal(b.sharedBoss.quota.completed.get('p1'), 12);
  const off = buildBattleSpec({ kind: 'boss', boss: { poolHp: 900, poolMax: 900 } });
  assert.deepEqual(off.boss, { poolHp: 900, poolMax: 900 });
});

function settlementFixture(quota) {
  const pool = new SharedBossPool(900, { quota });
  const h = makeBattle({ kind: 'boss', content: 'none', sharedBoss: pool, autoFinish: false,
    units: [{ uid: 'attacker', chessId: 'quota_op', row: 10, col: 5 }],
    defs: { chess: { quota_op: chessRec({ id: 'quota_op', skill: null }) },
      enemies: { quota_enemy: enemyRec({ key: 'quota_enemy', hp: 900, speed: 0 }) } } });
  h.step();
  const target = h.spawn('quota_enemy', { pos: [2, 10] });
  target.isBoss = true; target.bossPool = pool;
  const source = h.unit('attacker');
  return { b: h.b, pool, source, target };
}

for (const kind of ['damage', 'hpLoss']) test(`${kind}: full raw statistics but actual HP effects and return values`, () => {
  const { b, pool, source, target } = settlementFixture(config());
  const hpChanges = [], settled = [];
  b.on('hpChanged', c => { if (c.target === target) hpChanges.push(c.delta); });
  b.on('damageApplied', c => { if (c.target === target) settled.push(c.hpRemoved); });
  const hit = amount => kind === 'hpLoss'
    ? b.dealHPLose({ source, target, amount, type: 'true' })
    : b.dealDamage({ source, target, amount, type: 'true' });
  b.time = 12;
  assert.equal(hit(500), 300);
  b.time = 13;
  assert.equal(hit(700), 0);
  assert.equal(pool.hp, 600);
  assert.equal(pool.byPlayer.get('p1'), 300);
  assert.equal(pool.quota.completed.get('p1'), 12);
  assert.equal(source.stats.dmg, 1200);
  assert.equal(b._pp('p1').damageDealt, 1200);
  assert.equal(b._pp('p1').bossDamage, 1200);
  assert.equal(target.stats.taken, 300);
  assert.deepEqual(hpChanges, [-300]);
  if (kind === 'damage') assert.deepEqual(settled, [300, 0]);
  b.time = 240;
  assert.equal(hit(1), 1);
  assert.equal(pool.hp, 599);
  assert.equal(source.stats.dmg, 1201);
  assert.equal(b.errors.length, 0);
});

test('settlement with option off keeps statistics capped to actual pool damage', () => {
  const { b, source, target } = settlementFixture(null);
  assert.equal(b.dealDamage({ source, target, amount: 1200, type: 'true' }), 900);
  assert.equal(source.stats.dmg, 900);
  assert.equal(b._pp('p1').damageDealt, 900);
  assert.equal(b._pp('p1').bossDamage, 900);
});

test('ReplayBossPool reproduces authoritative hits with external field HP entries', () => {
  const shared = new SharedBossPool(900, { quota: config() });
  const replay = new ReplayBossPool(900, 900, config());
  assert.equal(shared.damage('p3', 200, 1), 200);
  assert.ok(replay.feed(0, 1, [[1, shared.hp]], null));
  replay.enter(1);
  for (const [pid, amount, time] of [['p1', 500, 2], ['p1', 100, 3], ['p2', 299.5, 4], ['p2', 10, 5], ['p1', 1000, 240]]) {
    assert.equal(replay.damage(pid, amount, time), shared.damage(pid, amount, time));
    assert.equal(replay.hp, shared.hp);
  }
  assert.equal(replay.hp, 0);
  assert.equal(replay.quota.completed.get('p1'), shared.quota.completed.get('p1'));
});
