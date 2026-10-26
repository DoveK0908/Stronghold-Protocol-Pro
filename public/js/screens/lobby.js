// Lobby screen — a hub (2026-10-14: the lobby / room / 干员调配 design by 雨千代chiyo, adopted by the owner with this
// fork's own features kept): an original backdrop (ui/hubBackdrop.js: generated night scenes or the player's own
// picture / video, kept in the browser) with the game's dot-matrix emblem in the middle; a left column (成就统计 ·
// 密钥加入 · tips · the feedback group and the design credit), a right column (公告 · S.W.E.E.P.报告 (screens/sweep.js) ·
// 干员调配) and three big entries at the bottom right: 独立模拟 opens 选择模拟协议 (difficulty, create), 同盟模拟
// opens 选择同盟方式 (create, join with a 同盟密钥 or 观战, 多人匹配), 多人匹配 opens 选择模拟协议 for the public queue
// (queue.join → queue.state: 搜寻中, 确认入场, 搜寻成功 — ui/matchmaking.js QueueFlow). Joining a room whose match has
// started goes back to this browser's own seat in it, else offers its spectator seat (joinRoom). There is no title screen
// (2026-10-15): ✎ beside the name chip renames (ui/nickname.js); the footer under the feedback group (HubFoot) carries
// the licence notice, the repository link and the version.
// Not carried over from the design's original deployment (the owner's decision of 2026-10-14): chat, accounts and
// friends, the cross-server room directory and public room list, 私密房间, 无限火力. Maintenance: the server's
// presence.state `maintenance` pauses new matches (the entries say so); an announcement's `banner` line is shown above
// the entries ahead of time.
// Official 0.3.2 / 0.3.3 (upstream/master, merged into this fork): the version chip in the top bar (ui/versionPicker.js
// VersionSwitch — this browser's choice, its data loaded and checked by content.js), 选择模拟协议 offering the
// difficulties of the version shown (versions.js offeredDifficulties / fallbackDifficulty: the remembered one, or the
// server's fallback when that version lacks it), 创建同盟 / 独立模拟 creating the room in it (room.create `version`),
// the 「不限时」 pref (lobby.soloUnlimited → room.create `soloUnlimited`) and the 成就统计 card — its own window
// (screens/stats.js AchievementDialog) counting this browser's records of the season shown — as the lobby's only
// statistics entry.
//
// Difficulty descriptions come from data/config.json `modes[modeId]` when present, else from the
// official act2autochess `modeDataDict` texts embedded below (desc + effectDescList), so the
// screen is complete before data is generated. Rounds: solo 标准 = 9, everything else 14 (+R15
// hidden core on 险境+), per research 00-INDEX §2. Battlefield pool (`modes[].stages`): 标准 always
// plays 战场#01, 险境 draws one of 8, 绝境 / 终极 one of 7 (m01 excluded).
// Texts go through t() (docs/I18N.md); the module-level tables hold msgids (N_) translated where they are shown, the
// config.json mode texts come localized from data.js.

import { LobbyMusicPanel } from '../ui/lobbyMusicPanel.js';
import { LobbyMusicButton } from '../ui/lobbyMusic.js';
import { Emblem } from '../ui/emblem.js';
import { useHubBackdrop, HubBackdrop, HubRadar, BackdropSettings, BackdropGlyph, backdropTheme } from '../ui/hubBackdrop.js';
import { ResumeMatchButton, resumeLocalMatch } from '../ui/resumeMatch.js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { DIFFICULTIES, DIFFICULTY_NAMES, DIFFICULTY_COLORS, ROOM_CODE_LEN, MAX_SEATS, MAX_SPECTATORS, modeIdFor, ERR, APP_VERSION, DEV_BUILD } from '../../../shared/constants.js';
import { html, Button, Icon, MicroLabel, Modal, TextField, PingPill, Tooltip, Spinner, DifficultyIcon, confirmDialog } from '../ui/components.js';
import { Sprite, Img } from '../ui/gameComponents.js';
import { uiUrl } from '../ui/assetUrls.js';
import { peekStatsRecords, trophyMedalOf, aggregateStats, recordsOfSeason } from '../ui/stats.js';
import { levelProgress, levelOf } from './settle.js';
import { AnnouncementBoard, announcementRevision, announcementDismissed, dismissAnnouncement, announcementBanner, parseAnnouncements } from '../ui/announcements.js';
import { ServerStatusModal } from '../ui/serverStatus.js';
import { LobbyFeedback } from '../ui/lobbyFeedback.js';
import { FeedbackBoard } from '../ui/feedbackBoard.js';
import { SiteBoards } from '../ui/siteBoards.js';
import { toast, toastError } from '../ui/toasts.js';
import { GuideButton, openGuide } from '../ui/guide.js';
import { AchievementDialog, useStatsOpen } from './stats.js';
import { MeCard, MyInfoDialog } from '../ui/myInfo.js';
import { claimAvatar } from '../ui/customAvatar.js';
import { claimNamecard } from '../ui/customNamecard.js';
import { SettingsButton } from '../ui/settings.js';
import { PwaInstallButton, FullscreenButton, fullscreen, reducedMotion, detectFeatures, useMediaQuery, SHORT_SCREEN_QUERY } from '../ui/device.js';
import { VersionSwitch } from '../ui/versionPicker.js';
import { contentSet, retryContentSet } from '../content.js';
import { DEFAULT_VERSION, lobbyVersion, offeredDifficulties, fallbackDifficulty, seasonOf, soloTimedOf, versionLabel } from '../versions.js';
import { LoadoutButton } from './loadout.js';
import { SweepReport } from './sweep.js';
import { ProtocolScene } from '../ui/protocolScene.js';
import { RadarScene, CreateArt, JoinArt } from '../ui/matchFlow.js';
import { net, identity } from '../net.js';
import { store, useStore, shallowEqual, loadPref, savePref } from '../store.js';
import { data, getConfig, getMode, getStage, useData } from '../data.js';
import { QueueFlow, queueActive } from '../ui/matchmaking.js';
import { queueCancellation } from '../queueCancellation.js';
import { TestMark } from '../ui/testConsole.js';
import { t, tc, N_ } from '../../../shared/i18n.js';
// 开房默认 (ui/roomDefaults.js): the personal default behind every 实验性选项 switch
import { roomDefaultsExperimental, roomDefaultsStore } from '../ui/roomDefaults.js';

/** Official mode texts (activity_table act2autochess.modeDataDict), fallback when config.json is absent. */
export const MODE_TEXT = {
  single: {
    FUNNY: { code: 'AC-1', desc: N_('时长较短的模拟训练'), effects: [N_('可以快速完成作战'), N_('常规奖励')] },
    NORMAL: { code: 'AC-2', desc: N_('敌方攻击强度较高的模拟训练'), effects: [N_('可使用盟约数增加'), N_('大幅增加奖励')] },
    HARD: { code: 'AC-3', desc: N_('敌方攻击强度极高的模拟训练'), effects: [N_('作战环境困难'), N_('出现更加危险的敌人')] },
    ABYSS: { code: 'AC-4', desc: N_('敌方攻击强度到达极限的模拟训练'), effects: [N_('作战环境无比困难'), N_('出现极度危险的敌人')] },
  },
  multi: {
    FUNNY: { code: 'AC-1', desc: N_('敌方攻击强度较低的模拟训练'), effects: [N_('作战环境较为温和'), N_('常规奖励')] },
    NORMAL: { code: 'AC-2', desc: N_('敌方攻击强度较高的模拟训练'), effects: [N_('可使用盟约数增加'), N_('大幅增加奖励')] },
    HARD: { code: 'AC-3', desc: N_('敌方攻击强度极高的模拟训练'), effects: [N_('作战环境困难'), N_('出现更加危险的敌人')] },
    ABYSS: { code: 'AC-4', desc: N_('敌方攻击强度到达极限的模拟训练'), effects: [N_('作战环境无比困难'), N_('出现极度危险的敌人')] },
  },
};

/** Battlefield pool per difficulty when config.json is absent (the modes' `stages` lists; same for solo and co-op). */
export const STAGE_POOL = { FUNNY: ['act1autochess_m01'], NORMAL: 8, HARD: 7, ABYSS: 7 };

/**
 * Display name of a stage: stages.json when it is loaded, else derived from the id (act1 m0N → 战场#0N, act2 m0N → 战场#0(N+4)).
 * From the data name only its 战场#NN part (with a (上半) / (下半) mark) — 'Battlefield #NN (First Half)' in English.
 * @param {string} id e.g. 'act1autochess_m01'
 */
export function stageLabel(id) {
  const rec = getStage(id);
  if (rec && typeof rec.name === 'string' && rec.name) {
    const m = rec.name.match(/^(.*?#\d+(?:\s*[(（][^)）]*[)）])?)/);
    return m ? m[1] : rec.name.split(/\s+/)[0];
  }
  const m = String(id || '').match(/^act(\d)autochess_m(\d+)$/);
  return m ? t('战场#{no}', { no: String(Number(m[2]) + (m[1] === '2' ? 4 : 0)).padStart(2, '0') }) : '';
}

/**
 * The descriptive tail of a stage name after its 战场#NN mark: '战场#05(上半) 涨潮/特制水上平台' → '涨潮/特制水上平台'.
 * Empty when the record has no extra description.
 * @param {string} id
 */
export function stageSuffix(id) {
  const rec = getStage(id);
  if (!rec || typeof rec.name !== 'string') return '';
  return rec.name.replace(/^(.*?#\d+(?:\s*[(（][^)）]*[)）])?)/, '').trim();
}

/**
 * The battlefield note of a difficulty (official wording): a single-stage pool is fixed ("战场固定为 战场#01"), a larger
 * one is drawn at random ("战场随机（共8张）").
 * @param {string[] | number | null | undefined} stages the mode's `stages` list (or a count)
 * @returns {string} '' when unknown
 */
export function stageNote(stages) {
  if (Array.isArray(stages)) {
    const ids = stages.filter((s) => typeof s === 'string' && s);
    if (ids.length === 1) { const name = stageLabel(ids[0]); return name ? t('战场固定为 {name}', { name }) : t('战场固定'); }
    return ids.length > 1 ? t('战场随机（共{n}张）', { n: ids.length }) : '';
  }
  return Number.isInteger(stages) && stages > 1 ? t('战场随机（共{stages}张）', { stages }) : '';
}

const MODE_CARDS = [
  {
    id: 'solo', name: N_('独立模拟'), en: 'SOLO SIMULATION', icon: 'user',
    desc: N_('独自调配资金与干员，以自己的节奏完成整场模拟。'),
    points: [N_('1 名博士'), N_('休整期与机变阶段不限时')],
  },
  {
    id: 'coop', name: N_('同盟模拟'), en: 'ALLIANCE SIMULATION', icon: 'users',
    desc: N_('与至多 {n} 名博士组成同盟，调配干员、联防协作抵御敌潮。'), params: { n: MAX_SEATS - 1 },
    points: [N_('1–{n} 名博士 · 可由 AI 队友补位'), N_('联防阶段 · 最终攻势合并生命值')], pointParams: { n: MAX_SEATS },
    // the hub's line above the entry on a short screen, where the whole line is wider than the entry (§35.51)
    pointShort: N_('1–{n} 名博士'),
  },
  {
    id: 'match', name: N_('多人匹配'), en: 'PUBLIC MATCHMAKING', icon: 'search',
    desc: N_('寻找相同难度的博士，确认后组成四人同盟；也可从好友房组队匹配。'),
    points: [N_('4 名真人 · 不自动补 AI'), N_('跟随房间选项 · 全员确认自动开局')],
  },
];

/**
 * Text for a difficulty card, preferring data/config.json.
 * @param {'solo'|'coop'} roomMode
 * @param {string} difficulty
 * @returns {{ code: string, desc: string, effects: string[], rounds: number, hidden: boolean, stageNote: string }}
 */
export function difficultyInfo(roomMode, difficulty) {
  const fallback = MODE_TEXT[roomMode === 'solo' ? 'single' : 'multi'][difficulty] || { code: '', desc: '', effects: [] };
  // modeIdFor() lower-cases the difficulty: never call it with a value the server did not validate.
  const m = DIFFICULTIES.includes(difficulty) ? getMode(modeIdFor(roomMode, difficulty)) : null;
  const effects = Array.isArray(m?.effectDescList)
    ? m.effectDescList.map((e) => String(e).replace(/^[·•・･\s]+/, '')).filter(Boolean)
    : fallback.effects.map((e) => t(e));
  const rounds = Number.isFinite(m?.lastRound) ? m.lastRound : roomMode === 'solo' && difficulty === 'FUNNY' ? 9 : 14;
  return {
    code: typeof m?.code === 'string' ? m.code : fallback.code,
    desc: typeof m?.desc === 'string' ? m.desc : t(fallback.desc),
    effects,
    rounds,
    hidden: difficulty !== 'FUNNY',
    stageNote: stageNote(Array.isArray(m?.stages) && m.stages.length ? m.stages : STAGE_POOL[difficulty]),
  };
}

const CODE_RE = new RegExp(`^[A-Z0-9]{${ROOM_CODE_LEN}}$`);
/**
 * Normalise user input into a room code: accepts a pasted invite link (`…?room=ABCD`), keeps
 * upper-cased alphanumerics and clamps to the code length.
 * @param {string} v
 * @returns {string}
 */
export function normalizeCode(v) {
  let s = String(v ?? '');
  const m = s.match(/[?&]room=([A-Za-z0-9]+)/);
  if (m) s = m[1];
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LEN);
}

/**
 * A handler that Preact binds as `onClick=${fn}` receives the click EVENT as its first argument, and a default
 * parameter only applies to `undefined` — so `fn(c = code)` would normalise the event target into a nonsense code
 * (`String(el)` → `"[object HTMLElement]"` → "OBJE"). Only a string is ever a code; anything else falls back to the
 * input field. Returns null when neither yields a well-formed code.
 * @param {unknown} arg the argument a handler was called with
 * @param {string} field the current input-field value
 * @returns {string|null}
 */
export function codeArg(arg, field) {
  const k = normalizeCode(typeof arg === 'string' ? arg : field);
  return CODE_RE.test(k) ? k : null;
}

/**
 * Room code from a deep link query string (`?room=CODE`), or null when absent/malformed.
 * Accepts ROOM_CODE_LEN..ROOM_CODE_LEN+2 alphanumerics (the protocol's join limit).
 * @param {string} search e.g. location.search
 * @returns {string|null}
 */
export function parseRoomParam(search) {
  try {
    const raw = new URLSearchParams(search || '').get('room');
    if (!raw) return null;
    const code = raw.trim().toUpperCase();
    if (!/^[A-Z0-9]+$/.test(code)) return null;
    return code.length >= ROOM_CODE_LEN && code.length <= ROOM_CODE_LEN + 2 ? code : null;
  } catch {
    return null;
  }
}

/**
 * Join a room, or — when the server says it has started — go back to this browser's own seat in it (a page whose token
 * this one could not take over, identity.recoverable), else offer its read-only spectator seat.
 */
export async function joinRoom(code, { connection = net, confirm = confirmDialog, getState = store.get,
  localSeats = () => identity.recoverable(), resume = resumeLocalMatch } = {}) {
  const viewer = getState().me;
  const current = () => {
    const s = getState();
    return viewer.playerId != null && connection.status === 'online' && s.session.entered && !s.room && !queueActive(s.queue)
      && s.me.playerId === viewer.playerId && s.me.token === viewer.token;
  };
  if (!current()) return false;
  // a 测试房间 (DESIGN §34.8): the server refuses the first request (ERR.TEST_CONFIRM) and takes the retry with testAck
  const send = async (type) => {
    try {
      await connection.request(type, { code });
      return true;
    } catch (err) {
      if (err?.code !== ERR.TEST_CONFIRM) throw err;
      const text = type === 'room.spectate'
        ? t('这是测试房间，不计入任何记录。确认观战？')
        : t('这是测试房间，不计入任何记录。确认加入？');
      if (!await confirm({ title: t('测试'), text })) return false;
      await connection.request(type, { code, testAck: true });
      return true;
    }
  };
  try {
    return await send('room.join');
  } catch (err) {
    if (err?.code !== ERR.ROOM_STARTED) throw err;
    if (!current()) return false;
    // the seat of this match another (closed) page of this browser played: resume it instead of watching (the owner's
    // report of 2026-10-13); a seat a live page still holds stays there and the offer below follows
    const seat = localSeats().find((item) => item.code === code);
    if (seat && await resume(seat)) return true;
    if (!current()) return false;
    const accepted = await confirm({
      title: t('同盟已开始模拟'),
      text: t('同盟 {code} 已经开局，不能再加入博士席位。是否使用原密钥进入观战？', { code }),
      okText: t('观战'),
      cancelText: t('取消'),
      micro: 'SPECTATE STARTED ALLIANCE',
    });
    if (!accepted || !current()) return false;
    return await send('room.spectate');
  }
}

/** Recently joined/created co-op room codes (most recent first). */
export function recentRooms() {
  const list = loadPref('recentRooms', []);
  return Array.isArray(list) ? list.filter((c) => typeof c === 'string' && CODE_RE.test(c)).slice(0, 4) : [];
}

/** The codes of recentRooms() that were 测试房间 (测试, DESIGN §34.8). */
export function recentTestRooms() {
  const list = loadPref('recentTestRooms', []);
  return Array.isArray(list) ? list.filter((c) => typeof c === 'string' && CODE_RE.test(c)) : [];
}

/** @param {string} code @param {boolean} [test] the room is a 测试房间 (不计入战绩) */
export function rememberRoom(code, test = false) {
  if (!CODE_RE.test(code)) return;
  const recent = [code, ...recentRooms().filter((c) => c !== code)].slice(0, 4);
  const marks = recentTestRooms();
  savePref('recentTestRooms', recent.filter((c) => (c === code ? test : marks.includes(c))));
  savePref('recentRooms', recent);
}

/** The 观战 tooltip: MAX_SPECTATORS 0 = no cap (shared/constants.js). */
const spectateHint = () => (MAX_SPECTATORS > 0
  ? t('以观战者身份进入：不占博士席位，只能观看（每个同盟最多 {MAX_SPECTATORS} 名，模拟进行中也可进入）', { MAX_SPECTATORS })
  : t('以观战者身份进入：不占博士席位，只能观看（观战席不设人数上限），模拟进行中也可进入'));

const FALLBACK_TIPS = [
  N_('联合模拟在选择策略时可以进行一次跳过'),
  N_('调度中心即使冻结，依然可以主动刷新'),
  N_('两件同名装备可以合成一件更强力的装备'),
  N_('只有达成完美作战的队友可以进行联防'),
];
const TIP_ROTATE_MS = 5000; // matchingTipRotateInterval

/** Rotating tactical tips (config.json `tips`, weighted list of { tip, weight }). */
function TipsPanel() {
  const cfg = getConfig();
  const fallback = FALLBACK_TIPS.map((x) => t(x));
  const tips = Array.isArray(cfg?.tips)
    ? cfg.tips.map((x) => (typeof x === 'string' ? x : x?.tip)).filter((x) => typeof x === 'string' && x)
    : fallback;
  const list = tips.length ? tips : fallback;
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * list.length));
  // the rotation waits while the tip is pointed at or focused, and stays off with reduced motion (the arrows still turn it)
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held || reducedMotion()) return undefined;
    const id = setInterval(() => setIdx((i) => i + 1), TIP_ROTATE_MS);
    return () => clearInterval(id);
  }, [held]);
  const i = ((idx % list.length) + list.length) % list.length;
  return html`<div class="tips brackets" onPointerEnter=${() => setHeld(true)} onPointerLeave=${() => setHeld(false)}
      onFocusIn=${() => setHeld(true)} onFocusOut=${() => setHeld(false)}>
    <div class="tips__head">
      <${Icon} name="info" />
      <span>${t('作战提示')}</span>
      <${MicroLabel}>TACTICAL TIPS<//>
      <span class="tips__idx num">${String(i + 1).padStart(2, '0')}<span class="t-dim">/${String(list.length).padStart(2, '0')}</span></span>
      <button type="button" class="tips__nav" onClick=${() => setIdx(i - 1 + list.length)} aria-label=${t('上一条')}><${Icon} name="chevronLeft" /></button>
      <button type="button" class="tips__nav" onClick=${() => setIdx(i + 1)} aria-label=${t('下一条')}><${Icon} name="chevronRight" /></button>
    </div>
    <p key=${i} class="tips__text">${list[i]}</p>
  </div>`;
}

/**
 * 公告 in the right column: the newest notice's title and date, an unread dot; opens the board (ui/announcements.js).
 * Takes the place the design gave a public room list (not part of this server).
 */
function NoticeCard({ value, unread, status, onOpen }) {
  const entries = status === 'ready' ? parseAnnouncements(value) : null;
  const top = entries?.[0] || null;
  return html`<button type="button" class=${`hub-notice${unread ? ' is-unread' : ''}`} onClick=${onOpen} aria-haspopup="dialog"
      aria-label=${unread ? `${t('公告')} · ${t('有未读公告')}` : t('公告')}>
    <span class="hub-notice__head">
      <span class=${`hub-recruit__pulse${unread ? ' is-live' : ''}`} aria-hidden="true"></span>
      <span class="hub-notice__title">${t('公告')}</span><span class="hub-notice__en">NOTICE</span>
      ${unread ? html`<i class="lobby-dot" aria-hidden="true"></i>` : null}
      <span class="hub-notice__more">${t('查看')}<${Icon} name="chevronRight" /></span>
    </span>
    <span class="hub-notice__body">${top
      ? html`<b>${top.title}</b>${top.date ? html`<small class="num">${top.date}</small>` : null}`
      : html`<span class="t-dim">${status === 'ready' || status === 'missing' ? t('暂无公告') : status === 'error' ? t('公告加载失败，点击重试') : t('正在加载公告…')}</span>`}</span>
  </button>`;
}

/**
 * 全屏 / 退出全屏 in the top bar, styled like its neighbours; where the browser has no element fullscreen (iPhone) the
 * button stays and explains how to get a full screen there (ui/device.js FullscreenButton).
 */
function HubFullscreenButton() {
  const [on, setOn] = useState(() => fullscreen.active());
  const [ok] = useState(() => fullscreen.supported());
  useEffect(() => {
    const upd = () => setOn(fullscreen.active());
    document.addEventListener('fullscreenchange', upd);
    document.addEventListener('webkitfullscreenchange', upd);
    return () => { document.removeEventListener('fullscreenchange', upd); document.removeEventListener('webkitfullscreenchange', upd); };
  }, []);
  if (!ok) return html`<${FullscreenButton} class="hub-fs-btn hub-fs-btn--help" showUnavailable=${true} />`;
  const label = on ? t('退出全屏') : t('全屏');
  return html`<${Button} variant="secondary" size="sm" square=${true} icon=${on ? 'collapse' : 'expand'} class="hub-fs-btn"
    title=${label} aria-label=${label} aria-pressed=${on ? 'true' : 'false'} onClick=${() => fullscreen.toggle()} />`;
}

/** Crossed blades in a hexagon: the S.W.E.E.P. plate's glyph (original drawing). */
function SweepGlyph() {
  return html`<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path d="M16 2.5 27.7 9.2v13.6L16 29.5 4.3 22.8V9.2z" fill="none" stroke="currentColor" stroke-width="1.5" />
    <path d="M9 9l12.5 12.5M23 9 10.5 21.5" stroke="currentColor" stroke-width="2.2" />
    <path d="M19.2 23.8l4.6-4.6M8.2 19.2l4.6 4.6M21.6 21.6l2.2 2.2M10.4 21.6l-2.2 2.2" stroke="currentColor" stroke-width="1.8" />
  </svg>`;
}

/**
 * S.W.E.E.P.报告: opens the report (screens/sweep.js — 盟约报告 / 策略报告 / 敌方资料). `class` adds the call site's own
 * hook (upstream's `lobby-sweep`).
 */
function SweepPlate({ onClick, class: cls = '' }) {
  const klass = cls ? `hub-plate hub-plate--sweep lobby-sweep ${cls}` : 'hub-plate hub-plate--sweep lobby-sweep';
  return html`<button type="button" class=${klass} onClick=${onClick} title=${t('S.W.E.E.P.报告：盟约、策略与敌方资料')}>
    <span class="hub-plate__glyph"><${SweepGlyph} /></span>
    <span class="hub-plate__label">S.W.E.E.P.${t('报告')}</span>
    <span class="hub-plate__tag">REPORT</span>
  </button>`;
}

/**
 * One of the big entries at the bottom right. Two shapes, one component:
 * - the fork's group entry (`group` + `name` / `en` / `icon` / `badge` / `tone` / `note`): the line above it names the
 *   mode, the button carries its own icon, English name, name and count;
 * - upstream's mode card (`card` non-null, `onOpen`): the official rows of the event's hub — the card's first point
 *   (plus `timePoint`, the version's time rule on the solo card) above, and the `.mode-card` button that opens its
 *   dialog through `onOpen(card.id)`.
 */
export function HubEntry({ group = null, name = null, en = null, icon = 'user', badge = null, tone = 'mint', note = null, onClick = null,
  disabled = false, card = null, onOpen = null, timePoint = null, timeShort = null }) {
  if (card) {
    const line = timePoint
      ? html`<span class="hub-entry__long">${t(card.points[0], card.pointParams)} · ${t(timePoint)}</span><span class="hub-entry__short">${timeShort ? t(timeShort) : t(card.points[0], card.pointParams)}</span>`
      : card.pointShort
        ? html`<span class="hub-entry__long">${t(card.points[0], card.pointParams)}</span><span class="hub-entry__short">${t(card.pointShort, card.pointParams)}</span>`
        : t(card.points[0], card.pointParams);
    return html`<div class="hub-entry-wrap">
      <span class="hub-entry__group"><${Icon} name=${card.icon} />${line}</span>
      <button type="button" class=${`mode-card hub-entry hub-entry--${card.id}`} data-mode=${card.id} disabled=${disabled}
          onClick=${() => onOpen?.(card.id)} title=${t(card.desc, card.params)}>
        <span class="hub-entry__icon" aria-hidden="true"><${Icon} name=${card.icon} /></span>
        <span class="hub-entry__en">${card.en}</span>
        <span class="hub-entry__name">${t(card.name)}</span>
        <span class="hub-entry__corner" aria-hidden="true"></span>
      </button>
    </div>`;
  }
  return html`<div class="hub-entry-wrap">
    ${group ? html`<span class="hub-entry__group"><${Icon} name=${group.icon} />${group.label}</span>` : html`<span class="hub-entry__group hub-entry__group--blank"></span>`}
    <button type="button" class=${`hub-entry hub-entry--${tone}`} onClick=${onClick} disabled=${disabled}>
      <span class="hub-entry__icon"><${Icon} name=${icon} /></span>
      <span class="hub-entry__en">${en}</span>
      <span class="hub-entry__name">${name}${badge ? html`<span class="mode-beta">${badge}</span>` : null}</span>
      ${note ? html`<span class="hub-entry__count">${note}</span>` : null}
      <span class="hub-entry__corner" aria-hidden="true"></span>
    </button>
  </div>`;
}

/** A small tile of the side column; `class` adds the call site's own hook (upstream's `hub-tile--key`). */
function HubTile({ icon, label, en, onClick, children, class: cls = '' }) {
  const klass = cls ? `hub-tile ${cls}` : 'hub-tile';
  return html`<button type="button" class=${klass} onClick=${onClick}>
    <span class="hub-tile__icon"><${Icon} name=${icon} /></span>
    <span class="hub-tile__text"><span class="hub-tile__label">${label}</span><span class="hub-tile__en">${en}</span></span>
    ${children}
  </button>`;
}

/** Shared frame of the hub's small dialogs (密钥加入, 大厅背景). */
function HubDialog({ open, micro, title, onClose, wide = false, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    addEventListener('keydown', onKey);
    document.body.classList.add('hub-dialog-open');
    return () => { removeEventListener('keydown', onKey); document.body.classList.remove('hub-dialog-open'); };
  }, [open]);
  if (!open) return null;
  return html`<div class="modal hub-dialog" role="presentation" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
    <div class=${`modal__box hub-dialog__box brackets${wide ? ' hub-dialog__box--wide' : ''}`} role="dialog" aria-modal="true">
      <div class="modal__stripe" aria-hidden="true"></div>
      <header class="hub-dialog__head">
        <${MicroLabel} tone="mint">${micro}<//>
        <div class="hub-dialog__title-row">
          <h2 class="modal__title">${title}</h2>
          <button type="button" class="mm-modal__close" onClick=${onClose} aria-label=${t('关闭')}><${Icon} name="close" /></button>
        </div>
      </header>
      <div class="hub-dialog__body">${children}</div>
    </div>
  </div>`;
}

/** The hand-drawn ring of the 已选定 stamp (two loose strokes). */
function StampRing() {
  return html`<svg class="pcard__ring" viewBox="0 0 120 100" aria-hidden="true" focusable="false">
    <path pathLength="1" d="M18 62C6 34 34 8 70 10c34 2 48 30 38 54-10 24-46 32-72 22C20 80 10 66 16 50" />
    <path pathLength="1" d="M30 20c22-14 62-12 78 10 12 18 4 44-16 54" />
  </svg>`;
}
/**
 * A difficulty's rounds (+ 隐秘核心) and battlefields: on its card's meta line, and in the brief beside it.
 * (upstream/master's DifficultyRounds / DifficultyCard: the `.diff-card` hook and the 已选定 stamp's `is-selected`)
 */
function DifficultyRounds({ info }) {
  return [
    html`<span key="r"><b class="num">${info.rounds}</b> ${tc('rounds', '回合')}${info.hidden ? html` ${t('+ 隐秘核心')}` : null}</span>`,
    info.stageNote ? html`<span key="s" class="pcard__stage"><${Icon} name="rook" />${info.stageNote}</span>` : null,
  ];
}

/**
 * One difficulty of 选择模拟协议: name, text, effects, then code / rounds / 隐秘核心 / battlefields; the selected one slides
 * out with a glow in the difficulty's colour and the 已选定 stamp. `disabled`: shown, not chosen (a room's other doctors).
 */
function DifficultyCard({ roomMode, difficulty, selected, onSelect, disabled = false }) {
  const info = difficultyInfo(roomMode, difficulty);
  return html`<button type="button" class=${`pcard diff-card${selected ? ' is-on is-selected' : ''}`} style=${`--d-color:${DIFFICULTY_COLORS[difficulty]}`}
      disabled=${disabled} onClick=${() => onSelect(difficulty)} aria-pressed=${selected ? 'true' : 'false'}>
    <span class="pcard__glow" aria-hidden="true"></span>
    <span class="pcard__head">
      <${DifficultyIcon} difficulty=${difficulty} class="pcard__glyph" />
      <span class="pcard__name">${t(DIFFICULTY_NAMES[difficulty])}</span>
    </span>
    <span class="pcard__desc">${info.desc}</span>
    <span class="pcard__effects">${info.effects.map((e) => html`<span key=${e}>${e}</span>`)}</span>
    <span class="pcard__meta">
      ${info.code ? html`<span class="num">${info.code}</span>` : null}
      <${DifficultyRounds} info=${info} />
    </span>
    <span class="pcard__stamp" aria-hidden="true"><${StampRing} /><span class="pcard__tick"><${Icon} name="check" /></span><span class="pcard__ok">${t('已选定')}</span></span>
  </button>`;
}

/**
 * How much 选择模拟协议's cards show on a screen taller than 520 px: the first level at which they fit their column —
 * 'full' (the name, the description, the effects, the rounds), 'brief' (the description only in the brief at the left),
 * 'names' (a line each, as on a phone; the brief adds the chosen difficulty's effects and rounds). A list that still does
 * not fit scrolls. `overflows(level)` lays the cards out at that level and says whether they spill.
 */
export const CARD_FIT_LEVELS = ['full', 'brief', 'names'];
export function pickCardFit(overflows) {
  return CARD_FIT_LEVELS.find((level) => !overflows(level)) || CARD_FIT_LEVELS[CARD_FIT_LEVELS.length - 1];
}

/**
 * Sets 选择模拟协议's `data-fit` (pickCardFit; css/screens/lobby.css) before the screen paints: at every render, when the
 * list's box changes (the window, 文字大小, the button) and whenever a font finishes loading. A level only changes what
 * the cards show, never the list's box, so measuring cannot loop.
 */
function ProtoFit() {
  const ref = useRef(null);
  const fit = () => {
    const body = ref.current?.closest('.proto__body');
    const list = body?.querySelector('.proto-list');
    if (!list) return;
    body.dataset.fit = pickCardFit((level) => { body.dataset.fit = level; return list.scrollHeight > list.clientHeight + 1; });
  };
  useLayoutEffect(fit);
  useLayoutEffect(() => {
    const list = ref.current?.closest('.proto__body')?.querySelector('.proto-list');
    if (!list) return undefined;
    let live = true;
    const refit = () => { if (live) fit(); };
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(refit) : null;
    ro?.observe(list);
    const fonts = document.fonts;
    fonts?.ready?.then(refit);
    fonts?.addEventListener?.('loadingdone', refit);
    return () => { live = false; ro?.disconnect(); fonts?.removeEventListener?.('loadingdone', refit); };
  }, []);
  return html`<i ref=${ref} class="proto__fit" hidden></i>`;
}

/** 正在加入同盟…: bottom left while the room is being opened, a light running along the bottom edge (css tr-join). */
function JoinLine({ text }) {
  return html`<div class="tr-join" role="status"><span class="tr-join__mark" aria-hidden="true"></span>${text}<span class="tr-join__dots" aria-hidden="true"></span></div>`;
}

/**
 * One difficulty of 选择模拟协议 (screens/room.js imports it for the host's difficulty change). The card itself is
 * DifficultyCard: upstream's `.diff-card` / `is-selected` hooks and the fork's `.pcard` stamp are the same drawing, so
 * there is one implementation rather than two lookalikes.
 */
export const ProtoCard = DifficultyCard;

/** 多人匹配's rules (the former lobby's 匹配说明, ui/matchmaking.js wording). */
function MatchRules() {
  const [open, setOpen] = useState(false);
  return html`<${Button} variant="ghost" size="sm" icon="info" class="matchmaking__help" onClick=${() => setOpen(true)}>${t('匹配说明')}<//>
    ${open ? html`<div class="modal hub-dialog" role="presentation" onMouseDown=${(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div class="modal__box hub-dialog__box brackets" role="dialog" aria-modal="true" aria-label=${t('多人匹配规则')}>
        <div class="modal__stripe" aria-hidden="true"></div>
        <header class="hub-dialog__head"><${MicroLabel} tone="mint">MATCHMAKING RULES<//>
          <div class="hub-dialog__title-row"><h2 class="modal__title">${t('多人匹配规则')}</h2>
            <button type="button" class="mm-modal__close" onClick=${() => setOpen(false)} aria-label=${t('关闭')}><${Icon} name="close" /></button></div>
        </header>
        <div class="hub-dialog__body">
          <p class="modal__text">${t('{n} 名真人按相同人数模式和难度匹配，不自动补 AI；好友小队保持整队。', { n: MAX_SEATS })}</p>
          <p class="modal__text">${t('集齐后有 30 秒确认时间，全部确认后直接开局。未完成确认者不自动回队。最多等待 10 分钟，可随时取消。')}</p>
          <p class="modal__text">${t('好友小队沿用房间的实验性选项，单人匹配跟随所加入房间。四名单人组局时，复活和禁用共享卡池默认关闭。')}</p>
        </div>
      </div>
    </div>` : null}`;
}

/**
 * 选择模拟协议 (the design's second screen after 独立模拟; also 多人匹配's and the room's difficulty change): the project's
 * Modal (focus trap, Esc, focus restored) styled to fill the screen — the selected difficulty's official picture
 * (ui/protocolScene.js) and brief at the left, the difficulty cards down the right with the 已选定 stamp, the hint and
 * the start button below them.
 *
 * The fork's inputs keep working on top of upstream's: `card` + `purpose` pick the mode when `roomMode` is absent
 * (`purpose: 'match'` is the public queue), `maint` pauses new rooms, `queue`/`onQueue` hand the queue to QueueFlow while
 * a ticket is live, and `chained` marks the screen opened straight after 选择同盟方式. Upstream's inputs: `action` /
 * `hint` replace the button's label and the hint (the room's 确认) and `readOnly` shows the cards without choosing them
 * (a room's other doctors); `difficulties` / `loading` / `failed` follow the version shown and `soloTime` is the 「不限时」
 * switch of a timed solo.
 */
export function ProtocolSelect({ roomMode = null, card = null, purpose = 'create', difficulty, onDifficulty, onClose, online = true,
  maint = false, busy = null, queue = null, onCreate, onQueue = null, chained = false, testMode = false, asTest = false,
  onTest = () => {}, action = null, hint = null, readOnly = false, difficulties = DIFFICULTIES, loading = false, failed = false,
  soloTime = null }) {
  const match = purpose === 'match';
  const mode = roomMode || (match ? 'coop' : card?.id === 'solo' ? 'solo' : 'coop');
  const queued = match && queueActive(queue);
  const d = queued && DIFFICULTIES.includes(queue.difficulty) ? queue.difficulty : difficulty;
  const info = difficultyInfo(mode, d);
  const modeCard = card || MODE_CARDS.find((c) => c.id === mode) || MODE_CARDS[0];
  const working = busy === 'create' || busy === 'queue';
  const label = action || (maint ? t('维护中 · 暂停开局') : match ? t('开始多人匹配') : mode === 'solo' ? t('开始独立模拟') : t('创建同盟'));
  return html`<${Modal} open=${true} onClose=${onClose} class=${`proto${chained ? ' is-chained' : ''}`} veilClass="proto-veil">
    <div class="proto__body" style=${`--d-color:${DIFFICULTY_COLORS[d]}`} data-difficulty=${d} data-mode=${mode} data-purpose=${purpose}>
      <div class="proto__bg" aria-hidden="true"></div>
      <${ProtoFit} />
      <header class="proto-top">
        <${BackPlate} onClick=${onClose} class="proto__back" />
        <div class="proto-title">
          <h2 class="modal__title">${t('选择模拟协议')}</h2>
          <span class="proto-title__mode"><${Icon} name=${modeCard.icon} />${t(modeCard.name)}<i>${modeCard.en}</i></span>
        </div>
      </header>
      <div class="proto-body">
        <section class="proto-stage">
          <div key=${d} class="proto__pic"><${ProtocolArt} difficulty=${d} /></div>
          <div class="proto-brief">
            <span class="proto-brief__code num">${info.code}</span>
            <b class="proto-brief__name">${t(DIFFICULTY_NAMES[d])}</b>
            <p>${info.desc}</p>
            <div class="proto-brief__more" data-testid="proto-brief-more">
              <span class="proto-brief__effects">${info.effects.map((e) => html`<span key=${e}>${e}</span>`)}</span>
              <span class="proto-brief__meta"><${DifficultyRounds} info=${info} /></span>
            </div>
          </div>
        </section>
        <section class="proto-side">
          ${queued ? html`<div class="proto-list__wait proto-queued"><${QueueFlow} queue=${queue} difficulty=${d} online=${online} /></div>`
            : html`<div class="proto-list" role="group" aria-label=${t('模拟难度')} aria-busy=${loading ? 'true' : 'false'}>
            ${failed ? html`<p class="proto-list__wait is-failed" data-testid="proto-failed"><${Icon} name="warn" />${t('版本数据校验失败')}
                <${Button} size="sm" variant="secondary" data-testid="proto-retry" onClick=${retryContentSet}>${t('重试')}<//></p>`
              : loading ? html`<p class="proto-list__wait" data-testid="proto-loading"><${Spinner} size="sm" />${t('正在载入版本数据…')}</p>` : null}
            ${difficulties.map((x) => html`<${DifficultyCard} key=${x} roomMode=${mode} difficulty=${x} selected=${d === x}
              onSelect=${onDifficulty} disabled=${readOnly || loading} />`)}
          </div>`}
          ${queued ? null : readOnly ? html`<div class="proto-foot proto-foot--ro">
            <p class="proto-hint proto-hint--ro"><${Icon} name="info" />${hint || t('由创建者选择')}</p>
          </div>` : html`<div class="proto-foot create-box">
            ${soloTime ? html`<label class="create-box__test" data-testid="solo-unlimited">
              <input type="checkbox" role="switch" checked=${soloTime.on} onChange=${(e) => soloTime.onToggle(e.target.checked)} />
              <span>${t('不限时')}</span>
              <em class="t-dim">${t('关闭本局休整与机变的计时。官方为休整期每轮 300 秒、机变 150 秒。')}</em>
            </label>` : null}
            ${testMode ? html`<label class="create-box__test" data-testid="create-test">
              <input type="checkbox" checked=${asTest} onChange=${(e) => onTest(e.target.checked)} />
              <span>${t('测试房间')}</span>
              <em class="t-dim">${t('不计入战绩。房间会标明「测试」，只有房主能使用测试指令。')}</em>
            </label>` : null}
            ${match ? html`<div class="proto-opts"><span class="proto-mode-chip"><${Icon} name="search" />${t('多人匹配')}</span><${MatchRules} /></div>` : null}
            <p class="proto-hint">
              ${online
                ? hint ?? (maint ? t('服务器即将维护，暂停开启新的模拟')
                  : match ? t('{n} 名真人 · 不自动补 AI · 集齐后 30 秒内确认入场', { n: MAX_SEATS })
                  : mode === 'solo' ? t('创建后即可开始模拟') : t('创建后可邀请好友或添加 AI 队友'))
                : html`<${Spinner} size="sm" label="CONNECTING" /> ${t('正在连接服务器…')}`}
            </p>
            <button type="button" class="proto-start" disabled=${!online || maint || working || loading} aria-busy=${working ? 'true' : 'false'}
                onClick=${match ? onQueue : onCreate}>
              <span class="proto-start__mark" aria-hidden="true"><span class="proto-start__rook"><i>[</i><${Icon} name="rook" /><i>]</i></span><small>STRONGHOLD<br />PROTOCOL</small></span>
              <span class="proto-start__label">${working ? html`<${Spinner} size="sm" />` : null}${label}</span>
              <span class="proto-start__deco" aria-hidden="true"></span>
            </button>
          </div>`}
        </section>
      </div>
    </div>
    ${busy === 'create' ? html`<${JoinLine} text=${mode === 'solo' ? t('正在进入模拟') : t('正在建立同盟')} />` : null}
  <//>`;
}

/**
 * 选择同盟方式 (the design's screen after 同盟模拟; also 密钥加入's dialog): the project's Modal (focus trap, Esc, focus
 * restored) styled to fill the screen — the radar at the left (ui/matchFlow.js) with 玩法说明 under it, at the right the
 * 创建同盟 card (a room at once at `difficulty`, the remembered one, which the host changes in the room; the test-room box
 * under it while the server runs in test mode) and the 加入同盟 card (the project's TextField as the key field, 观战, the
 * recent keys that only fill it, 加入同盟).
 *
 * Upstream's inputs on top of the fork's: `focusKey` (the Modal focuses the field; off on a touch screen), `short` (the
 * screen is at most 520 px tall — the field's placeholder is then its name alone), `testMode` / `asTest` / `onTest` (the
 * test-room box) and `marks` (the keys whose room was a test room). The fork's own: `maint` (the server's maintenance
 * switch pauses new rooms), `queued` (a live queue ticket), `onMatch` (多人匹配) and `testMarks`.
 */
export function AllianceSelect({ onClose, onCreate, difficulty = 'FUNNY', code, onCode, codeOk, online, busy = null, onJoin, onSpectate,
  recent = [], marks = null, testMarks = [], focusKey = true, testMode = false, asTest = false, onTest = () => {}, short = false,
  maint = false, queued = false, onMatch = null }) {
  const diffName = DIFFICULTY_NAMES[difficulty] ? t(DIFFICULTY_NAMES[difficulty]) : '';
  const marked = Array.isArray(marks) ? marks : testMarks;
  const joining = busy === 'create' ? t('正在建立同盟') : busy === 'join' ? t('正在加入同盟') : busy === 'spectate' ? t('正在进入观战') : null;
  return html`<${Modal} open=${true} onClose=${onClose} class="ally" veilClass="proto-veil">
    <div class="ally__body">
      <div class="proto__bg ally__bg" aria-hidden="true"></div>
      <header class="proto-top">
        <${BackPlate} onClick=${onClose} class="ally__back" />
        <div class="proto-title">
          <h2 class="modal__title">${t('选择同盟方式')}</h2>
          <span class="proto-title__mode ally__mode"><${Icon} name="users" />${t('同盟模拟')}<i>ALLIANCE SIMULATION</i></span>
        </div>
      </header>
      <div class="proto-body ally-body">
        <section class="ally-stage">
          <${RadarScene} />
          <button type="button" class="ally-guide" onClick=${() => openGuide(0)}><span class="ally-guide__icon"><${Icon} name="book" /></span>${t('玩法说明')}</button>
        </section>
        <section class="ally-side">
          <button type="button" class="ally-card ally-card--create ally-create" data-testid="alliance-create" data-difficulty=${difficulty}
              disabled=${!online || maint || queued || busy === 'create'} aria-busy=${busy === 'create' ? 'true' : 'false'}
              onClick=${() => onCreate()}>
            <span class="ally-card__art"><${CreateArt} /></span>
            <span class="ally-card__bar"><span class="ally-card__icon">${busy === 'create' ? html`<${Spinner} size="sm" />` : html`<${Icon} name="plus" />`}</span><span class="ally-card__name">${maint ? t('维护中 · 暂停开局') : t('创建同盟')}</span>
              <small>${!online ? t('正在连接服务器…') : maint ? t('服务器即将维护，暂停开启新的模拟')
                : queued ? t('多人匹配中，请先取消匹配') : t('难度：{name}（可在同盟内更改）', { name: diffName })}</small></span>
          </button>
          ${onMatch ? html`<div class="ally-links">
            <button type="button" class="ally-pill" onClick=${onMatch}><${Icon} name="search" />${queued ? t('匹配中') : t('多人匹配')}</button>
          </div>` : null}
          ${testMode ? html`<label class="create-box__test ally-test" data-testid="create-test">
            <input type="checkbox" checked=${asTest} onChange=${(e) => onTest(e.target.checked)} />
            <span>${t('测试房间')}</span>
            <em class="t-dim">${t('不计入战绩。房间会标明「测试」，只有房主能使用测试指令。')}</em>
          </label>` : null}
          <div class="ally-card ally-card--join ally-join join-row">
            <span class="ally-card__art"><${JoinArt} /></span>
            <div class="ally-key">
              <${TextField} class="ally-key__field" size="key" icon="key" value=${code} transform=${normalizeCode} onInput=${onCode} onEnter=${() => onJoin()}
                placeholder=${short ? t('同盟密钥') : t('输入同盟密钥 / 粘贴邀请链接')} placeholderShort=${t('同盟密钥')} ariaLabel=${t('同盟密钥')}
                modalFocus=${!!focusKey} />
              <button type="button" class="ally-key__spec join-spectate" disabled=${!codeOk || !online || busy === 'spectate'} onClick=${() => onSpectate()}
                title=${spectateHint()}>${busy === 'spectate' ? html`<${Spinner} size="sm" />` : html`<${Icon} name="eye" />`}${t('观战')}</button>
            </div>
            <span class="ally-recent join-foot">
              ${recent.length ? html`<span class="t-lo">${t('最近的同盟')}</span>
                ${recent.map((c) => html`<button key=${c} type="button" class="code-chip num" title=${t('填入密钥（不会直接加入）')}
                  onClick=${() => onCode(c)}>${c}${Array.isArray(marked) && marked.includes(c) ? html` <${TestMark} />` : null}</button>`)}`
                : html`<span class="t-dim">${t('向同伴索取 {ROOM_CODE_LEN} 位同盟密钥，或直接打开邀请链接', { ROOM_CODE_LEN })}</span>`}
              <span class="join-foot__note t-dim">${t('开局后仍可使用原同盟密钥观战。')}</span>
            </span>
            <button type="button" class="ally-card__bar ally-card__bar--join" disabled=${!codeOk || !online || busy === 'join'} onClick=${() => onJoin()}>
              <span class="ally-card__icon"><${Icon} name="users" /></span>${t('加入同盟')}${busy === 'join' ? html`<${Spinner} size="sm" />` : null}
            </button>
          </div>
        </section>
      </div>
    </div>
    ${joining ? html`<${JoinLine} text=${joining} />` : null}
  <//>`;
}

// Mounted on demand. Keep optional announcement I/O here, outside the shared in-match UI data contract.
function LobbyAnnouncements({ snapshot, onClose }) {
  useData('announcements');
  const status = data.status('announcements');
  const ready = snapshot.value === data.get('announcements');
  return html`<${AnnouncementBoard} status=${status === 'ready' && !ready ? 'loading' : status} value=${snapshot.value}
    onRetry=${() => data.invalidate('announcements')} onClose=${onClose} />`;
}

/** The design credit under the feedback group (the owner's request of 2026-10-14; the QQ line went on 2026-10-20). */
export const UI_CREDIT = Object.freeze({ author: '雨千代chiyo', site: 'Bilibili' }); // i18n-ignore: a person's name

function DesignCredit() {
  return html`<p class="hub-credit" title=${t('界面设计：{author}（{site}）', UI_CREDIT)}>
    ${t('界面设计')} <b>${UI_CREDIT.site}@${UI_CREDIT.author}</b>
  </p>`;
}

/** The fan-work notice, the project repository and the version (the title screen's footer until 2026-10-15). */
function HubFoot() {
  return html`<p class="hub-credit hub-foot">
    <span>${t('非官方同人复刻 · 游戏素材版权归 上海鹰角网络 / Yostar 所有')}</span><span class="hub-credit__sep" aria-hidden="true">·</span><a class="hub-repo" href="https://github.com/sganggs/Stronghold-Protocol" target="_blank" rel="noopener noreferrer">${t('项目仓库')}</a><span class="hub-credit__sep" aria-hidden="true">·</span><span class="num">v${APP_VERSION}</span>
    ${DEV_BUILD ? html`<span class="hub-dev" role="note">${t('开发版 · 不稳定，请勿用于公开服务器')}</span>` : null}
  </p>`;
}

/**
 * The hub's 成就统计 card (upstream/master, adopted in place of the fork's 成就统计 entry): a dusk scene with the emblem,
 * the trophy medal and count, and the label strip with the LV, all from this browser's records (ui/stats.js
 * peekStatsRecords, read only; no account). The LV is counted as the settlement counts it (screens/settle.js
 * levelProgress), the trophies as the window it opens counts them (ui/stats.js aggregateStats, the same number as its
 * 获得奖杯). Read again whenever that window closes (an import or clearing there changes them) and when the version
 * shown changes (its season's records). Opens screens/stats.js AchievementDialog.
 */
function AchievementCard({ onOpen }) {
  useData('config'); useData('assets');
  const cfg = data.get('config');
  const statsOpen = useStatsOpen();
  // the LV of the season shown (DESIGN §35.23: 第一期's records count toward 第一期's levels)
  const season = useStore((s) => seasonOf(lobbyVersion(s)));
  const { prog, trophies } = useMemo(() => {
    const records = recordsOfSeason(peekStatsRecords(), season);
    return { prog: levelProgress(records, { counted: false, rewards: cfg?.rewards }), trophies: aggregateStats(records).trophies };
  }, [cfg, statsOpen, season]);
  const lv = levelOf(prog.before, cfg?.rewards?.milestones);
  const medal = trophyMedalOf(trophies, cfg?.trophies?.medals);
  return html`<button type="button" class="hub-ach" onClick=${onOpen} title=${t('成就统计（本机记录）')}>
    <span class="hub-ach__scene" aria-hidden="true">
      <svg class="hub-ach__land" viewBox="0 0 320 110" preserveAspectRatio="none">
        <defs><linearGradient id="hubAchSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2a2114" /><stop offset=".5" stop-color="#b8741c" /><stop offset="1" stop-color="#f0a636" /></linearGradient></defs>
        <rect width="320" height="110" fill="url(#hubAchSky)" />
        <path d="M0 110V80l28-12 22 9 34-27 27 18 30-13 41 23 27-11 31 17 33-21 47 25V110z" fill="#3a2a16" />
        <path d="M0 110V94l46-11 41 8 50-15 44 13 50-9 40 11 49-7V110z" fill="#18120b" />
        <path d="M262 110V70M262 80l-9-8M262 76l8-7M262 86l10-6" stroke="#18120b" stroke-width="2.5" fill="none" />
      </svg>
      <span class="hub-ach__mark"><${Emblem} /></span>
      <span class="hub-ach__rank">
        <${Img} src=${medal ? uiUrl(data.get('assets'), `medalIcon/${medal.iconId}`) : null} class="hub-ach__medal" fallback=${html`<${Icon} name="rook" />`} />
        <small><${Icon} name="crown" /><b class="num">${trophies}</b></small>
      </span>
    </span>
    <span class="hub-ach__label">
      <${AchBadge} class="hub-ach__badge" />
      <span>${t('成就统计')}</span><b class="hub-ach__lv num">LV.${lv.lv}</b>
    </span>
  </button>`;
}

/** The 成就统计 label's badge (original drawing). */
function AchBadge({ class: cls }) {
  return html`<svg class=${cls} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 3h14v12l-7 6-7-6zm4 5v2h2V8zm4 0v2h2V8zm-4.5 4.2a4.5 4.5 0 0 0 7 0l-1.3-1a3 3 0 0 1-4.4 0z" fill-rule="evenodd" /></svg>`;
}

/** File names of the official 选择模拟协议 pictures (assets `modeChoice/<name>_rhodes_island`). */
const PROTOCOL_ART = { FUNNY: 'funny', NORMAL: 'normal', HARD: 'hard', ABYSS: 'abyss' };

/** The selected difficulty's scene (ui/protocolScene.js): the official picture on the drawn grid, squares and cable. */
function ProtocolArt({ difficulty }) {
  useData('assets');
  return html`<${ProtocolScene} difficulty=${difficulty} art=${uiUrl(data.get('assets'), `modeChoice/${PROTOCOL_ART[difficulty]}_rhodes_island`)} />`;
}

/** The ‹ + dotted rook plate at the top left of the full-screen dialogs: back to the hub (or the dialog below). */
function BackPlate({ onClick, class: cls = '' }) {
  return html`<button type="button" class=${`proto-back ${cls}`} onClick=${onClick} title=${t('返回')} aria-label=${t('返回')}>
    <${Icon} name="chevronLeft" /><span class="proto-back__home"><${Icon} name="rook" /></span>
  </button>`;
}

/** Lobby screen component. */
export function LobbyScreen() {
  const me = useStore((s) => s.me, shallowEqual);
  const conn = useStore((s) => s.connection, shallowEqual);
  const presence = useStore((s) => s.presence, shallowEqual);
  useData('config', 'announcements');
  useData('assets');
  const queue = useStore((s) => s.queue);
  const pendingJoin = useStore((s) => s.ui.pendingJoin);
  const queued = queueActive(queue);
  const [difficulty, setDifficulty] = useState(() => {
    const d = loadPref('lobby.difficulty', 'FUNNY');
    return DIFFICULTIES.includes(d) ? d : 'FUNNY';
  });
  // 「不限时」 for the next timed solo (DESIGN §35.23.10; default off). The room's 模拟设置 is the authority once the room
  // exists; this pref is what 创建 sends before that
  const [soloFree, setSoloFree] = useState(() => loadPref('lobby.soloUnlimited', false) === true);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(null);
  const [overlay, setOverlay] = useState(null); // 'announcements'
  const [loadOpen, setLoadOpen] = useState(false);
  // the open service dialog keeps the whole cluster summary on every pong (server/net.js CLUSTER_LOAD_EVERY_MS)
  useEffect(() => { net.watchClusterLoad?.(loadOpen); return () => net.watchClusterLoad?.(false); }, [loadOpen]);
  const [announcements, setAnnouncements] = useState({ value: null, revision: null });
  const noticeStatus = data.status('announcements'), noticeValue = data.get('announcements');
  const [recent] = useState(recentRooms);
  const [testMarks] = useState(recentTestRooms);
  const [coarse] = useState(() => detectFeatures().coarse); // no Modal focus on a touch screen
  const shortScreen = useMediaQuery(SHORT_SCREEN_QUERY);
  const alive = useRef(true);
  const inFlight = useRef(false); // synchronous guard against double clicks (state updates are async)
  useEffect(() => () => { alive.current = false; }, []);

  const resourcesReady = useStore((s) => !s.session.preloadRequired || s.session.preloadReady);
  const online = conn.status === 'online' && resourcesReady;
  const codeOk = CODE_RE.test(code);
  // the server's maintenance switch (presence.state, server/lobby.js): no new rooms, matches or queue tickets
  const maint = online && presence?.maintenance === true;
  const banner = maint ? t('服务器即将维护，暂停开启新的模拟') : announcementBanner(noticeValue);
  // official versions (DESIGN §35.23): the lobby's version, the difficulties it offers and the one shown — the
  // remembered one, or the server's fallback when that version lacks it (the pref is only overwritten when the player
  // picks); `version` goes out with room.create only when welcome.versions is present (protocol §4)
  const versions = useStore((s) => s.versions);
  const version = useStore(lobbyVersion);
  const versionLoading = useStore((c) => version !== DEFAULT_VERSION && (c.kind !== 'version' || c.version !== version || c.status !== 'ready'), Object.is, contentSet);
  // its set failed to load or its check: 选择模拟协议 says so and offers 重试 there
  const versionFailed = useStore((c) => version !== DEFAULT_VERSION && c.kind === 'version' && c.version === version && c.status === 'failed', Object.is, contentSet);
  const cfg = getConfig();
  // null while that version's data is not on screen: the 「不限时」 switch hides and no time rule is stated
  const soloTimed = soloTimedOf(versionLoading ? null : cfg, version);
  const solo = offeredDifficulties(versionLoading ? null : cfg, 'solo');
  const coop = offeredDifficulties(versionLoading ? null : cfg, 'coop');
  const shownSolo = fallbackDifficulty(solo, difficulty);
  const shownCoop = fallbackDifficulty(coop, difficulty);

  const bg = useHubBackdrop();
  const [bgOpen, setBgOpen] = useState(false);
  const [sweepOpen, setSweepOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false); // 反馈板 (ui/feedbackBoard.js)
  const [achOpen, setAchOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false); // 我的信息 (界面#09)
  // 自传头像：上传过的浏览器在每次连上服务器后重认领一次（服务端按 owner 只认自己的文件）
  // welcome 只在 hello 之后发一次，而大厅比它晚挂载（refresh 后第一次进大厅收不到），所以挂载时先认领一次，
  // 断线重连再靠 welcome 认领一次。
  useEffect(() => {
    claimAvatar();
    claimNamecard();
    return net.on('welcome', () => { claimAvatar(); claimNamecard(); });
  }, []);

  useEffect(() => {
    // Optional low-frequency checks exist only while the lobby is mounted, never during a match.
    const refresh = () => {
      if (document.visibilityState === 'hidden' || data.status('announcements') === 'loading') return;
      if (data.status('announcements') === 'ready' || data.status('announcements') === 'missing') data.invalidate('announcements');
    };
    refresh();
    const timer = setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  useEffect(() => {
    if (noticeStatus !== 'ready') return undefined;
    let current = true;
    announcementRevision(noticeValue).then(revision => {
      if (current && data.status('announcements') === 'ready' && data.get('announcements') === noticeValue) {
        setAnnouncements({ value: noticeValue, revision });
      }
    });
    return () => { current = false; };
  }, [noticeStatus, noticeValue]);
  useEffect(() => {
    if (online && !queued && !busy && !pendingJoin && overlay == null && announcements.revision && !announcementDismissed(announcements.revision)) setOverlay('announcements');
  }, [online, queued, busy, pendingJoin, overlay, announcements.revision]);
  const closeAnnouncements = () => { dismissAnnouncement(announcements.revision); setOverlay(null); };
  const unread = !!announcements.revision && !announcementDismissed(announcements.revision);

  const pickDifficulty = (d) => { setDifficulty(d); savePref('lobby.difficulty', d); };
  // 「不限时」 for the next timed solo (DESIGN §35.23.10; default off): the room's 模拟设置 is the authority once the
  // room exists — this pref is what 创建 sends before that
  const setSoloFreePref = (on) => { const next = on === true; setSoloFree(next); savePref('lobby.soloUnlimited', next); };

  const run = async (kind, fn) => {
    if (inFlight.current) return;
    if (!online) { toast(t('尚未连接到服务器，请稍候'), 'warn'); return; }
    inFlight.current = true;
    setBusy(kind);
    try { await fn(); } catch (err) { toastError(err); } finally {
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };
  // hub screens: 选择模拟协议 of 独立模拟 / 多人匹配, 选择同盟方式, 密钥加入
  const [sheet, setSheet] = useState(null);                // null | 'solo' | 'match'
  const [sheetChained, setSheetChained] = useState(false); // opened from 选择同盟方式: no darkening of the hub between
  const [allyOpen, setAllyOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  // 测试房间 (DESIGN §34.8; welcome.testMode): the server offers it only when SP_TEST_MODE is on
  const testMode = useStore((s) => s.testMode === true);
  const [asTest, setAsTest] = useState(false);
  // 独立模拟: at the difficulty picked on 选择模拟协议 (its version's fallback when that version lacks it); 创建同盟: at the
  // remembered one, changed in the room by the host. `version`: the lobby's, only when welcome.versions is present
  // (protocol §4); `soloUnlimited`: the 「不限时」 pref, only for a timed solo and only when it is on
  const create = (mode) => run('create', () => net.request('room.create', {
    mode, difficulty: mode === 'solo' ? shownSolo : shownCoop, ...(testMode && asTest ? { test: true } : {}), ...(versions ? { version } : {}),
    ...(mode === 'solo' && soloFree && soloTimed === true ? { soloUnlimited: true } : {}),
    // the player's 开房默认 (设置 → 开房默认): only when one is on, so an ordinary room still sends no rules
    ...(roomDefaultsExperimental(roomDefaultsStore.get()) ? { experimental: roomDefaultsExperimental(roomDefaultsStore.get()) } : {}),
  }));
  const queueMatch = () => run('queue', () => net.request('queue.join', { difficulty }));
  // an offer while the hub shows: 选择模拟协议 comes up with 确认入场 (the 30-second window must not go unseen)
  useEffect(() => { if (queue?.state === 'offered' && sheet !== 'match') { setAllyOpen(false); setSheetChained(false); setSheet('match'); } }, [queue?.state]);
  const join = (c = code) => {
    if (queued) { toast(t('请先取消多人匹配，再加入好友同盟'), 'warn'); return; }
    // Click callbacks may pass an event; only an explicit string overrides the typed key.
    const k = codeArg(c, code);
    if (!k) { toast(t('同盟密钥为 {ROOM_CODE_LEN} 位字母或数字', { ROOM_CODE_LEN }), 'warn'); return; }
    run('join', () => joinRoom(k));
  };
  // a spectator seat: no player seat taken, nothing to do but watch (also a match already running)
  const spectate = (c = code) => {
    if (queued) { toast(t('请先取消多人匹配，再进入观战席'), 'warn'); return; }
    const k = codeArg(c, code);
    if (!k) { toast(t('同盟密钥为 {ROOM_CODE_LEN} 位字母或数字', { ROOM_CODE_LEN }), 'warn'); return; }
    run('spectate', () => net.request('room.spectate', { code: k }).catch(async (err) => {
      // a 测试房间 asks first (ERR.TEST_CONFIRM, DESIGN §34.8)
      if (err?.code === ERR.TEST_CONFIRM) {
        if (!await confirmDialog({ title: t('测试'), text: t('这是测试房间，不计入任何记录。确认观战？') })) return;
        await net.request('room.spectate', { code: k, testAck: true });
        return;
      }
      // Keep a missing or already-joined room distinct from a generic network error.
      if (err?.code === ERR.ROOM_NOT_FOUND) {
        toast(t('没有找到密钥 {k} 对应的同盟：请和房主核对密钥（同盟结束后密钥即失效）', { k }), 'warn');
        return;
      }
      if (err?.code === ERR.ALREADY) {
        toast(t('你已经是该同盟的博士：先离开同盟，才能以观战身份进入'), 'warn');
        return;
      }
      throw err;
    }));
  };
  const openSolo = () => { if (queued) { toast(t('请先取消多人匹配'), 'warn'); return; } savePref('lobby.mode', 'solo'); setSheetChained(false); setSheet('solo'); };
  const openAlly = () => { savePref('lobby.mode', 'coop'); setAllyOpen(true); };
  const openMatch = () => { savePref('lobby.mode', 'match'); setSheetChained(allyOpen); setAllyOpen(false); setSheet('match'); };
  const sheetCard = MODE_CARDS.find((c) => c.id === sheet) || MODE_CARDS[0];
  const cancelling = useStore((s) => s.ui.queueCancel);

  return html`<div class="screen lobby-screen lobby-hub" data-hub-theme=${backdropTheme(bg)}>
    <${HubBackdrop} bg=${bg} />
    <header class="topbar hub-topbar">
      <div class="topbar__left">
        <${PingPill} ms=${conn.ping} online=${conn.status === 'online'} status=${conn.status} loadState=${conn.loadState ?? 'unknown'} loadDetails=${conn.loadDetails}
          clusterLoad=${conn.clusterLoad} loadOpen=${loadOpen} onLoadClick=${() => setLoadOpen(true)} />
        <span class="topbar__sep" aria-hidden="true"></span>
        <div class="topbar__tools">
          <${SettingsButton} class="lobby-settings" variant="secondary" square=${true} />
          <${GuideButton} class="lobby-guide" variant="secondary" square=${true} />
          <${Button} variant="secondary" size="sm" square=${true} class="hub-bg-btn" onClick=${() => setBgOpen(true)}
            title=${t('大厅背景')} aria-label=${t('大厅背景')}><${BackdropGlyph} /><//>
          <${HubFullscreenButton} />
          <${LobbyMusicButton} />
          <${PwaInstallButton} class="lobby-pwa" square=${true} />
        </div>
      </div>
      <div class="topbar__right">
        <span class="hub-online" title=${t('按已连接的玩家会话计数，不含机器人、离线保留局和未进入的连接；不等于去重自然人数。')}>
          <span class="online-pill__dot"></span>${Number.isInteger(presence?.online) && conn.status === 'online'
            ? html`<span class="num">${presence.online}</span><span class="online-word">${t('名博士在线')}</span>` : html`<span>${t('在线人数 —')}</span>`}</span>
        <${VersionSwitch} />
        <${ResumeMatchButton} />
        <${MeCard} me=${me} onOpen=${() => setInfoOpen(true)} />
      </div>
    </header>

    <main class="hub-stage">
      <div class=${`hub-center${bg.pref.hideCenter ? ' is-hidden' : ''}`}>
        <div class="hub-center__mark"><${HubRadar} bg=${bg} /><${Sprite} k="entry/season_logo" class="hub-center__logo" fallback=${html`<${Emblem} />`} /></div>
        <div class="hub-center__en">STRONGHOLD PROTOCOL <b>ALLIANCE</b></div>
        <h1 class="hub-center__title">${t('卫戍协议：盟约')}</h1>
      </div>

      <aside class="hub-side">
        <${AchievementCard} onOpen=${() => setAchOpen(true)} />
        <${HubTile} icon="key" label=${t('密钥加入')} en="JOIN WITH KEY" class="hub-tile--key" onClick=${() => setJoinOpen(true)} />
        <${LobbyMusicPanel} />
        <${TipsPanel} />
        <div class="hub-contact"><div class="hub-contact__row"><${LobbyFeedback} onOpen=${() => setFeedbackOpen(true)} /><${SiteBoards} /></div><${DesignCredit} /><${HubFoot} /></div>
      </aside>

      <aside class="hub-right">
        <${NoticeCard} value=${noticeValue} status=${noticeStatus} unread=${unread} onOpen=${() => setOverlay('announcements')} />
        <div class="hub-right__plates">
          <${SweepPlate} onClick=${() => setSweepOpen(true)} />
          <${LoadoutButton} from="lobby" size="lg" class="hub-plate hub-plate--loadout" label=${t('干员调配')} />
        </div>
      </aside>

      <section class="hub-entries" aria-label=${t('模拟方式')}>
        ${queued && sheet !== 'match' ? html`<div class="matchmaking-hud brackets hub-searching" role="status">
            <div class="matchmaking-hud__info">
              <${Spinner} size="sm" />
              <span class="matchmaking-hud__text">${queue.state === 'offered' ? t('队友已集结，请确认入场') : t('正在匹配同盟')} · ${t(DIFFICULTY_NAMES[queue.difficulty] || '')}</span>
            </div>
            <${Button} variant="secondary" size="md" onClick=${openMatch}>${t('查看')}<//>
            <${Button} variant="danger" size="md" loading=${cancelling?.ticketId === queue.ticketId && cancelling?.status !== 'idle' && cancelling?.status !== 'failed'}
              onClick=${() => queueCancellation.cancel(queue.ticketId)}>${t('取消匹配')}<//>
          </div>` : null}
        ${banner ? html`<div class="hub-maint" role="status">${banner}</div>` : null}
        ${testMode ? html`<label class="hub-testroom" data-testid="create-test">
          <input type="checkbox" checked=${asTest} onChange=${(e) => setAsTest(e.currentTarget.checked)} />
          <span>${t('测试房间')}</span>
          <em>${t('不计入战绩。房间会标明「测试」，只有房主能使用测试指令。')}</em>
        </label>` : null}
        <div class="hub-entries__row">
          <${HubEntry} group=${{ icon: 'user', label: t('独立模拟') }} name=${t('独立模拟')} en="SOLO" icon="user" onClick=${openSolo} />
          <${HubEntry} group=${{ icon: 'users', label: t('同盟模拟') }} name=${t('同盟模拟')} en="ALLIANCE" icon="users" onClick=${openAlly} />
          <${HubEntry} name=${t('多人匹配')} en="MATCHMAKING" icon="search" tone="bright" onClick=${openMatch}
            note=${queued ? html`<span class="num">${t('匹配中')}</span>` : null} />
        </div>
      </section>
    </main>

    ${sheet ? html`<${ProtocolSelect} card=${sheetCard} purpose=${sheet === 'match' ? 'match' : 'create'}
      difficulty=${sheet === 'match' ? shownCoop : shownSolo} onDifficulty=${pickDifficulty} onClose=${() => setSheet(null)}
      online=${online} maint=${maint} busy=${busy} queue=${queue} onCreate=${() => create('solo')} onQueue=${queueMatch}
      chained=${sheetChained} testMode=${testMode} asTest=${asTest} onTest=${setAsTest}
      difficulties=${sheet === 'match' ? coop : solo} loading=${versionLoading} failed=${versionFailed}
      soloTime=${sheet === 'solo' && soloTimed === true ? { on: soloFree, onToggle: setSoloFreePref } : null} />` : null}

    ${allyOpen ? html`<${AllianceSelect} onClose=${() => setAllyOpen(false)} code=${code} onCode=${(v) => setCode(normalizeCode(v))} codeOk=${codeOk}
      recent=${recent} marks=${testMarks} online=${online} maint=${maint} busy=${busy} queued=${queued}
      focusKey=${!coarse} short=${shortScreen} testMode=${testMode} asTest=${asTest} onTest=${setAsTest}
      onCreate=${() => create('coop')} difficulty=${shownCoop} onJoin=${() => join()} onSpectate=${() => spectate()} onMatch=${openMatch} />` : null}

    <${HubDialog} open=${joinOpen} micro="JOIN WITH ALLIANCE KEY" title=${t('密钥加入')} onClose=${() => setJoinOpen(false)}>
      <div class="join-row">
        <${TextField} size="code" icon="key" value=${code} placeholder=${t('输入同盟密钥 / 粘贴邀请链接')}
          transform=${normalizeCode} onInput=${(v) => setCode(normalizeCode(v))} onEnter=${() => join()} />
      </div>
      <div class="join-row hub-join__buttons">
        <${Button} variant="amber" size="lg" icon="users" loading=${busy === 'join'} disabled=${!codeOk || !online || queued || !!busy} onClick=${() => join()}>${t('加入同盟')}<//>
        <${Tooltip} text=${spectateHint()}>
          <${Button} variant="secondary" size="lg" icon="eye" class="join-spectate" loading=${busy === 'spectate'} disabled=${!codeOk || !online || queued || !!busy} onClick=${spectate}>${t('观战')}<//>
        <//>
      </div>
      <div class="join-foot">
        ${recent.length ? html`<span class="t-lo">${t('最近的同盟')}</span>
          ${recent.map((c) => html`<button key=${c} type="button" class="code-chip num" title=${t('填入密钥（不会直接加入）')}
            onClick=${() => setCode(c)}>${c}${testMarks.includes(c) ? html` <${TestMark} />` : null}</button>`)}`
          : html`<span class="t-dim">${t('向同伴索取 {ROOM_CODE_LEN} 位同盟密钥，或直接打开邀请链接', { ROOM_CODE_LEN })}</span>`}
        <span class="join-foot__note t-dim">${t('开局后仍可使用原同盟密钥观战。')}</span>
      </div>
    <//>

    <${HubDialog} open=${bgOpen} micro="LOBBY BACKDROP" title=${t('大厅背景')} onClose=${() => setBgOpen(false)}>
      <${BackdropSettings} bg=${bg} />
    <//>

    <${ServerStatusModal} open=${loadOpen} online=${conn.status === 'online'} state=${conn.loadState} details=${conn.loadDetails} clusterLoad=${conn.clusterLoad} onClose=${() => setLoadOpen(false)} />
    ${overlay === 'announcements' ? html`<${LobbyAnnouncements} snapshot=${announcements} onClose=${closeAnnouncements} />` : null}
    ${feedbackOpen ? html`<${FeedbackBoard} onClose=${() => setFeedbackOpen(false)} />` : null}
    ${infoOpen ? html`<${MyInfoDialog} me=${me} onClose=${() => setInfoOpen(false)} />` : null}
    ${achOpen ? html`<${AchievementDialog} onClose=${() => setAchOpen(false)} />` : null}
    ${sweepOpen ? html`<${SweepReport} onClose=${() => setSweepOpen(false)} />` : null}
  </div>`;
}
