// 项目 4 (2026-10-22): browser-authoritative boss fields fill the settlement's Boss 关伤害 ledger from the
// accepted result (perPlayer[].damageDealt / unitStats); server-combat fields keep streaming their own rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';

const result = {
  time: 42,
  perPlayer: {
    p_0: { damageDealt: 1000, healingDone: 30, unitStats: [
      { uid: 1, defId: 'chess_a', kind: 'op', dmg: 800, heal: 0 },
      { uid: 2, defId: 'chess_b', kind: 'op', dmg: 200, heal: 30 },
      { uid: 9, defId: 'token_x', kind: 'token', dmg: 500, heal: 0 },
    ] },
    p_1: { damageDealt: 600, healingDone: 0, unitStats: [{ uid: 3, defId: 'chess_c', kind: 'op', dmg: 600, heal: 0 }] },
  },
};

test('a client boss result fills the frozen ledger (totals, operators, otherDamage)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 2, seed: 7, fake: true, clientCombat: true }).start();
  try {
    h.drive(() => h.m.round === 14);
    h.m._beginDamage('boss');
    const f = { fieldId: 'b:1', kind: 'boss', players: ['p_0', 'p_1'] };
    assert.equal(h.m._damageFromResult(f, result), true);
    h.m.damageBoard.freeze();
    const led = h.m.damageBoard.bossRounds();
    assert.equal(led.boss.round, 14);
    const [a, b] = led.boss.owners;
    assert.equal(a.playerId, 'p_0');
    assert.equal(a.total, 1000);
    assert.equal(a.otherDamage, 0, 'operator rows cover the reported total');
    assert.deepEqual(a.operators.map((o) => [o.defId, o.damage]), [['chess_a', 800], ['chess_b', 200]]);
    assert.equal(a.healing, 30);
    assert.deepEqual(b.operators.map((o) => o.defId), ['chess_c']);
    assert.equal(b.total, 600);
  } finally { h.stop?.(); }
});

test('the same field is folded once, and only for the boss/hidden scopes', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 2, seed: 7, fake: true, clientCombat: true }).start();
  try {
    h.drive(() => h.m.round === 14);
    h.m._beginDamage('boss');
    const f = { fieldId: 'b:1', kind: 'boss', players: ['p_0', 'p_1'] };
    assert.equal(h.m._damageFromResult(f, result), true);
    const twice = { ...result, time: 99, perPlayer: { p_0: { damageDealt: 9e9 }, p_1: { damageDealt: 9e9 } } };
    assert.equal(h.m._damageFromResult(f, twice), false, 'one accepted result per field');
    const normal = { fieldId: 'n:1', kind: 'normal', players: ['p_0'] };
    assert.equal(h.m._damageFromResult(normal, result), false, 'normal rounds keep the server path');
  } finally { h.stop?.(); }
});
