// 无限休整期 (玩法#05, experimental.prepUnlimited): a co-op prep has no countdown and combat starts only once every
// living player is ready. Ordinary rooms keep the timed prep (asserted here too, so the option cannot leak).
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
    assert.equal(m.deadline, 0, 'no published deadline');
    assert.equal(m.publicView().deadline, 0, 'and the client sees none');
    // the clock would long have run out
    h.flushAll(); h.flushAll(); h.flushAll();
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
