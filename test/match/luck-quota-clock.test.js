// In-process integration only: VirtualScheduler + FakeBattle, no worker, service or browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeMatch } from './harness.js';
import { EXPERIMENTAL_DEFAULTS } from '../../shared/experimental.js';
import { installServerPatch } from '../../mods/luck/runtime/src/server-patch.mjs';
import { bossElapsed, overtimeState } from '../../public/js/ui/matchStatus.js';

await installServerPatch(fileURLToPath(new URL('../../', import.meta.url)), { info() {}, warn() {} }, { record: false });

for (const hidden of [false, true]) {
  test(`Luck retunes actual ${hidden ? 'hidden' : 'boss'} quota runner, drain and HUD together, including paused changes`, () => {
    const h = makeMatch({ mode: 'solo', humans: 1, fake: true, instant: false, clients: false,
      clientCombat: true, timerScale: 1,
      experimental: { ...EXPERIMENTAL_DEFAULTS, luckConsole: true, bossQuota: true } }).start();
    const m = h.m;
    const speed = n => assert.equal(m.handle('p_0', { t: 'g.modSpeed', n }).ok, true);
    const elapsed = () => bossElapsed(m.publicView(), h.sched.now());
    const close = (value, expected) => assert.ok(Math.abs(value - expected) < 1 / 30 + 1e-8, `${value} != ${expected}`);
    try {
      h.toPrep(1);
      h.ps('p_0').lp = 100;
      m.round = hidden ? m.gd.hiddenRound : m.gd.bossRound;
      m.bossId = 'boss_1'; m.hiddenBossId = 'boss_9'; m._planBossWaves();
      if (hidden) m._openTeamLp(); // The real hidden round inherits the final assault's team pool.
      m.startFinalAssault(hidden);
      assert.ok(m.runner && m.fields.every(f => !f.cc), 'quota uses the server runner even in client-combat mode');
      speed(2);
      // A short fixture threshold exercises the real drain path without simulating 120 seconds.
      m.bossOvertimeStartReal = 2;
      const initialLp = m.teamLp;
      h.sched.advance(1000); close(elapsed(), 1);
      const before = elapsed(); speed(4); close(elapsed(), before);
      h.sched.advance(500); close(elapsed(), 2);
      assert.equal(m.overtimeApplied, 0);
      speed(8);
      const acceleratedAt = h.sched.now();
      assert.equal(h.run(() => m.runner.time >= 6, { maxSteps: 200 }), true);
      assert.ok(h.sched.now() - acceleratedAt < 350, 'one game second takes about 250 ms at raw speed 8');
      assert.ok(elapsed() >= 3 && elapsed() < 3.2, 'allow the runner pump cadence, not a wall-time fake');
      assert.equal(m.overtimeApplied, 1);
      assert.equal(m.teamLp, initialLp - 1);
      assert.equal(overtimeState(m.publicView(), h.sched.now()).lost, 1);
      assert.equal(m.setPause(h.ps('p_0'), true).ok, true);
      const frozen = elapsed(); h.sched.advance(1000); speed(2);
      close(elapsed(), frozen); assert.equal(m.teamLp, initialLp - 1);
      m._resume(); h.sched.advance(1000); close(elapsed(), frozen + 1);
      assert.equal(m.teamLp, initialLp - 2);
      assert.equal(overtimeState(m.publicView(), h.sched.now()).lost, 2);
      m.bossPool.damage('p_0', m.bossPool.quota.share, m.runner.time);
      m._recordBossQuota(hidden);
      const live = m.publicView().bossQuota.players[0].time;
      close(live, elapsed());
      assert.equal(live, m.bossQuotaRounds[0].players[0].time);
      assert.deepEqual(h.sched.errors, []);
      assert.deepEqual(h.logs.error, []);
    } finally { m.dispose(); }
  });
}
