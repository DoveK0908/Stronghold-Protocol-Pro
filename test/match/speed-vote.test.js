// 局内投票开启二倍速 (server/match/match/speedVote.js, the owner's rule of 2026-10-23): the connected humans of a live
// match agree, unanimously, to run the match at twice the speed. The boost lands on the *next* battle (startCombat
// doubles gameSpeed once), never on the battle in flight; a rejected / timed-out vote changes nothing and blocks another
// for the rest of the round. Any connected human then calls it off with one click (g.speedOff, owner's rule of
// 2026-10-24), again from the next battle, and turning it on again needs a fresh vote. The vote is transient, the boost
// is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, ERR } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { SPEED_VOTE_MS, SPEED_BOOST, speedNeed } from '../../server/match/match/speedVote.js';
import { canSnapshot, snapshotMatch, restoreMatch, MATCH_FIELDS } from '../../server/match/snapshot.js';
import { createRngFromState } from '../../server/sim/rng.js';
import { makeMatch } from './harness.js';

const notices = (h, kind) => h.bc.filter((x) => x.t === 'm.notice' && x.kind === kind);
const ballot = (m, id, agree, voteId = m.speedVote.id) => m.handle(id, { t: 'g.speedBallot', voteId, agree });

/** A coop match of `n` humans (`p_0` … `p_{n-1}`) sitting in PREP of round 1. */
function prep(n = 3, o = {}) {
  const h = makeMatch({ mode: 'coop', humans: n, seed: 65, fake: true, script: () => ({ duration: 4 }), ...o }).start();
  h.runToPhase(PHASE.PREP, 1);
  return { h, m: h.m };
}

test('protocol and thresholds: g.speedVote takes nothing, g.speedBallot { voteId, agree }; everybody must agree', () => {
  assert.equal(validateC2S({ t: 'g.speedVote' }), null);
  assert.equal(validateC2S({ t: 'g.speedOff' }), null);
  assert.equal(validateC2S({ t: 'g.speedBallot', voteId: 1, agree: false }), null);
  for (const msg of [{ t: 'g.speedBallot', voteId: 0, agree: true },
    { t: 'g.speedBallot', voteId: 1 }, { t: 'g.speedBallot', voteId: 1, agree: 1 }]) {
    assert.notEqual(validateC2S(msg), null, JSON.stringify(msg));
  }
  assert.deepEqual([1, 2, 3, 5].map(speedNeed), [1, 2, 3, 5]);
  assert.equal(SPEED_VOTE_MS, 30_000);
  assert.equal(SPEED_BOOST, 2);
  for (const k of ['speedVote', '_speedVoteSeq', '_speedFailedRound', '_speedVoteAt']) assert.ok(MATCH_FIELDS.transient.includes(k), k);
  for (const k of ['speedBoost', 'speedBoostPending', 'speedBoostOffPending']) assert.ok(MATCH_FIELDS.saved.includes(k), k);
});

test('a unanimous vote: the next battle runs at 2×, the battle after it keeps it', (t) => {
  const { h, m } = prep(3);
  t.after(() => m.dispose());
  const base = m.gameSpeed;
  assert.equal(m.publicView().speedBoost.on, false);
  assert.deepEqual(m.handle('p_0', { t: 'g.speedVote' }), { ok: true });
  const vote = m.publicView().speedVote;
  assert.deepEqual(vote.voters, ['p_0', 'p_1', 'p_2']);
  assert.equal(vote.need, 3);
  assert.deepEqual(vote.agreed, ['p_0'], 'the proposer counts as yes');
  assert.equal(vote.proposerId, 'p_0');
  // one yes is not enough under the unanimous rule
  assert.deepEqual(ballot(m, 'p_1', true), { ok: true });
  assert.equal(m.speedVote.agreed.size, 2);
  assert.equal(m.speedBoostPending, false, 'still open, nothing promised yet');
  // the last yes passes it: the boost is owed to the next battle, the one in flight never changes pace
  assert.deepEqual(ballot(m, 'p_2', true), { ok: true });
  assert.equal(m.speedVote, null);
  assert.equal(m.speedBoostPending, true);
  assert.equal(m.speedBoost, false);
  assert.equal(m.gameSpeed, base, 'PREP keeps its own pace');
  assert.equal(notices(h, 'speedPassed').length, 1);
  assert.ok(m.publicView().speedBoost.pending);
  // the next battle: gameSpeed doubles exactly once
  h.runToPhase(PHASE.COMBAT, 1);
  assert.equal(m.gameSpeed, base * SPEED_BOOST);
  assert.equal(m.speedBoost, true);
  assert.equal(m.speedBoostPending, false);
  assert.ok(m.publicView().speedBoost.on);
  // and it stays: the next round's battle is still 2×, and no vote may turn it up again
  h.runToPhase(PHASE.PREP, 2);
  assert.equal(m.handle('p_0', { t: 'g.speedVote' }).error, ERR.ALREADY);
  h.runToPhase(PHASE.COMBAT, 2);
  assert.equal(m.gameSpeed, base * SPEED_BOOST);
});

test('any connected human turns 2× off with one click: back to 1× next battle, and on again needs a fresh vote', (t) => {
  const { h, m } = prep(3);
  t.after(() => m.dispose());
  const base = m.gameSpeed;
  assert.deepEqual(m.handle('p_0', { t: 'g.speedVote' }), { ok: true });
  ballot(m, 'p_1', true);
  ballot(m, 'p_2', true);
  h.runToPhase(PHASE.COMBAT, 1);
  assert.equal(m.gameSpeed, base * SPEED_BOOST);
  // the round after the vote: anybody may call it off, no ballot at all
  h.runToPhase(PHASE.PREP, 2);
  assert.deepEqual(m.handle('p_2', { t: 'g.speedOff' }), { ok: true });
  assert.equal(m.speedBoost, true, 'the battle in flight keeps its pace');
  assert.equal(m.speedBoostOffPending, true);
  assert.ok(m.publicView().speedBoost.pendingOff, 'the client shows it will stop');
  assert.equal(notices(h, 'speedOff').length, 1);
  // asking twice is harmless, and no vote may turn it up while it is still on
  assert.deepEqual(m.handle('p_0', { t: 'g.speedOff' }), { ok: true });
  assert.equal(notices(h, 'speedOff').length, 1);
  assert.equal(m.handle('p_0', { t: 'g.speedVote' }).error, ERR.ALREADY);
  // the next battle drops back to exactly 1×, once
  h.runToPhase(PHASE.COMBAT, 2);
  assert.equal(m.gameSpeed, base);
  assert.equal(m.speedBoost, false);
  assert.equal(m.speedBoostOffPending, false);
  assert.equal(m.publicView().speedBoost.on, false);
  // it stays off in the rounds after, and turning it on again takes a whole new vote
  h.runToPhase(PHASE.PREP, 3);
  assert.deepEqual(m.handle('p_1', { t: 'g.speedVote' }), { ok: true });
  assert.deepEqual([...m.speedVote.agreed], ['p_1'], 'a fresh vote from scratch');
  assert.equal(m.speedVote.need, 3);
});

test('calling off a boost that has not landed just drops the promise; off when it is already off is an error', (t) => {
  const { h, m } = prep(2);
  t.after(() => m.dispose());
  const base = m.gameSpeed;
  assert.equal(m.handle('p_0', { t: 'g.speedOff' }).error, ERR.ALREADY, 'nothing is on yet');
  assert.equal(m.handle('ai_0', { t: 'g.speedOff' }).error, ERR.NOT_IN_ROOM, 'a bot seat');
  // agreed, but the next battle has not begun: cancelling drops the promise instead of scheduling a turn-off
  assert.deepEqual(m.handle('p_0', { t: 'g.speedVote' }), { ok: true });
  ballot(m, 'p_1', true);
  assert.equal(m.speedBoostPending, true);
  assert.deepEqual(m.handle('p_1', { t: 'g.speedOff' }), { ok: true });
  assert.equal(m.speedBoostPending, false);
  assert.equal(m.speedBoostOffPending, false, 'nothing was on, so nothing to turn off later');
  assert.equal(m.publicView().speedBoost.pending, false);
  h.runToPhase(PHASE.COMBAT, 1);
  assert.equal(m.gameSpeed, base, 'the battle runs at 1×');
  // and a new proposal is welcome straight away — a cancellation is not a failed vote
  assert.deepEqual(m.handle('p_0', { t: 'g.speedVote' }), { ok: true });
});

test('one rejection fails it, and the same round refuses another proposal', (t) => {
  const { h, m } = prep(3);
  t.after(() => m.dispose());
  assert.deepEqual(m.handle('p_0', { t: 'g.speedVote' }), { ok: true });
  assert.deepEqual(ballot(m, 'p_1', false), { ok: true });
  assert.equal(m.speedVote, null, 'unanimous: a single no ends it');
  assert.equal(m.speedBoostPending, false);
  assert.equal(notices(h, 'speedFailed').length, 1);
  assert.equal(m.publicView().speedBoost.failedRound, m.round, 'the view tells the client to drop the button');
  assert.equal(m.handle('p_0', { t: 'g.speedVote' }).error, ERR.ALREADY, 'failed this round');
  assert.equal(m.handle('p_2', { t: 'g.speedVote' }).error, ERR.ALREADY, 'for every proposer');
  // the next round is free again
  h.runToPhase(PHASE.PREP, 2);
  assert.deepEqual(m.handle('p_0', { t: 'g.speedVote' }), { ok: true });
});

test('the proposer withdraws with agree:false; a timeout fails it; a vote needs a live phase', (t) => {
  const { h, m } = prep(2);
  t.after(() => m.dispose());
  assert.deepEqual(m.handle('p_0', { t: 'g.speedVote' }), { ok: true });
  assert.equal(m.handle('p_0', { t: 'g.speedVote' }).error, ERR.WRONG_PHASE, 'one at a time');
  assert.deepEqual(ballot(m, 'p_0', false), { ok: true });
  assert.equal(m.speedVote, null);
  assert.equal(notices(h, 'speedCancelled').length, 1);
  // a timeout: nobody answers
  assert.deepEqual(m.handle('p_1', { t: 'g.speedVote' }), { ok: true });
  h.run(() => m.speedVote == null, { maxSteps: 400_000 });
  assert.equal(m.speedVote, null);
  assert.equal(notices(h, 'speedFailed').at(-1).reason, 'timeout');
  assert.equal(m.speedBoostPending, false);
});

test('a voter who disconnects drops out and the need is recounted', (t) => {
  const { m } = prep(3);
  t.after(() => m.dispose());
  assert.deepEqual(m.handle('p_0', { t: 'g.speedVote' }), { ok: true });
  assert.equal(m.speedVote.need, 3);
  m.onDisconnect('p_2');
  assert.deepEqual(m.speedVote.voters, ['p_0', 'p_1']);
  assert.equal(m.speedVote.need, 2);
  assert.deepEqual(ballot(m, 'p_1', true), { ok: true });
  assert.equal(m.speedBoostPending, true, 'the two left are unanimous');
});

test('bots, spectators and finished phases cannot propose; the boost survives a checkpoint', (t) => {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 1, seed: 65, fake: true, spectators: ['viewer'], script: () => ({ duration: 4 }) }).start();
  t.after(() => h.m.dispose());
  const m = h.m;
  assert.equal(m.handle('ai_0', { t: 'g.speedVote' }).error, ERR.NOT_IN_ROOM, 'a bot seat');
  assert.equal(m.handle('viewer', { t: 'g.speedVote' }).error, ERR.SPECTATOR, 'a spectator');
  h.runToPhase(PHASE.PREP, 1);
  assert.deepEqual(m.handle('p_0', { t: 'g.speedVote' }), { ok: true });
  assert.deepEqual(ballot(m, 'p_1', true), { ok: true });
  assert.equal(m.handle('ai_0', { t: 'g.speedBallot', voteId: 1, agree: true }).error, ERR.NOT_IN_ROOM, 'a bot is never a voter');
  // a checkpoint of a boosted-but-not-yet-applied match restores the promise (a saved field, not the transient vote)
  h.run(() => canSnapshot(m) || m.phase !== PHASE.PREP);
  assert.ok(canSnapshot(m));
  const doc = JSON.parse(JSON.stringify(snapshotMatch(m)));
  const r = makeMatch({ mode: 'coop', seats: doc.seats, seed: doc.seed, fake: true });
  t.after(() => r.m.dispose());
  assert.equal(restoreMatch(r.m, doc, { createRngFromState }), true);
  assert.equal(r.m.speedVote, null, 'the vote itself is transient');
  assert.equal(r.m.speedBoostPending, true);
  assert.equal(r.m.gameSpeed, m.gameSpeed * SPEED_BOOST, 'the restored match runs at 2×, not 1×');
});
