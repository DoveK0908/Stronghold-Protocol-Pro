// 无限休整期 counts down normally but waits at zero until every living player is ready.
// Ordinary rooms retain forced timeout readiness; single-human defaults are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';

const untimed = extra => ({ revivalEnabled: false, disableSharedPool: false, prepUnlimited: true, ...extra });
const timed = extra => ({ revivalEnabled: false, disableSharedPool: false, ...extra });

for (const humans of [2, 3]) {
  test(`${humans} humans: the prep waits for every Ready, not for the clock`, t => {
    const h = makeMatch({ humans, experimental: untimed(), seed: 91, fake: true }).start();
    const m = h.m; t.after(() => m.dispose());
    h.runToPhase('PREP', 1);
    const deadline = m.deadline;
    assert.equal(deadline - m.sched.now(), m.gd.prepTime(1) * 1000);
    assert.equal(m.publicView().deadline, deadline, 'the client sees the normal countdown');
    h.sched.advance(deadline - h.sched.now() + 60_000);
    assert.equal(m.deadline, deadline, 'expired countdown remains at zero on the HUD');
    assert.ok(m.alivePlayers().every(ps => !ps.ready), 'expiry must not force readiness');
    m.prepDeadline(); // explicit expiry paths must not bypass the option either
    h.flushAll();
    assert.equal(m.phase, 'PREP');
    assert.equal(m.round, 1);
    // every player but the last one ready: still waiting
    const alive = m.alivePlayers();
    for (const ps of alive.slice(0, -1)) assert.equal(ps.setReady(true).ok, true);
    h.flushAll();
    assert.equal(m.phase, 'PREP', 'one player still deciding keeps the prep open');
    const last = alive.at(-1);
    assert.equal(last.setReady(true).ok, true);
    h.flushAll();
    assert.notEqual(m.phase, 'PREP', 'all ready ends the prep');
  });
}

test('a room without the option still times its prep', t => {
  const h = makeMatch({ humans: 2, experimental: timed(), seed: 91, fake: true }).start();
  const m = h.m; t.after(() => m.dispose());
  h.runToPhase('PREP', 1);
  assert.ok(m.deadline > 0, 'the official countdown is there');
  assert.equal(m.deadline - m.sched.now(), m.gd.prepTime(1) * 1000, 'the round prepTime');
});

for (const mode of ['solo', 'coop']) {
  for (const unlimited of [false, true]) {
    test(`${mode} single human: countdown changes only with the option enabled=${unlimited}`, t => {
      const h = makeMatch({ mode, humans: 1, experimental: unlimited ? untimed() : timed(), fake: true }).start();
      const m = h.m; t.after(() => m.dispose());
      h.toPrep(1); // single-human briefing/draft deliberately have no timeout
      if (unlimited && m.gd.prepTime(1) > 0) {
        assert.equal(m.deadline - m.sched.now(), m.gd.prepTime(1) * 1000);
        h.sched.advance(m.deadline - m.sched.now() + 60_000);
      } else assert.equal(m.deadline, 0, 'solo data has no prep duration; do not invent one');
      assert.equal(m.phase, 'PREP');
      assert.equal(m.alivePlayers()[0].ready, false);
      assert.equal(m.alivePlayers()[0].setReady(true).ok, true);
      h.flushAll();
      assert.notEqual(m.phase, 'PREP');
    });
  }
}

test('unlimited expiry cannot auto-pick, dispose overflow or force Ready', t => {
  const h = makeMatch({ humans: 2, experimental: untimed(), fake: true }).start();
  const m = h.m; t.after(() => m.dispose());
  h.runToPhase('PREP', 1);
  m.autoPickPersonalChoice = () => assert.fail('expiry auto-picked a choice');
  for (const ps of m.alivePlayers()) {
    ps.resolveTemp = () => assert.fail('expiry disposed overflow');
    ps.setReady = () => assert.fail('expiry forced Ready');
  }
  h.sched.advance(m.deadline - m.sched.now() + 60_000);
  assert.equal(m.phase, 'PREP');
  assert.ok(m.alivePlayers().every(ps => !ps.ready));
});

test('ordinary multiplayer expiry still forces Ready and ends preparation', t => {
  const h = makeMatch({ humans: 2, experimental: timed(), fake: true }).start();
  const m = h.m; t.after(() => m.dispose());
  h.runToPhase('PREP', 1);
  const deadline = m.deadline;
  h.sched.advance(deadline - m.sched.now());
  h.flushAll();
  assert.notEqual(m.phase, 'PREP');
});

test('the option is opt-in on the wire: it only rides when true, and the key/equality see it', async () => {
  const { experimentalOptions, experimentalKey, sameExperimental, isExperimental } = await import('../../shared/experimental.js');
  const base = { revivalEnabled: false, disableSharedPool: false };
  assert.deepEqual(experimentalOptions(base), base, 'an ordinary room keeps the two-flag shape');
  assert.deepEqual(experimentalOptions({ ...base, prepUnlimited: false }), base);
  assert.deepEqual(experimentalOptions({ ...base, prepUnlimited: true }), { ...base, prepUnlimited: true });
  assert.notEqual(experimentalKey({ ...base, prepUnlimited: true }), experimentalKey(base));
  assert.equal(sameExperimental({ ...base, prepUnlimited: true }, { ...base, prepUnlimited: true }), true);
  assert.equal(sameExperimental({ ...base, prepUnlimited: true }, base), false);
  assert.equal(isExperimental({ ...base, prepUnlimited: 'yes' }), false);
});
