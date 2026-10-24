// Band draft — BAND_DRAFT "2/2 选择策略" (research 06 §4.2, D1): left = draft order (avatar, name, state:
// … waiting / ⌛ 决策中 / chosen band ✓), current picker highlighted; centre = grid of every band allowed
// for the mode type (icon, name, LP); a band a teammate already picked carries the picker's avatar and is marked
// 队友已选 — it cannot be chosen again (research 09 §5, guidebook 策略与轮选; the server refuses it too); right =
// detail pane (icon, 初始生命值, name, effect name + rich description) with 跳过 (co-op, once) and 确认选择.
// One countdown (user playtest #4 item 4): every turn has the same clock (Match BAND_TURN_SECONDS, m.public.draft
// turnSeconds) and the step header counts it down — m.public.deadline IS the turn's end, the same number as the
// current picker's row. The highlighted band (the detail pane's) is what a turn that runs out takes: every change of it
// is reported (g.bandFocus) and the server assigns it while it is free, else 「华法琳」, else the first free strategy
// (timeoutBand). It starts on that default, so the tip under the order list always names what a timeout gives.
// Solo, and a co-op match with a single human (the server's soloUntimed: draft.untimed): no clock at all.
// A strategy built around a bond the mode switches off (bands.json bondIds ∩ the mode's inactive bonds — 标准: 潘格尼尼
// 拉特兰, 克莱门莎 阿戈尔, 玛恩纳 卡西米尔; the bot never picks one) reads 本局禁用 on its card and in the detail pane
// (BandOffTag / BandOffNote, DESIGN §21.26, §21.7's look); it stays selectable — information only.
// 本局信息 (GitHub #8 item 1 and #484): the entry under the order list opens the briefing's leader, battlefield,
// special enemies (ui/matchEnemies.js), bond rows, legend and 本局禁用干员 again, read-only (MatchInfoDialog).
// The draft runs on underneath: its status line repeats the current turn and the countdown (draftInfoStatus),
// a turn change (a pick, a skip, a turn that runs out, an AI pick) closes it, the end of the draft unmounts it, and it
// never touches the highlighted band or the buttons.
// Pro differences (this fork, 2026-10-19): 预选盟约 (ui/bondPlan.js, 联机#03) — a second block button under 本局信息 opens the
// bond-plan picker while g.bondPlan is open, and every order row shows the doctor's planned bond (BondPlanTag); expanded
// rooms draft concurrently (m.public.draft.concurrent, 工程#01) — every seat picks at once, so the order has no current
// picker, the queue strip says how many are still choosing, and there is no skip.

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel, useTicker, secondsLeft } from '../ui/components.js';
import { useGameData, BandIcon, RichText, PlayerAvatar, LpTower, Sprite, Img } from '../ui/gameComponents.js';
import { StepHeader, ExitModal } from '../ui/matchChrome.js';
import { MatchInfoDialog, matchInfoModel } from '../ui/matchInfo.js';
import { MatchEnemies } from '../ui/matchEnemies.js';
import { actions, act } from '../ui/gameActions.js';
import { normalizeDraft, sortedPlayers, draftMyTurn } from '../ui/gameLogic.js';
import { plannableBonds, bondPlanOpen, bondPlanHolders, BondPlanTag, BondPlanPicker } from '../ui/bondPlan.js';
import { useStore } from '../store.js';
import { data } from '../data.js';
import { audio } from '../audio.js';
import { TurnBanner } from '../ui/turnBanner.js';
import { bootArtReady } from '../ui/protocolBoot.js';
import { reducedMotion } from '../ui/device.js';
import { modeOffBonds, bandOffBonds, bandOffLine } from '../ui/gameLogic.js';
import { t, tParts, tName } from '../../../shared/i18n.js';
import { NameCardLayer } from '../ui/namecards.js';
import { TrophyBadge } from '../ui/trophies.js';
import { cardOperators, cardAvatarUrl, seatPortrait } from '../ui/seatArt.js';
import { usePlayerLabel } from '../ui/myInfo.js';
import { useMyCard } from '../ui/playerCard.js';
import { useRise } from '../ui/transitions.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** 本局禁用 on a strategy card whose bonds `names` the mode switches off (bandOffBonds); nothing otherwise. */
export function BandOffTag({ names = [] }) {
  return names.length ? html`<span class="dband__off" title=${bandOffLine(names)}>${t('本局禁用')}</span>` : null;
}

/** The detail pane's note for such a strategy: "本局禁用【拉特兰】盟约，此策略效果可能无法发挥" (the bond names struck through). */
export function BandOffNote({ names = [] }) {
  if (!names.length) return null;
  return html`<p class="draft-detail__off" role="note" aria-label=${bandOffLine(names)}><${Icon} name="info" /><span>${tParts('本局禁用{names}盟约，此策略效果可能无法发挥', { names: names.map((n, i) => html`<span key=${i}>${tParts('【{name}】', { name: html`<s class="draft-detail__offname">${n}</s>` })}</span>`) })}</span></p>`;
}

/**
 * Bands selectable in a mode (modeTypeList contains the mode's type), sorted by sortId.
 * @param {any[]} bands
 * @param {string|null} modeType 'SINGLE'|'MULTI'
 */
export function allowedBands(bands, modeType, disableDuckLord = false) {
  const sid = (b) => (Number.isFinite(b.sortId) ? b.sortId : 99);
  return (Array.isArray(bands) ? bands : [])
    // an expanded room (5+ seats) with the duck lord switched off drops 鸭爵 from the wall (experimental option, 玩法)
    .filter((b) => b && !(disableDuckLord === true && b.bandId === 'band_ducklord')
      && (!modeType || !Array.isArray(b.modeTypeList) || b.modeTypeList.includes(modeType)))
    .sort((a, b) => sid(a) - sid(b) || (a.bandId < b.bandId ? -1 : a.bandId > b.bandId ? 1 : 0));
}

/** The official default strategy of an automatic assignment (data/config.json bandDraft.timeoutBandId). */
export const DEFAULT_TIMEOUT_BAND = 'band_bldsk';

/**
 * The strategy the server assigns me when my turn times out (server/match/match/phases.js defaultBand): the official default
 * 「华法琳」 while no teammate holds it, else the first free strategy in draft order (sortId) — never one a teammate
 * already picked (队友已选).
 * @param {any[]} bands allowedBands(...) (sortId order)
 * @param {Map<string, any>} taken teammateBands(...)
 * @param {string} [defaultId]
 * @returns {string|null}
 */
export function timeoutBand(bands, taken, defaultId = DEFAULT_TIMEOUT_BAND) {
  const list = Array.isArray(bands) ? bands : [];
  const has = (id) => !!(taken && typeof taken.has === 'function' && taken.has(id));
  if (defaultId && !has(defaultId) && (!list.length || list.some((b) => b.bandId === defaultId))) return defaultId;
  return list.find((b) => !has(b.bandId))?.bandId || defaultId || null;
}

/**
 * Bands taken by teammates (队友已选): bandId → the picking players (never the viewer).
 * @param {Map<string, string>} picks normalizeDraft(...).picks (playerId → bandId)
 * @param {string} myId
 */
export function teammateBands(picks, myId, allowRepeat = false) {
  const out = new Map();
  // an expanded room may let two doctors hold the same strategy (m.public draft.allowRepeat): nobody is 队友已选 then
  if (allowRepeat === true) return out;
  for (const [pid, bid] of picks instanceof Map ? picks : []) {
    if (pid === myId || typeof bid !== 'string') continue;
    if (!out.has(bid)) out.set(bid, []);
    out.get(bid).push(pid);
  }
  return out;
}

/**
 * Bands the server already reserved for a doctor who is still choosing (m.public draft.reserved: bandId → playerId):
 * they read 队友已选 for everybody else even before the pick lands (concurrent drafts, expanded rooms).
 * @param {any} rawDraft m.public draft
 * @param {Map<string, string>} picks the landed picks
 * @param {string} myId
 */
export function reservedBands(rawDraft, picks, myId) {
  const out = new Map();
  const r = rawDraft && typeof rawDraft.reserved === 'object' && rawDraft.reserved ? rawDraft.reserved : {};
  for (const [bid, pid] of Object.entries(r)) {
    if (typeof pid !== 'string' || pid === myId || (picks instanceof Map && picks.has(pid))) continue;
    out.set(bid, pid);
  }
  return out;
}

/**
 * The band the detail pane shows (= the highlighted band a turn that runs out takes): the current one, else my pick,
 * else the band a timeout would give me (timeoutBand: 「华法琳」 while free, else the first free one). When it is my
 * turn and the shown band was taken meanwhile (队友已选), that default instead (confirm would be disabled).
 * @param {string|null} sel
 * @param {{ bands: any[], taken: Map<string, any>, myPick: string|null, myTurn: boolean, defaultId?: string }} o
 */
export function draftSelection(sel, { bands, taken, myPick, myTurn, defaultId = DEFAULT_TIMEOUT_BAND }) {
  if (!Array.isArray(bands) || !bands.length) return sel;
  const free = timeoutBand(bands, taken, defaultId) || bands[0].bandId;
  if (!sel) return myPick || free;
  if (!myPick && myTurn && taken.has(sel)) return free;
  return sel;
}

/**
 * The strategy a turn that runs out assigns me (server Match.timeoutBand): the highlighted band while it is one of
 * the mode's and no teammate holds it, else timeoutBand. Null after my pick.
 * @param {string|null} sel the highlighted band
 * @param {{ bands: any[], taken: Map<string, any>, myPick?: string|null, defaultId?: string }} o
 */
export function autoPickBand(sel, { bands, taken, myPick = null, defaultId = DEFAULT_TIMEOUT_BAND }) {
  if (myPick) return null;
  const list = Array.isArray(bands) ? bands : [];
  const has = (id) => !!(taken && typeof taken.has === 'function' && taken.has(id));
  if (sel && !has(sel) && list.some((b) => b.bandId === sel)) return sel;
  return timeoutBand(list, taken, defaultId);
}

/**
 * The tip under the co-op draft order: the one skip, the turn clock and what a turn that runs out assigns me (the
 * highlighted band while free — autoPickBand). Untimed drafts (a single human) name no clock.
 * @param {{ timed: boolean, turnSeconds?: number|null, autoName?: string|null, selected?: boolean, concurrent?: boolean }} o
 *   selected: the auto pick is the highlighted band (not the default standing in for a band a teammate holds);
 *   concurrent: every seat picks at once (m.public draft.concurrent) — no skip, `turnSeconds` is the step's
 */
export function draftTip({ timed, turnSeconds = null, autoName = null, selected = true, concurrent = false }) {
  // a concurrent draft (everybody at once, expanded rooms): no skip, one clock for the step
  const skip = concurrent ? t('所有博士同时选择') : t('联合模拟在选择策略时可以进行一次跳过');
  if (!timed) return t('{skip}；本局不限时', { skip });
  const clock = Number(turnSeconds) > 0 ? t(concurrent ? '限时 {n} 秒' : '每位博士有 {n} 秒', { n: Math.round(turnSeconds) }) : t('每位博士限时决策');
  if (!autoName) return t('{skip}；{clock}', { skip, clock });
  return selected ? t('{skip}；{clock}，超时将自动选择当前选中的「{autoName}」', { skip, clock, autoName })
    : t('{skip}；{clock}，超时将自动选择「{autoName}」', { skip, clock, autoName });
}

/**
 * The step header's countdown during the draft: the current turn's (m.public.deadline = draft.turnDeadline) with a
 * turn's length as the gauge total — null when the draft is untimed.
 * @param {any} pub m.public
 * @returns {{ deadline: number, total: number|null } | null}
 */
export function draftClock(pub) {
  const d = pub && typeof pub.draft === 'object' ? pub.draft : null;
  if (!d || d.untimed) return null;
  const deadline = Number(pub.deadline) > 0 ? Number(pub.deadline) : Number(d.turnDeadline) || 0;
  if (!(deadline > 0)) return null;
  return { deadline, total: Number(d.turnSeconds) > 0 ? Number(d.turnSeconds) : null };
}

/**
 * The status line of the 本局信息 dialog: what the draft does while the dialog covers it — my pick, else whose turn it is
 * with the turn's seconds left (the step header's number; none when untimed), warning at ≤ 10 s like the countdown.
 * @param {{ myPick?: string|null, pickName?: string|null, myTurn: boolean, turnName?: string|null, secs?: number|null,
 *   waiting?: boolean }} o waiting: teammates still have to pick after my pick
 * @returns {{ text: string, secs: number|null, tone: 'mint'|'gold'|'warn'|'dim' }}
 */
export function draftInfoStatus({ myPick = null, pickName = null, myTurn, turnName = null, secs = null, waiting = false }) {
  if (myPick) return { text: `${t('已选择「{name}」', { name: pickName || '' })}${waiting ? t('，等待其他博士') : ''}`, secs: null, tone: 'mint' };
  const s = Number.isFinite(secs) ? Math.max(0, Math.round(secs)) : null;
  const tone = s != null && s <= 10 ? 'warn' : 'gold';
  if (myTurn) return { text: t('轮到你决策'), secs: s, tone };
  return { text: turnName ? t('{turnName} 决策中', { turnName }) : t('等待轮到你'), secs: s, tone: s != null ? tone : 'dim' };
}

/** BAND_DRAFT screen. */
/**
 * One 决策顺序 row. The official row is a plain name; this one puts the doctor's 名片 behind it (底图 from
 * room.state seats[].card, else their 名片干员 half-body) so the order reads like the room's seat cards. The name keeps
 * its own column and ellipsises — the card art only fills the background, it never squeezes the text.
 */
function OrderRow({ p, i, picked, cur, self, solo, nc, art, card, face, gd, turnSecs }) {
  const label = usePlayerLabel();
  const flash = useRise(!!picked, 1100);
  const pband = picked ? gd.band(picked) : null;
  const glyph = [...(p.name || '?')][0];
  return html`<div key=${p.playerId} class=${cx('dorder', cur && 'is-cur', picked && 'is-done', self && 'is-self', flash && 'is-flash', nc && 'has-nc')} style=${solo ? null : `--i:${i}`}>
    ${nc ? html`<span class="dorder__nc"><${NameCardLayer} card=${nc} /></span>` : null}
    ${art && !nc ? html`<span class="dorder__art" style=${'background-image:url("' + art + '")'}></span>` : null}
    <span class="dorder__idx num">${i + 1}</span>
    <span class="dorder__face">${p.isBot
      ? html`<${PlayerAvatar} player=${p} self=${self} />`
      : html`<${Img} src=${face} alt="" class="dorder__img" fallback=${html`<span class="dorder__glyph">${glyph}</span>`} />`}${self ? html`<span class="dorder__me" title=${t('我')}><${Icon} name="user" /></span>` : null}</span>
    <div class="dorder__text">
      <b class="dorder__name">${p.isBot ? null : html`<${TrophyBadge} count=${Number.isSafeInteger(card?.trophies) ? card.trophies : null} class="tbadge--inline" />`}<span class="dorder__label">${p.isBot ? p.name || t('博士') : label(p.name, p.tag)}</span>${p.isBot ? html`<span class="dorder__ai">AI</span>` : null}</b>
      <span class="dorder__state">${picked ? html`<span class="t-mint">${pband?.name || t('已选择')}</span>`
        : cur ? html`<span class="t-gold"><${Icon} name="hourglass" />${t('决策中')}${turnSecs != null ? html`<b class="num dorder__secs">${turnSecs}s</b>` : null}</span>`
        : html`<span class="t-dim"><${Icon} name="dots" />${t('等待中')}</span>`}</span>
      ${!solo && p.bondPlan ? html`<${BondPlanTag} bondId=${p.bondPlan} gd=${gd} class="dorder__plan" />` : null}
    </div>
    <span class="dorder__box">
      ${picked ? html`<${BandIcon} bandId=${picked} size="sm" /><span class="dorder__check"><${Icon} name="check" /></span>`
        : cur && self ? html`<${Sprite} k="bandChoose/youturn_finger" class="dorder__finger" fallback=${html`<${Icon} name="chevronLeft" />`} />`
        : null}
    </span>
  </div>`;
}

export function BandDraftScreen() {
  const pub = useStore((s) => s.match.public);
  const priv = useStore((s) => s.match.private);
  const myId = useStore((s) => s.me.playerId);
  const roomSolo = useStore((s) => s.room?.mode === 'solo');
  const gd = useGameData();
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(null);
  const [exit, setExit] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);

  const mode = gd.config?.modes?.[pub?.modeId];
  const offBonds = modeOffBonds(mode); // the bonds this mode never activates (标准: 10 of 23)
  const solo = roomSolo || mode?.type === 'SINGLE' || String(pub?.modeId || '').includes('single');
  const disableDuckLord = !solo && pub?.playerCapacity > 4 && pub?.experimental?.disableDuckLord === true;
  const bands = useMemo(() => allowedBands(gd.list('bands'), mode?.type || (solo ? 'SINGLE' : 'MULTI'), disableDuckLord), [gd.ready, mode?.type, solo, disableDuckLord, data.locale()]);
  const players = sortedPlayers(pub);
  // 名片 of the order rows: 底图/奖杯 from room.state seats[].card (mine from this browser), else the doctor's 名片干员
  // art (their pick, else one chosen from the player id) — the same sources the room's seat cards use
  const roomSeats = useStore((st) => st.room?.seats);
  const myCard = useMyCard();
  const cardList = useMemo(() => cardOperators(gd.list('chess')), [gd.ready]);
  const portraits = useMemo(() => ({
    pool: cardList.filter((c) => (c.rarity ?? 0) >= 5).sort((a, b) => (a.charId < b.charId ? -1 : 1)),
    byChar: new Map(cardList.map((c) => [c.charId, c])), m: data.get('assets'), myId, myCard: myCard.charId, myLook: myCard.look,
  }), [cardList, myId, myCard.charId, myCard.look]);
  const seatOf = (pid) => (Array.isArray(roomSeats) ? roomSeats.find((x) => x && x.playerId === pid) : null) || null;
  const cardOf = (pl) => (pl.playerId === myId ? myCard : seatOf(pl.playerId)?.card || null);
  const artOf = (pl) => (pl.isBot ? null : seatPortrait(seatOf(pl.playerId) || { playerId: pl.playerId }, portraits));
  // the row keeps the player's own avatar (like the lobby's 名片): their picked look, else the seat portrait
  const faceOf = (pl) => (pl.isBot ? null : cardAvatarUrl(cardOf(pl)?.avatar, portraits.m, cardOf(pl)?.avatarLook) || artOf(pl));
  const draft = normalizeDraft(pub?.draft, players);
  // an expanded room's draft: every seat picks at once (server MatchPhases.concurrentDraft) — no turn, no skip
  const concurrent = !solo && draft.concurrent === true;
  const myPick = draft.picks.get(myId) || priv?.bandId || null;
  const myTurn = !myPick && draftMyTurn(draft, myId, solo);
  const skipsLeft = draft.skipsLeft.has(myId) ? draft.skipsLeft.get(myId) : (skipped ? 0 : 1);
  const canSkip = !solo && !concurrent && myTurn && skipsLeft > 0 && draft.order.filter((pid) => !draft.picks.has(pid)).length > 1;
  const taken = solo ? new Map() : teammateBands(draft.picks, myId, draft.allowRepeat);
  const reserved = solo ? new Map() : reservedBands(pub?.draft, draft.picks, myId);
  for (const [bid, pid] of reserved) if (!taken.has(bid)) taken.set(bid, [pid]);
  const pickers = new Map(); // bandId → players
  for (const [pid, bid] of [...draft.picks, ...[...reserved].map(([bid, pid]) => [pid, bid])]) {
    const p = players.find((x) => x.playerId === pid);
    if (!pickers.has(bid)) pickers.set(bid, []);
    pickers.get(bid).push(p || { playerId: pid, name: '?' });
  }

  // 预选盟约 (联机#03, ui/bondPlan.js): my plan, the others', and whether it can still change
  const planBonds = useMemo(() => plannableBonds(gd.list('bonds')), [gd.ready, data.locale()]);
  const myPlan = players.find((p) => p.playerId === myId)?.bondPlan ?? null;
  const canPlan = !solo && draft.order.includes(myId) && bondPlanOpen(pub);
  const pickPlan = async (bondId) => {
    if (planBusy) return;
    setPlanBusy(true);
    const ok = await act('g.bondPlan', { bondId }, { sfx: 'confirm' });
    setPlanBusy(false);
    if (ok) setPlanOpen(false);
  };

  // default selection: my pick, else what a timeout gives me (华法琳 while free); when my turn comes while the selected
  // band has been taken by a teammate meanwhile (队友已选), move the selection back to that default
  const defaultId = gd.config?.bandDraft?.timeoutBandId || DEFAULT_TIMEOUT_BAND;
  const takenKey = [...taken.keys()].sort().join(',');
  useEffect(() => {
    const next = draftSelection(sel, { bands, taken, myPick, myTurn, defaultId });
    if (next !== sel) setSel(next);
  }, [bands.length, myPick, myTurn, takenKey]);
  // "your turn" cue: the sound, and the event's 请选择策略 band (ui/turnBanner.js) once its art is in
  const [turnBanner, setTurnBanner] = useState(0);
  useEffect(() => {
    if (!myTurn || solo) return;
    audio.sfx('yourTurn');
    if (bootArtReady() && !reducedMotion()) setTurnBanner((n) => n + 1);
  }, [myTurn]);
  // the 本局信息 dialog never outlives the turn it was opened in: a turn change (a pick, a skip, a turn that ran out, an
  // AI pick) or my pick closes it, so whoever's turn begins sees the draft
  const turnKey = `${draft.turnPid || ''}|${myPick || ''}`;
  useEffect(() => { setInfoOpen(false); }, [turnKey]);

  // one countdown (user playtest #4 item 4): the current turn's — m.public.deadline, the same clock as the picker's row
  const clock = solo ? null : draftClock(pub);
  // the highlighted band is what a turn that runs out takes (Match.timeoutBand): report every change before my pick
  const timed = !solo && !!pub?.draft && !pub.draft.untimed;
  const focusSent = useRef(null);
  useEffect(() => {
    // (a spectator seat — community report #26 — is in no draft order: it never reports)
    if (!timed || myPick || !sel || focusSent.current === sel || !draft.order.includes(myId)) return;
    focusSent.current = sel;
    act('g.bandFocus', { bandId: sel }, { sfx: false, quiet: true });
  }, [sel, timed, myPick]);

  // what a timeout gives me: the highlighted band while free, else the default (never 队友已选 — match/phases.js timeoutBand)
  const autoId = autoPickBand(sel, { bands, taken, myPick, defaultId });
  const autoName = (autoId && gd.band(autoId)?.name) || gd.band(defaultId)?.name || tName('华法琳');

  const band = sel ? gd.band(sel) : null;
  const selTaken = !!band && taken.has(band.bandId);
  const confirm = async () => {
    if (!band || busy || !myTurn || selTaken) return;
    setBusy('pick');
    await actions.band(band.bandId);
    setBusy(null);
  };
  const skip = async () => {
    if (busy || !canSkip) return;
    setBusy('skip');
    if (await actions.bandSkip()) setSkipped(true);
    setBusy(null);
  };
  const turnName = players.find((p) => p.playerId === draft.turnPid)?.name;
  useTicker(clock ? 250 : 0);
  // the picker's row shows the step header's number (both read the one turn deadline)
  const turnSecs = clock ? secondsLeft(clock.deadline) : null;
  const turnLen = Number(pub?.draft?.turnSeconds) > 0 ? Math.round(pub.draft.turnSeconds) : null;
  // 本局信息: the briefing's blocks (built only while the dialog is open) and the draft's state under it
  const info = infoOpen ? matchInfoModel(pub, { bonds: gd.list('bonds'), chess: gd.chess, mode, priv, diyData: { chess: data.get('chess'), backups: data.get('backups') } }) : null;
  const infoStatus = infoOpen ? draftInfoStatus({ myPick, pickName: myPick ? gd.band(myPick)?.name : null, myTurn, turnName, secs: turnSecs,
    waiting: !solo && !draft.done }) : null;

  return html`<div class="screen draft">
    <div class="brief__bg" aria-hidden="true"></div>
    <${StepHeader} step=${2} of=${2} title=${t('选择策略')} micro="STRATEGY // BAND CHECK" pub=${clock ? { ...pub, deadline: clock.deadline } : { ...pub, deadline: 0 }}
      total=${clock ? clock.total : null} onExit=${() => setExit(true)} />
    <main class="draft__main">
      <aside class="draft-order">
        <h3 class="brief-h"><span>${solo ? t('独立模拟') : t('决策顺序')}</span><${MicroLabel}>${solo ? 'FREE PICK' : 'RANDOM ORDER'}</${MicroLabel}></h3>
        <div class="draft-order__rows">
        ${(solo ? players.filter((p) => p.playerId === myId) : draft.order.map((pid) => players.find((p) => p.playerId === pid)).filter(Boolean)).map((p, i) => {
          const picked = draft.picks.get(p.playerId) || (p.playerId === myId ? myPick : p.bandId) || null;
          const cur = !picked && (solo || concurrent || draft.turnPid === p.playerId);
          return html`<${OrderRow} key=${p.playerId} p=${p} i=${i} picked=${picked} cur=${cur} self=${p.playerId === myId} solo=${solo}
            nc=${(!p.isBot && cardOf(p)?.bg) || null} art=${artOf(p)} card=${cardOf(p)} face=${faceOf(p)} gd=${gd} turnSecs=${turnSecs} />`;
        })}
        </div>
        ${concurrent ? html`<div class="draft-queue" data-testid="draft-queue">
          <span class="draft-queue__txt"><b>${t('所有博士同时选择')}</b><span>${t('还剩 {n} 人未选', { n: draft.order.filter((pid) => !draft.picks.has(pid)).length })}</span></span>
          <${Icon} name="hourglass" />
        </div>` : null}
        <${Button} variant="secondary" icon="search" block=${true} class="draft-order__info" data-testid="match-info-open"
          aria-haspopup="dialog" onClick=${() => setInfoOpen(true)}>${t('本局信息')}<//>
        ${canPlan ? html`<${Button} variant="secondary" icon="users" block=${true} class="draft-order__plan" data-testid="bond-plan-open"
          onClick=${() => setPlanOpen(true)}>${t('预选盟约')}<//>` : null}
        ${!solo ? html`<p class="draft-order__tip" data-testid="draft-tip">${draftTip({ timed, turnSeconds: turnLen, autoName: myPick ? null : autoName, selected: autoId === sel, concurrent })}</p>` : null}
      </aside>

      <section class="draft-grid" role="listbox" aria-label=${t('策略')}>
        ${bands.map((b) => {
          const who = pickers.get(b.bandId) || [];
          const isTaken = taken.has(b.bandId);
          const offNames = bandOffBonds(b, offBonds).map((id) => gd.bond(id)?.name || id); // 本局禁用 (still selectable)
          return html`<button key=${b.bandId} type="button" role="option" aria-selected=${sel === b.bandId ? 'true' : 'false'} data-band=${b.bandId}
              aria-disabled=${isTaken ? 'true' : 'false'} title=${isTaken ? t('队友已选') : offNames.length ? bandOffLine(offNames) : undefined}
              class=${cx('dband', sel === b.bandId && 'is-sel', myPick === b.bandId && 'is-mine', isTaken && 'is-taken', offNames.length && 'is-off')} onClick=${() => { setSel(b.bandId); audio.sfx('tab', { volume: 0.5 }); }}>
            <${BandIcon} bandId=${b.bandId} size="lg" />
            <span class="dband__name">${b.name}</span>
            <span class="dband__lp num"><i></i>${b.totalHp}</span>
            <${BandOffTag} names=${offNames} />
            ${who.length ? html`<span class="dband__who">${who.slice(0, 4).map((p) => html`<${PlayerAvatar} key=${p.playerId} player=${p} size="sm" />`)}</span>` : null}
            ${isTaken ? html`<span class="dband__taken">${t('队友已选')}</span>` : null}
          </button>`;
        })}
      </section>

      <aside class="draft-detail brackets">
        ${band ? html`
          <div class="draft-detail__art">
            <${BandIcon} bandId=${band.bandId} size="xl" />
          </div>
          <div class="draft-detail__hp"><span>${t('初始生命值')}</span><${LpTower} value=${band.totalHp} size="lg" /></div>
          <h2 class="draft-detail__name">${band.name}</h2>
          <${BandOffNote} names=${bandOffBonds(band, offBonds).map((id) => gd.bond(id)?.name || id)} />
          <div class="draft-detail__eff">
            <${MicroLabel} tone="mint">EFFECT</${MicroLabel}>
            <b>${band.effectName || ''}</b>
            <${RichText} as="p" text=${band.descRaw || band.desc} class="draft-detail__desc" />
          </div>` : html`<p class="t-dim">${t('选择一个策略查看详情')}</p>`}
        <div class="draft-detail__actions">
          ${myPick ? html`<p class="draft-detail__status t-mint"><${Icon} name="check" />${t('已选择「{name}」', { name: gd.band(myPick)?.name || '' })}${!solo && !draft.done ? t('，等待其他博士') : ''}</p>`
            : selTaken ? html`<p class="draft-detail__status draft-detail__status--taken"><${Icon} name="close" />${t('队友已选，请选择其他策略')}</p>`
            : !myTurn ? html`<p class="draft-detail__status"><${Icon} name="hourglass" />${turnName ? t('{turnName} 正在决策…', { turnName }) : t('等待轮到你')}</p>` : null}
          <div class="draft-detail__btns">
            ${!solo ? html`<${Button} variant="secondary" size="lg" icon="chevrons" disabled=${!canSkip} loading=${busy === 'skip'} onClick=${skip}
              title=${skipsLeft > 0 ? t('跳过本轮，稍后再选') : t('跳过次数已用完')}>${t('跳过')}${skipsLeft > 0 ? '' : t('（已用）')}<//>` : null}
            <${Button} variant="primary" size="lg" icon="check" disabled=${!myTurn || !band || selTaken} loading=${busy === 'pick'} onClick=${confirm}>${selTaken ? t('队友已选') : t('确认选择')}<//>
          </div>
        </div>
      </aside>
    </main>
    <${BondPlanPicker} open=${planOpen && canPlan} onClose=${() => setPlanOpen(false)} bonds=${planBonds} value=${myPlan}
      holders=${bondPlanHolders(players, myId)} off=${offBonds} busy=${planBusy} onPick=${pickPlan} />
    <${ExitModal} open=${exit} onClose=${() => setExit(false)} solo=${solo} />
    <${MatchInfoDialog} open=${infoOpen} onClose=${() => setInfoOpen(false)} model=${info}
      enemies=${infoOpen ? html`<${MatchEnemies} pub=${pub} gd=${gd} />` : null}
      status=${infoStatus ? html`<span class=${cx('minfo-dlg__turn', `is-${infoStatus.tone}`)}>
        <${Icon} name=${infoStatus.tone === 'mint' ? 'check' : 'hourglass'} />${infoStatus.text}${infoStatus.secs != null ? html`<b class="num">${infoStatus.secs}s</b>` : null}
      </span>` : null} />
    ${turnBanner ? html`<${TurnBanner} key=${turnBanner} onDone=${() => setTurnBanner(0)} />` : null}
  </div>`;
}
