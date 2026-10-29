// Safe pure Node UI/server contracts: no subprocess, browser, service or real scheduler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { EXPERIMENTAL_DEFAULTS } from '../../shared/experimental.js';
import { bossElapsed, bossRemaining, overtimeState } from '../../public/js/ui/matchStatus.js';
import { makeMatch } from '../match/harness.js';

globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
const { BossQuotaTime } = await import('../../public/js/ui/teamPanel.js');
const text = value => Array.isArray(value) ? value.map(text).join('')
  : value && typeof value === 'object' ? text(value.props?.children) : value == null ? '' : String(value);
const pub = (overrides = {}) => ({ phase: PHASE.FINAL_ASSAULT, experimental: { bossQuota: true },
  bossQuota: { players: [{ playerId: 'own', time: null }, { playerId: 'ally', time: 12.345 }] }, ...overrides });

test('live quota badge reads each authoritative player time, including self and spectator views', () => {
  const view = pub();
  assert.equal(BossQuotaTime({ pub: view, playerId: 'own' }), null);
  const ally = BossQuotaTime({ pub: view, playerId: 'ally' });
  assert.equal(ally.props['data-boss-quota-time'], 12.345);
  assert.equal(text(ally), '配额完成 12.35 秒');
  view.bossQuota.players[0].time = 10;
  assert.equal(text(BossQuotaTime({ pub: view, playerId: 'own' })), '配额完成 10.00 秒');
  assert.equal(text(BossQuotaTime({ pub: { ...view, spectator: true }, playerId: 'ally' })), text(ally));
  assert.equal(BossQuotaTime({ pub: view, playerId: 'absent' }), null);
  for (const time of [null, undefined, NaN, Infinity, -1]) {
    assert.equal(BossQuotaTime({ pub: pub({ bossQuota: { players: [{ playerId: 'own', time }] } }), playerId: 'own' }), null);
  }
  assert.equal(text(BossQuotaTime({ pub: pub({ bossQuota: { players: [{ playerId: 'own', time: 0 }] } }), playerId: 'own' })), '配额完成 0.00 秒');
});

test('quota badge disappears when disabled, outside boss combat, or hidden round starts fresh', () => {
  for (const view of [pub({ experimental: {} }), pub({ phase: PHASE.PREP }), pub({ bossQuota: undefined }),
    pub({ phase: PHASE.HIDDEN_CORE, bossQuota: { players: [{ playerId: 'ally', time: null }] } })]) {
    assert.equal(BossQuotaTime({ pub: view, playerId: 'ally' }), null);
  }
});

test('boss clock countdown and overtime use normalized accelerated game seconds and pause freezes', () => {
  const view = pub({ bossClock: { elapsed: 100, at: 1000, speed: 2, overtimeAfter: 120, overtimeApplied: 0 }, deadline: 999999 });
  assert.equal(bossElapsed(view, 6000), 110);
  assert.equal(bossRemaining(view, 6000), 10);
  assert.deepEqual(overtimeState(view, 6000), { state: 'pending', secs: 10 });
  assert.deepEqual(overtimeState(view, 11000), { state: 'drain', secs: 0, lost: 0, perSec: 1 });
  view.bossClock = { elapsed: 122, at: 11000, speed: 2, overtimeAfter: 120, overtimeApplied: 2 };
  assert.deepEqual(overtimeState(view, 12500), { state: 'drain', secs: 5, lost: 2, perSec: 1 });
  const paused = { ...view, paused: true };
  assert.equal(bossElapsed(paused, 999999), 122);
  assert.deepEqual(overtimeState(paused, 999999), { state: 'drain', secs: 2, lost: 2, perSec: 1 });
  assert.equal(bossElapsed(view, 10000), 122, 'a sample never runs backward before its authoritative timestamp');
  assert.equal(bossRemaining({ phase: PHASE.PREP }, 1), null);
  const baseline = pub({ bossClock: { elapsed: 100, at: 1000, speed: 1, overtimeAfter: 150, overtimeApplied: 0 } });
  assert.equal(bossElapsed(baseline, 6000), 105, 'baseline 2 raw gt/s is one normalized game second per wall second');
  assert.equal(overtimeState(baseline, 1000), null, 'no early warning');
  assert.deepEqual(overtimeState(baseline, 1000, { levelSeconds: 90 }), { state: 'pending', secs: 50 }, 'configured countdown can end before the warning window');
});

test('legacy clients without bossClock retain overtimeAt fallback', () => {
  const view = pub({ overtimeAt: 100000, deadline: 70000 });
  assert.equal(bossElapsed(view, 99000), null);
  assert.deepEqual(overtimeState(view, 99000), { state: 'pending', secs: 1 });
  assert.deepEqual(overtimeState(view, 102000), { state: 'drain', secs: 2, lost: 2, perSec: 1 });
});

function matchFixture({ quota = true, clientCombat = false, timerScale = 1 } = {}) {
  const h = makeMatch({ mode: 'solo', humans: 1, fake: true, instant: false, clients: false,
    clientCombat, timerScale, experimental: { ...EXPERIMENTAL_DEFAULTS, ...(quota ? { bossQuota: true } : {}) } }).start();
  h.toPrep(1);
  h.m.round = h.m.gd.bossRound;
  h.m.bossId = 'boss_1';
  h.m.hiddenBossId = 'boss_9';
  h.m._planBossWaves();
  h.m.startFinalAssault(false);
  return h;
}

for (const timerScale of [1, 0.05]) {
  test(`live view and saved record share normalized units (timerScale=${timerScale})`, () => {
    const h = matchFixture({ timerScale }); const m = h.m;
    try {
      const scale = m.gd.combatTimeScale;
      const initial = m.publicView();
      assert.deepEqual(initial.bossQuota, { players: [{ playerId: 'p_0', time: null }] });
      m.bossPool.damage('p_0', m.bossPool.quota.share, 10 + 1 / 30);
      m.runner.ticks = 300;
      const live = m.publicView();
      m._recordBossQuota(false);
      assert.equal(live.bossQuota.players[0].time, m.bossQuotaRounds[0].players[0].time);
      assert.equal(live.bossQuota.players[0].time, Math.round((10 + 1 / 30) * 30) / 30 / scale);
      assert.deepEqual(live.bossClock, { elapsed: 10 / scale, at: h.sched.now(), speed: m.gameSpeed / scale,
        overtimeAfter: m.bossOvertimeStartReal, overtimeApplied: 0 });
      assert.equal(m.setPause(h.ps('p_0'), true).ok, true);
      const paused = m.publicView();
      assert.equal(bossElapsed(paused, h.sched.now() + 100000), paused.bossClock.elapsed);
      m._resume();
      m.round = m.gd.hiddenRound;
      m.startFinalAssault(true);
      assert.deepEqual(m.publicView().bossQuota, initial.bossQuota, 'hidden round never reuses the prior completion');
    } finally { m.dispose(); }
  });
}

test('quota off omits its live extension and client-authoritative boss clock uses server scheduler', () => {
  const h = matchFixture({ quota: false, clientCombat: true }); const m = h.m;
  try {
    assert.equal('bossQuota' in m.publicView(), false);
    const initial = m.publicView();
    assert.ok(initial.bossClock);
    m._bossStartAt = m._clockNow() - 10000;
    const later = m.publicView();
    assert.equal(later.bossClock.elapsed, 10 * m.gameSpeed / m.gd.combatTimeScale);
    m.phase = PHASE.PREP;
    assert.equal('bossClock' in m.publicView(), false);
  } finally { m.dispose(); }
});
