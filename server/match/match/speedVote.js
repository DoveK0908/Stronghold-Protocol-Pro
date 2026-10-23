// server/match/match/speedVote.js — 局内投票开启二倍速 (the owner's rule of 2026-10-23): the connected humans of a live
// match may agree, unanimously, to run the rest of the match's battles at twice the speed.
// [ASSUMED] A convenience rule, not an official one (DESIGN, 0.3.0 history).
//
// The vote (g.speedVote proposes, g.speedBallot { voteId, agree } answers): open in every live phase before SETTLE
// (SP_DRAFT / PREP / COMBAT / UNITE), one per match at a time; voters = the connected humans that have not left and are
// not spectators, at proposal time; need = every one of them (`speedNeed`), the proposer counting as yes. It passes
// once `agreed` reaches need and fails as soon as one voter rejects. A voter that disconnects or leaves is dropped and
// need recomputed from the voters left. It times out after SPEED_VOTE_MS. A failed (rejected / timed-out) vote blocks
// another for the rest of the round; a 300 ms burst guard per proposing player.
//
// What it buys: `speedBoostPending`, which doubles `gameSpeed` for the *next* battle, never the one in flight — every
// deadline, field clock and 联军 budget of a phase is computed from `gameSpeed` when the phase begins, so switching it
// under a running battle would make game time jump (clientCombat derives elapsed game time as wall × speed). MatchCombat's startCombat reads
// the flag and doubles `m.gameSpeed` once, then clears it; `speedBoost` records that this match already runs at 2× so
// nobody can vote it up twice. Both survive a checkpoint restore with the match state (server/match/snapshot.js), and
// the vote itself is transient like the other votes.
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { GAME_SPEED } from '../fields.js';
import { OK, fail } from './common.js';

/** How long a speed vote stays open (ms, × timerScale). */
export const SPEED_VOTE_MS = 30_000;
/** How much faster the rest of the match runs once the vote passes. */
export const SPEED_BOOST = 2;
/** Yes votes a speed vote needs of `n` voters: all of them (the owner's rule of 2026-10-23). */
export const speedNeed = (n) => Math.max(1, n);

export class MatchSpeedVote {
  /**
   * The vote's payoff, taken by MatchCombat.startCombat when the next battle begins: doubles `gameSpeed` once and records
   * that the match now runs at 2×. Never called mid-battle — see the header.
   */
  applySpeedBoost() {
    if (!this.speedBoostPending) return false;
    this.speedBoostPending = false;
    this.speedBoost = true;
    const base = Number.isFinite(this.gameSpeed) && this.gameSpeed > 0 ? this.gameSpeed : GAME_SPEED;
    this.gameSpeed = Math.min(200, base * SPEED_BOOST);
    this.log.info?.(`[match ${this.roomCode}] battles now run at ${this.gameSpeed} (R${this.round})`);
    return true;
  }

  /** The phases a speed vote may be proposed in: every live phase before the settlement. */
  speedVotePhase(phase = this.phase) {
    return phase === PHASE.SP_DRAFT || phase === PHASE.PREP || phase === PHASE.COMBAT || phase === PHASE.UNITE;
  }

  /** g.speedVote — no payload: it proposes 二倍速 for the next battle. */
  requestSpeedVote(ps) {
    if (this.disposed || this.ended) return fail(ERR.WRONG_PHASE);
    if (!ps || ps.isBot || ps.spectator || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    if (!this.speedVotePhase()) return fail(ERR.WRONG_PHASE);
    if (this.speedVote) return fail(ERR.WRONG_PHASE, 'speed vote in progress');
    if (this.speedBoost || this.speedBoostPending) return fail(ERR.ALREADY, 'already at 2x');
    if (this._speedFailedRound === this.round) return fail(ERR.ALREADY, 'a speed vote already failed this round');
    const now = this.sched.now();
    if (now - (this._speedVoteAt.get(ps.playerId) ?? -Infinity) < 300) return fail(ERR.RATE);
    this._speedVoteAt.set(ps.playerId, now);
    const voters = this.humans().filter((p) => p.connected && !p.spectator).map((p) => p.playerId);
    if (!voters.includes(ps.playerId)) return fail(ERR.NOT_IN_ROOM);
    const ms = this.scaled(SPEED_VOTE_MS);
    const vote = this.speedVote = {
      id: ++this._speedVoteSeq,
      proposerId: ps.playerId,
      voters,
      agreed: new Set([ps.playerId]),
      rejected: new Set(),
      need: speedNeed(voters.length),
      deadline: now + ms,
      timer: null,
    };
    this.log.info?.(`[match ${this.roomCode}] seat ${ps.seat} proposes 2× speed (R${this.round})`);
    vote.timer = this.later(ms, () => {
      if (this.speedVote !== vote) return;
      vote.timer = null;
      this._failSpeedVote('timeout');
    });
    return this._settleSpeedVote();
  }

  /** g.speedBallot { voteId, agree } */
  answerSpeedVote(ps, voteId, agree) {
    const vote = this.speedVote;
    if (!vote) return fail(ERR.WRONG_PHASE);
    if (vote.id !== voteId) return fail(ERR.BAD_TARGET, 'speed vote changed');
    if (!ps || !ps.connected || ps.left || !vote.voters.includes(ps.playerId)) return fail(ERR.NOT_IN_ROOM);
    // the proposer saying no withdraws the proposal
    if (!agree && ps.playerId === vote.proposerId) { this.cancelSpeedVote('withdrawn'); return OK; }
    if (agree) { vote.agreed.add(ps.playerId); vote.rejected.delete(ps.playerId); }
    else { vote.rejected.add(ps.playerId); vote.agreed.delete(ps.playerId); }
    return this._settleSpeedVote();
  }

  /** A voter disconnected or left: dropped and recounted. */
  _speedVoteMemberGone(playerId) {
    const vote = this.speedVote;
    if (!vote || !vote.voters.includes(playerId)) return;
    vote.voters = vote.voters.filter((id) => id !== playerId);
    vote.agreed.delete(playerId);
    vote.rejected.delete(playerId);
    if (!vote.voters.length) { this.cancelSpeedVote('empty'); return; }
    vote.need = speedNeed(vote.voters.length);
    this._settleSpeedVote();
  }

  _settleSpeedVote() {
    const vote = this.speedVote;
    if (!vote) return OK;
    if (this.disposed || this.ended || !this.speedVotePhase()) { this.cancelSpeedVote('phaseEnd'); return OK; }
    if (this.speedBoost || this.speedBoostPending) { this.cancelSpeedVote('alreadyOn'); return OK; }
    if (vote.agreed.size >= vote.need) {
      const id = vote.id, agreed = vote.agreed.size, voters = vote.voters.length;
      this._endSpeedVote();
      // the next battle onwards, never the one in flight (MatchCombat.startCombat consumes this)
      this.speedBoostPending = true;
      this.log.info?.(`[match ${this.roomCode}] 2× speed agreed ${agreed}/${voters} (R${this.round}, from the next battle)`);
      this.broadcast({ t: 'm.notice', kind: 'speedPassed', voteId: id, agreed, voters });
      this.markPublic();
      this.flush(true);
      return OK;
    }
    if (vote.voters.length - vote.rejected.size < vote.need) { this._failSpeedVote('rejected'); return OK; }
    this.markPublic();
    this.flush(true);
    return OK;
  }

  /** Rejected or timed out: no other speed vote for the rest of the round. */
  _failSpeedVote(reason) {
    const vote = this._endSpeedVote();
    if (!vote) return;
    // 本轮已经失败过：本轮内不再接受提案（下一轮重新可以提）
    this._speedFailedRound = this.round;
    this.broadcast({ t: 'm.notice', kind: 'speedFailed', voteId: vote.id, reason });
    this.markPublic();
    this.flush(true);
  }

  /**
   * `reason` (m.notice speedCancelled): 'withdrawn' (the proposer), 'empty' (no voter left), 'phaseEnd' (SETTLE /
   * match end), 'alreadyOn' (the boost was turned on by something else).
   */
  cancelSpeedVote(reason) {
    const vote = this._endSpeedVote();
    if (!vote || this.disposed) return;
    this.broadcast({ t: 'm.notice', kind: 'speedCancelled', voteId: vote.id, reason });
    this.markPublic();
    this.flush(true);
  }

  _endSpeedVote() {
    const vote = this.speedVote;
    if (!vote) return null;
    if (vote.timer) { this.cancel(vote.timer); vote.timer = null; }
    this.speedVote = null;
    return vote;
  }

  /** m.public speedVote: null or { id, proposerId, voters, agreed, rejected, need, deadline }. */
  speedVoteView() {
    const vote = this.speedVote;
    if (!vote) return null;
    return {
      id: vote.id,
      proposerId: vote.proposerId,
      voters: vote.voters.slice(),
      agreed: [...vote.agreed],
      rejected: [...vote.rejected],
      need: vote.need,
      deadline: vote.deadline,
    };
  }
}
