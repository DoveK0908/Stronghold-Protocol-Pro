// 局内投票开启二倍速 (the owner's rule of 2026-10-23; server/match/match/speedVote.js): every connected human of a live
// match may propose running the rest of the match's battles twice as fast — unanimously, and it lands on the *next*
// battle (the one in flight keeps its pace). SpeedAction is the propose button of the team panel's notice strip,
// SpeedVoteNotice the open vote (m.public speedVote): 同意 / 反对 for the voters, 撤回 for the proposer, and a plain
// 二倍速 badge once it is on. UI hints only: the authority rechecks every rule.
import { useRef, useState } from '../../vendor/hooks.module.js';
import { PHASE } from '../../../shared/constants.js';
import { html, Button, Icon, Countdown, confirmDialog } from './components.js';
import { act } from './gameActions.js';
import { useStore } from '../store.js';
import { t } from '../../../shared/i18n.js';

/** The phases the authority accepts a proposal in (speedVote.js speedVotePhase). */
const LIVE_PHASES = [PHASE.SP_DRAFT, PHASE.PREP, PHASE.COMBAT, PHASE.UNITE];

/** Whether `myId` may propose 二倍速 now. */
export function speedVotable(pub, myId) {
  if (!pub || pub.speedVote || pub.speedBoost?.on || pub.speedBoost?.pending) return false;
  // 本轮已经失败过：本轮不再给按钮（下一轮重新出现），免得点一次吃一次拒绝
  if (pub.speedBoost?.failedRound === pub.round) return false;
  if (!LIVE_PHASES.includes(pub.phase)) return false;
  const me = pub.players?.find((p) => p.playerId === myId);
  if (!me || me.isBot || me.spectator || me.status === 'left' || me.connected === false) return false;
  // a vote needs somebody to answer it: three or more humans make it a real vote, one or two still a unanimous one
  return (pub.players || []).filter((p) => !p.isBot && !p.spectator && p.status !== 'left' && p.connected !== false).length >= 1;
}

function useSend() {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const send = async (fn) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try { await fn(); } finally { pending.current = false; setBusy(false); }
  };
  return [busy, send];
}

/** The propose button + the 二倍速 badge (team panel notice strip). */
export function SpeedAction({ pub, myId, compact = false }) {
  const online = useStore((s) => s.connection.status === 'online');
  const [busy, send] = useSend();
  if (pub?.speedBoost?.on || pub?.speedBoost?.pending) {
    // already agreed: say so instead of offering a vote nobody may start again
    return html`<div class="team-speed team-speed--on" role="status">
      <${Icon} name="play" /><span>${t('二倍速已开启')}</span>
    </div>`;
  }
  if (!speedVotable(pub, myId)) return null;
  const propose = () => send(async () => {
    const ok = await confirmDialog({
      title: t('开启二倍速'),
      text: t('投票通过后，本局接下来的战斗会以二倍速进行（正在进行或即将开始的这一场不受影响）。需要全部在线队友同意。'),
      okText: t('发起投票'),
    });
    if (ok) await act('g.speedVote', {}, { sfx: 'confirm' });
  });
  return html`<div class="team-speed">
    <${Button} variant="secondary" size="sm" icon="play" disabled=${!online || busy} loading=${busy} onClick=${propose}
      aria-label=${t('发起二倍速投票')} title=${t('投票开启二倍速：本局接下来的战斗以二倍速进行')}>${compact ? null : t('二倍速')}<//>
  </div>`;
}

/** The open vote (m.public speedVote): consent / reject for the voters, withdraw for the proposer. */
export function SpeedVoteNotice({ pub }) {
  const myId = useStore((s) => s.me.playerId);
  const online = useStore((s) => s.connection.status === 'online');
  const [busy, send] = useSend();
  const vote = pub?.speedVote;
  if (!vote) return null;
  const players = pub.players || [];
  const nameOf = (id) => players.find((p) => p.playerId === id)?.name || t('博士');
  const voter = vote.voters.includes(myId);
  const agreed = vote.agreed.includes(myId), rejected = vote.rejected.includes(myId);
  const proposer = vote.proposerId === myId;
  const ballot = (agree) => send(() => act('g.speedBallot', { voteId: vote.id, agree }, { sfx: agree ? 'confirm' : 'back' }));
  return html`<div class="team-rescue team-speed-vote" role="status" aria-live="polite">
    <strong><${Icon} name="play" /> ${t('局内投票开启二倍速')}</strong>
    <${Countdown} deadline=${vote.deadline} size="sm" gauge=${false} label=${t('投票剩余')} />
    <small>${t('同意 {agreed}/{need} · 反对 {rejected}', { agreed: vote.agreed.length, need: vote.need, rejected: vote.rejected.length })}
      · ${t('{name} 发起', { name: nameOf(vote.proposerId) })}</small>
    ${voter ? html`<div class="team-kick__actions">
      ${proposer ? html`<${Button} size="sm" disabled=${busy || !online} onClick=${() => ballot(false)}>${t('撤回')}<//>`
        : html`<${Button} variant="primary" size="sm" disabled=${busy || !online || agreed} onClick=${() => ballot(true)}>${agreed ? t('已同意') : t('同意')}<//>
          <${Button} variant="danger" size="sm" disabled=${busy || !online || rejected} onClick=${() => ballot(false)}>${rejected ? t('已反对') : t('反对')}<//>`}
    </div>` : null}
  </div>`;
}
