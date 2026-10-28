// server-patch.mjs — the whole gameplay half of Stronghold-Luck.
//
// Nothing here writes to the game folder: the game's own modules are imported from their real paths (so they are the
// very same module instances the server uses) and things are replaced on the live objects:
//
//   1. shared/protocol.js  C2S[...]                     the mod's intents (see the list at the top of installServerPatch);
//                                                       the table is a plain, unfrozen object and both server/net.js
//                                                       and the browser validate live
//   2. Match.prototype.handle                           routes those intents before the game's own dispatch (which reads
//                                                       a GAME_TYPES Set snapshotted at module load)
//   3. PlayerState.prototype.privateView               adds `shop.modPickable` (what may go in a shop slot right now,
//                                                       plus `pool`: every card this match's protocol deals, at any
//                                                       level — the auto-reverse target list) plus
//                                                       `shop.modPickable.quota` (this round's pick budget),
//                                                       `modSpeed` (the match's current battle speed) and `modAuto`
//                                                       (the last 自动倒转 batch and its tally)
//   4. Match.prototype.start                           applies the remembered battle speed to every new match
//
// and adds two methods:
//   PlayerState.prototype.modPickSlot(slot, id)   fills an unsold shop slot with the chess/item you asked for
//   PlayerState.prototype.modBuyDirect(id)        buys a chess/item straight into your hand, no shop slot, no roll
//
// plus the 自动倒转 loop (g.modAuto, see "the auto reverse" below): buy a cheap operator → cash in the coins it
// drops → sell it back, on repeat, until the seat readies or the money runs out.
//
// It also RECORDS the match (the "third round" feature, see the recorder section): every seat's actions (human AND
// bot), each round's enemy plan, the human's full private view, and the combat/settle outcome, one JSON line per
// event, to <mod>/logs/session-*.jsonl. `--no-log` (launcher) turns it off. That log is the raw material for later
// work on the game AI.
//
// Fail-soft: installServerPatch() reports what it could not find and returns a status; the caller still starts the
// game (unmodded) rather than dying.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { baseChessId, createUnitPatcher, normalizeUnitCfg, UNIT_SCOPES, unitCovers } from '../public/unit-rules.js';
import { autoCardAllowedNow, autoClassOf } from '../public/auto-rules.js';
import {
  applySlotOverride, createSlotPatcher, EXTRA_TIERS, extraDiyData, extraDiyTable, extraSlotId, hasNumberEdits,
  isExtraSlotId, MAX_EXTRA_SLOTS, normalizeSlotCfg, patchContentSeam, patchGameData, slotBaseId,
} from '../public/slot-rules.js';

export const PICK_TYPE = 'g.modPick';
export const BUY_TYPE = 'g.modBuy';
export const CONFIG_TYPE = 'g.modConfig';
export const SPEED_TYPE = 'g.modSpeed';
export const AUTO_TYPE = 'g.modAuto';
/** the sandbox (see "the sandbox" below): extra strategies, the deploy unlock, and its deploy-cap knob */
export const BANDS_TYPE = 'g.modBands';
export const PLACE_TYPE = 'g.modPlace';
export const SHOPLEVEL_TYPE = 'g.modShopLevel';
/** the sandbox's per-operator overrides (see "the unit rules" below): 携带技能 / 技力 / 属性 */
export const UNIT_TYPE = 'g.modUnit';
export const TESTFUNDS_TYPE = 'g.modTestFunds';
export const TESTROUND_TYPE = 'g.modTestRound';
export const TESTCAP_TYPE = 'g.modTestRoundCap';
export const TESTENEMY_TYPE = 'g.modTestEnemy';
export const TESTMAP_TYPE = 'g.modTestMap';
export const TESTBOND_TYPE = 'g.modTestBond';
export const TESTCOMBOS_TYPE = 'g.modTestCombos';
export const TESTBOSS_TYPE = 'g.modTestBoss';
export const TESTTIMER_TYPE = 'g.modTestTimer';
/** the shop bond filter (see "the shop bond filter" below): roll only the operators whose bonds are all chosen */
export const SHOPFILTER_TYPE = 'g.modShopFilter';
/** the 自选位 kit (see "the 自选位 rules" below): per-slot 盟约 / 特质 overrides for the player's 自选编队 pieces */
export const DIY_TYPE = 'g.modDiy';
/**
 * The master switches (see "the master switches" below). One key per GROUP of gameplay-changing features; turning one
 * off must leave the match exactly as it would be with that feature never installed, INCLUDING its live state, so the
 * handler rolls back what is already in effect rather than only refusing new messages.
 *
 * 倍速 (g.modSpeed) and 自动倒转 (g.modAuto) are deliberately NOT in this table: neither changes the simulation (speed
 * is presentation — see the speed section — and the auto loop only spends the seat's own funds on its own purchases),
 * so they stay available however the gameplay switches are set.
 */
export const ENABLE_TYPE = 'g.modEnable';
export const FEATURE_KEYS = Object.freeze([
  'shop',          // 自选商店 + 直购 + 每回合额度 (g.modPick / g.modBuy / g.modConfig)
  'sandboxBands',  // 沙盒：策略叠加 (g.modBands)
  'sandboxPlace',  // 沙盒：地块解锁 + 布阵上限 (g.modPlace)
  'sandboxUnit',   // 沙盒：单位（技能 / 技力 / 属性）(g.modUnit)
  'diy',           // 自选位：盟约 / 特质 / 数值 (g.modDiy.slots)
  'diyExtra',      // 自造位子 (g.modDiy.extra)
  'shopFilter',    // 阵营锁 (g.modShopFilter)
  'shopLevel',     // 调度中心：直接设置等级 (g.modShopLevel)
  'testFunds',    // 测试 · 设置资金
  'testRound',    // 测试 · 设置当前回合
  'testRoundCap', // 测试 · 设置回合上限
  'testEnemy',    // 测试 · 设置敌人
  'testMap',      // 测试 · 更换地图
  'testBond',     // 测试 · 设置盟约层数
]);
/** Every group ON. A fresh process behaves exactly as it did before the switches existed. */
export const featureDefaults = () => Object.fromEntries(FEATURE_KEYS.map((k) => [k, true]));
/** per-round budget spent: an action is refused with this code once the round's picks+buys are used up */
export const MOD_LIMIT = 'MOD_LIMIT';

const MOD_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PICK_LIMIT = 3;
const MAX_PICK_LIMIT = 99;
/** battle speed bounds (game seconds per real second). 2 is the game's own forced baseline. */
export const MIN_SPEED = 1;
export const MAX_SPEED = 16;
/** The game's own baseline battle speed (server/match/fields.js GAME_SPEED) — every real-time pacing number in the game
 *  is quoted at it, which is why the presentation steps below are divided by `speed / GAME_SPEED`. */
const GAME_SPEED = 2;
/** Floor for a shortened presentation step: below this the client may not have painted the new phase yet. */
const MIN_STEP_MS = 120;

/** PlayerState verbs that represent a seat's action, wrapped for the recorder (top level only — internal calls like
 *  acquireChess/_mergeChess are NOT wrapped, so nothing is double counted). */
const PS_ACTIONS = ['buy', 'refresh', 'freeze', 'levelUp', 'sell', 'move', 'equip', 'useArt', 'destroy', 'pickReward', 'setReady', 'modPickSlot', 'modBuyDirect'];
/** Match-level actions that take the acting PlayerState first. */
const MATCH_ACTIONS = ['pickBand', 'pickCard', 'setAutoplay'];

/** Result shapes of Match.handle (server/match/Match.js: `OK` / `fail`). */
const OK = Object.freeze({ ok: true });
const fail = (error, detail) => (detail ? { error, detail } : { error });

const isPickSlot = (v) => Number.isInteger(v) && v >= 0 && v <= 15;
const isPickId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;
const isPickLimit = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_PICK_LIMIT;
const isSpeed = (v) => Number.isInteger(v) && v >= MIN_SPEED && v <= MAX_SPEED;
const isBool = (v) => typeof v === 'boolean';
/** The master-switch payload `{ [featureKey]: boolean }`. Unknown keys are dropped by the handler, never refused:
 *  the panel and the server are deployed together, but a stale tab must not be able to wedge the switch. */
const isFeatures = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(isBool);
/** cycles per call: the panel re-sends while the toggle is on, so this is a batch size, not a run length */
export const MIN_CYCLES = 1;
export const MAX_CYCLES = 2000;
const isCycles = (v) => Number.isInteger(v) && v >= MIN_CYCLES && v <= MAX_CYCLES;
/** How the auto buy/sell gets its target in: 'shop' = the game's own shop (default), 'direct' = the mod's 直购. */
const isAutoMode = (v) => v === 'shop' || v === 'direct';
/** the 自动买卖 targets: the ticked catalogue ids, in the panel's order. Capped — the catalogue is 13 long, and a
 *  caller sending more than that is not describing this feature. The CLASS of each id is looked up server-side. */
const MAX_AUTO_TARGETS = 32;
const isAutoTargets = (v) => Array.isArray(v) && v.length > 0 && v.length <= MAX_AUTO_TARGETS && v.every(isPickId);

/** the sandbox: extra strategies per seat (the primary one is still the game's own draft pick), deploy unlock + cap */
/** an id list (strategy ids / bond ids). NO length cap (author, 2026-10-10: the stacking limit was the mod's own
 *  8, the engine has none — handleBands bounds the set by the match's own allowed strategies anyway). */
const isIdList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 64);
const isDeployCap = (v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 99);
/** the shop bond filter payload: the 阵营锁 switch, the bond ids it keeps, and which reading joins them (has | only). */
const FILTER_MODES = ['has', 'only'];
const isFilterMode = (v) => FILTER_MODES.includes(v);
const isShopFilter = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && typeof v.on === 'boolean'
  && isIdList(v.bonds)
  && isFilterMode(v.mode);
const isPlainObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/**
 * The 自选位 payload: `{ slots: { [slotBaseId]: { bonds?, addBonds?, garrisons? } | null } }`. A garrison entry is an id
 * or `{ id, bb? }`; `{}` clears every slot. Structural only — normalizeSlotCfg is the real gate (it checks the ids
 * against the match's own bond / garrison tables and clamps the numbers).
 */
const isDiySlotCfg = (s) => s === null || (isPlainObj(s)
  && (s.bonds == null || isIdList(s.bonds))
  && (s.addBonds == null || isIdList(s.addBonds))
  && (s.garrisons == null || (Array.isArray(s.garrisons) && s.garrisons.length <= 16
    && s.garrisons.every((g) => typeof g === 'string' || (isPlainObj(g) && typeof g.id === 'string')))));
const isDiySlots = (v) => isPlainObj(v) && Object.keys(v).length <= 64 && Object.values(v).every(isDiySlotCfg);
/** One mod-owned slot: `{ k, tier, pick }` (the pick is the same wire shape the game's own 自选编队 uses). */
const isDiyPickWire = (p) => p === null || (isPlainObj(p) && typeof p.charId === 'string' && p.charId.length > 0 && p.charId.length <= 64
  && (p.skillIndex == null || (Number.isInteger(p.skillIndex) && p.skillIndex >= 0 && p.skillIndex <= 9))
  && (p.uniEquipId == null || (typeof p.uniEquipId === 'string' && p.uniEquipId.length <= 64)));
const isDiyExtras = (v) => v == null || (Array.isArray(v) && v.length <= MAX_EXTRA_SLOTS && v.every((e) => isPlainObj(e)
  && Number.isInteger(e.k) && e.k >= 1 && e.k <= MAX_EXTRA_SLOTS && EXTRA_TIERS.includes(e.tier) && isDiyPickWire(e.pick)));
const isDiyCfg = (v) => v === null || (isPlainObj(v)
  && (v.slots == null || isDiySlots(v.slots)) && (v.extra == null || isDiyExtras(v.extra)));
/** The 携带技能 overrides: `{ [slotBaseId]: 0..9 }`. */
const isDiySkills = (v) => v == null || (isPlainObj(v) && Object.keys(v).length <= 64
  && Object.values(v).every((n) => Number.isInteger(n) && n >= 0 && n <= 9));
/** The 模组 overrides: `{ [slotBaseId]: uniEquipId | null }` (null = 不带模组). */
const isDiyMods = (v) => v == null || (isPlainObj(v) && Object.keys(v).length <= 64
  && Object.values(v).every((x) => x === null || isPickId(x)));

/**
 * The unit-rules payload: the whole config rides in one field (`{ cfg }`), structurally checked here and clamped by
 * normalizeUnitCfg. `null` = back to vanilla. Kept loose on purpose — the clamp is the real gate.
 */
const isUnitCfg = (v) => v === null || (typeof v === 'object' && !Array.isArray(v)
  && typeof v.on === 'boolean'
  && (v.pin === undefined || typeof v.pin === 'boolean')
  && UNIT_SCOPES.includes(v.scope)
  && (v.id == null || (typeof v.id === 'string' && v.id.length <= 64))
  && (v.skill == null || (Number.isInteger(v.skill) && v.skill >= 0 && v.skill <= 9))
  && (v.spCost == null || (typeof v.spCost === 'number' && Number.isFinite(v.spCost)))
  && (v.initSp == null || (typeof v.initSp === 'number' && Number.isFinite(v.initSp)))
  && (v.mult == null || (typeof v.mult === 'number' && Number.isFinite(v.mult)))
  && (v.stats == null || (typeof v.stats === 'object' && !Array.isArray(v.stats))));
/**
 * Strategies whose 每回合给钱 buff **assigns** `ev.income` instead of adding to it (老鲤 利滚利: the round it pays, the
 * income IS its number). Every other strategy's income hook adds. Since the assignments discard whatever ran before
 * them, these have to run FIRST when they are an extra strategy, or the additive ones on top of them would be wiped.
 * (When one of these is the primary pick the game already runs it first, so nothing special is needed.)
 */
const INCOME_ASSIGN_BANDS = new Set(['band_lmlee']);

/**
 * 鸭爵 / 神秘顾客. Its换敌 effect is not a `band:` handler but a GLOBAL one (`registry.global('bands_ducklord', …)`,
 * sim/content/bands/meta.js:471-514), and its "do I hold it" gate reads `ctx.bandId()` / `ctx.teammates()` — both live
 * reads of each seat's `ps.bandId` (effectsMeta.js:480 / :694). `ps.modBands` is invisible to it, so as an EXTRA
 * strategy the whole handler is skipped. This pair lets the wrapped dispatch run it for such a seat (see duckAsExtra).
 */
const DUCK_BAND = 'band_ducklord';
const DUCK_GLOBAL = 'global:bands_ducklord';

/**
 * Install the pick-your-own shop into a running game process.
 * @param {string} gameRoot absolute path of the Stronghold-Protocol checkout
 * @param {{ info: Function, warn: Function, error: Function }} log
 * @param {{ pickLimit?: number, record?: boolean, logDir?: string, combatSpeed?: number }} [opts]
 *        pickLimit — actions allowed per round (直购 + 自选 共用), 0 = 不限, default 3
 *        record    — write the match log, default off
 *        logDir    — where those JSONL files go; default <mod>/logs
 *        combatSpeed — battle speed every match starts at (game seconds per real second); 2 = the game's own
 * @returns {Promise<{ ok: boolean, missing: string[], logFile: string|null }>}
 */
export async function installServerPatch(gameRoot, log = console, opts = {}) {
  const imp = (rel) => import(pathToFileURL(path.join(gameRoot, rel)).href);
  const missing = [];

  const [protocol, constants, matchMod, psMod, metaMod, boardMod, battleMod, bandsMod, simdataMod, skillsMod, diyMod, diyDataMod, bondsMetaMod, gamedataMod, supportMod] = await Promise.all([
    imp('shared/protocol.js'),
    imp('shared/constants.js'),
    imp('server/match/Match.js'),
    imp('server/match/PlayerState.js'),
    imp('server/match/effectsMeta.js'),
    imp('server/match/board.js'),
    imp('server/sim/Battle.js'),
    imp('server/sim/content/bands.js'),
    imp('server/sim/simdata.js'),
    imp('server/sim/skills.js'),
    imp('server/match/player/diy.js'),
    imp('shared/diy.js'),
    imp('server/match/bondsMeta.js'),
    imp('server/match/gamedata.js'),
    imp('server/sim/content/support/index.js'),
  ]);
  const { DataSource } = simdataMod;
  const { SkillRuntime } = skillsMod;

  // 测试页·设置敌人用游戏自己的波次构建器（`buildNormalWave`）。
  // ESM 按 URL 缓存 ⇒ 这里 import 到的是和游戏自己那棵树里的**同一个模块实例**。
  // ⚠️ 赋给**模块级**的 `wavesMod`（在 L4-handler 那段声明）—— 处理器是模块级函数，
  //    它们看不到 `installServerPatch` 里的局部变量（第一版就是栽在这个作用域上）。
  wavesMod = await imp('server/match/waves.js');
  // 测试页·设置盟约层数的上限：按游戏自己的 `shared/constants.js` BOND_LAYER_CAP（999）夹取。
  // 同样赋给模块级（处理器看不到这里的局部变量）。
  bondCap = Number.isFinite(constants.BOND_LAYER_CAP) && constants.BOND_LAYER_CAP > 0 ? constants.BOND_LAYER_CAP : 999;
  const { C2S } = protocol;
  const { ERR, PHASE } = constants;
  const { Match } = matchMod;
  const { DELAYS } = matchMod;
  const { PlayerState } = psMod;
  const { EffectDispatcher } = metaMod;
  const { Battle } = battleMod;
  const board = boardMod;
  const bands = bandsMod;

  // the shared state: the per-round budget, the battle speed, and the recorder sink
  const state = {
    pickLimit: isPickLimit(opts.pickLimit) ? opts.pickLimit : DEFAULT_PICK_LIMIT,
    // the battle speed the mod keeps for the process: applied to the current match and to every later one
    speed: isSpeed(opts.combatSpeed) ? opts.combatSpeed : 2,
    record: !!opts.record,
    logDir: opts.logDir || path.join(MOD_ROOT, 'logs'),
    logFile: null,
    // the last 自动倒转 request, echoed to the panel:
    // { on, cardId, cycles, equipCoins, idCard, done, gold, layers, stop }
    auto: null,
    // the sandbox: the deploy unlock (process-wide, see "the sandbox" below) and the deploy cap it sets (null = leave
    // the game's own 8 alone). The extra strategies are per seat (`ps.modBands`).
    sandbox: { place: false, cap: null },
    // 调度中心：最近一次设过的等级（见 handleShopLevel）。整局进程一份，和 `sandbox` 一样。
    shopLevel: { level: 1 },
    // the unit rules (see "the unit rules" below): the config the panel last sent, plus the seat that sent it (the
    // 换技能 half is that seat's alone — the stats / 技力 half is process-wide when the scope is 全场).
    unit: null,
    // the master switches (g.modEnable): every gameplay-changing group starts ON, so a session that never touches them
    // behaves exactly as before they existed. Living on `state` (process-wide) is the point: a switch flipped in one
    // match stays flipped for the next one, and there is nothing per-match to lose.
    // 测试页：最近一次设过的值，只为面板回显（见 handleTestFunds / handleTestRound / handleTestCap）。
    // 整局进程一份，和 `sandbox` / `shopLevel` 一样 —— 真实状态始终在游戏自己的对象上。
    // `enemy.installed` 记录影子补丁有没有装过（见 installTestEnemy）。
    test: {
      funds: null,
      round: null,
      roundCap: null,
      map: null,
      bond: null,
      matchId: null,
      // 出怪组合全集：面板要「看第几回合」「要不要把全部 boss 都列出来」。
      // `combos` 是**视图缓存**（键含 matchId/回合/boss/solo），不是账本 —— 只为了不在每帧重算。
      comboRound: null,
      timer: { combat: null, prep: null },
      comboAll: false,
      boss: null,
      combos: null,
      enemy: { list: [], wave: null, installed: false },
    },
    enable: featureDefaults(),
  };
  if (state.record) {
    try {
      state.logFile = openLog(state.logDir);
    } catch (e) {
      log.warn(`打不开日志目录，本局不记录：${e?.message || e}`);
      state.record = false;
    }
  }

  // ---- 1. the intents --------------------------------------------------------------------------------
  if (!C2S || typeof C2S !== 'object') return { ok: false, missing: ['shared/protocol.js C2S'], logFile: null };
  if (!Object.hasOwn(C2S, PICK_TYPE)) {
    C2S[PICK_TYPE] = { slot: isPickSlot, id: isPickId };
    log.info(`registered intent ${PICK_TYPE}`);
  }
  if (!Object.hasOwn(C2S, BUY_TYPE)) {
    C2S[BUY_TYPE] = { id: isPickId };
    log.info(`registered intent ${BUY_TYPE}`);
  }
  if (!Object.hasOwn(C2S, CONFIG_TYPE)) {
    C2S[CONFIG_TYPE] = { pickLimit: isPickLimit };
    log.info(`registered intent ${CONFIG_TYPE}`);
  }
  if (!Object.hasOwn(C2S, SPEED_TYPE)) {
    C2S[SPEED_TYPE] = { n: isSpeed };
    log.info(`registered intent ${SPEED_TYPE}`);
  }
  if (!Object.hasOwn(C2S, AUTO_TYPE)) {
    C2S[AUTO_TYPE] = { on: isBool, cardIds: isAutoTargets, cycles: isCycles, equipCoins: isBool, idCard: isBool, refresh: isBool, mode: isAutoMode };
    log.info(`registered intent ${AUTO_TYPE}`);
  }
  if (!Object.hasOwn(C2S, BANDS_TYPE)) {
    C2S[BANDS_TYPE] = { ids: isIdList };
    log.info(`registered intent ${BANDS_TYPE}`);
  }
  if (!Object.hasOwn(C2S, PLACE_TYPE)) {
    C2S[PLACE_TYPE] = { on: isBool, cap: isDeployCap };
    log.info(`registered intent ${PLACE_TYPE}`);
  }
  if (!Object.hasOwn(C2S, SHOPLEVEL_TYPE)) {
    // level 是 1..6 的整数；不合法就让 handleShopLevel 再兜一次（它自己 clamp）。
    C2S[SHOPLEVEL_TYPE] = { level: (v) => Number.isInteger(v) && v >= 1 && v <= 6 };
    log.info(`registered intent ${SHOPLEVEL_TYPE}`);
  }
  if (!Object.hasOwn(C2S, UNIT_TYPE)) {
    C2S[UNIT_TYPE] = { cfg: isUnitCfg };
    log.info(`registered intent ${UNIT_TYPE}`);
  }
  if (!Object.hasOwn(C2S, TESTFUNDS_TYPE)) {
    // funds 是 0..99999 的整数；更宽的范围没有意义，只会让面板更容易填错。
    C2S[TESTFUNDS_TYPE] = { funds: (v) => Number.isInteger(v) && v >= 0 && v <= 99999 };
    log.info(`registered intent ${TESTFUNDS_TYPE}`);
  }
  if (!Object.hasOwn(C2S, TESTROUND_TYPE)) {
    C2S[TESTROUND_TYPE] = { round: (v) => Number.isInteger(v) && v >= 1 && v <= 99 };
    log.info(`registered intent ${TESTROUND_TYPE}`);
  }
  if (!Object.hasOwn(C2S, TESTCAP_TYPE)) {
    C2S[TESTCAP_TYPE] = { round: (v) => Number.isInteger(v) && v >= 1 && v <= 99 };
    log.info(`registered intent ${TESTCAP_TYPE}`);
  }
  if (!Object.hasOwn(C2S, TESTENEMY_TYPE)) {
    // `list` 与 `wave` 都可选（`$optional` 是协议的约定，见 `shared/protocol.js` 的 `validateC2S`）：
    // 只给 `list` = 用自定义名单；只给 `wave` = 整份换成某个现成的波次模板；两个都给 = 名单优先。
    // 两边都不给（或都给空）就是**恢复原样**。
    C2S[TESTENEMY_TYPE] = {
      $optional: ['list', 'wave'],
      list: (v) => Array.isArray(v) && v.length <= 64
        && v.every((e) => e && typeof e === 'object' && !Array.isArray(e)
          && typeof e.key === 'string' && e.key.length >= 1 && e.key.length <= 64
          && Number.isInteger(e.count) && e.count >= 1 && e.count <= 50),
      wave: (v) => v === null || (typeof v === 'string' && v.length >= 1 && v.length <= 64),
    };
    log.info(`registered intent ${TESTENEMY_TYPE}`);
  }
  if (!Object.hasOwn(C2S, TESTMAP_TYPE)) {
    // 地图 id：data/stages.json 的键。**存不存在由处理器去查 gd**（这里只管形状）——
    // 「这张图能不能在这一局用」是数据与玩法的事，不是协议的事。
    C2S[TESTMAP_TYPE] = { stageId: (v) => typeof v === 'string' && v.length >= 1 && v.length <= 64 };
    log.info(`registered intent ${TESTMAP_TYPE}`);
  }
  if (!Object.hasOwn(C2S, TESTBOND_TYPE)) {
    // 盟约 id：data/bonds.json 的键；层数 0..999（游戏自己的 BOND_LAYER_CAP 也是 999）。
    // 同样只管形状：id 存不存在由处理器去查 gd。
    C2S[TESTBOND_TYPE] = { bondId: (v) => typeof v === 'string' && v.length >= 1 && v.length <= 64,
      layers: (v) => Number.isInteger(v) && v >= 0 && v <= 999 };
    log.info(`registered intent ${TESTBOND_TYPE}`);
  }
  if (!Object.hasOwn(C2S, TESTCOMBOS_TYPE)) {
    // 只要「看第几回合」和「列不列全部 boss」两个开关；两个都可以不给（默认看本局当前回合）。
    C2S[TESTCOMBOS_TYPE] = {
      $optional: ['round', 'all'],
      round: (v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 99),
      all: (v) => v === null || typeof v === 'boolean',
    };
    log.info(`registered intent ${TESTCOMBOS_TYPE}`);
  }
  if (!Object.hasOwn(C2S, TESTBOSS_TYPE)) {
    // 自选 boss：只给一个 bossId（boss_1..boss_10），服务端跳到 boss 回合并换成这一只。
    C2S[TESTBOSS_TYPE] = { bossId: (v) => typeof v === 'string' && v.length > 0 && v.length <= 32 };
    log.info(`registered intent ${TESTBOSS_TYPE}`);
  }
  if (!Object.hasOwn(C2S, TESTTIMER_TYPE)) {
    // 时限：两个字段都可省，给了就是改哪一条（null = 恢复游戏原本的值）。
    C2S[TESTTIMER_TYPE] = {
      combat: (v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 9999),
      prep: (v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 9999),
    };
    log.info(`registered intent ${TESTTIMER_TYPE}`);
  }
  if (!Object.hasOwn(C2S, SHOPFILTER_TYPE)) {
    C2S[SHOPFILTER_TYPE] = { on: isBool, bonds: isIdList, mode: isFilterMode };
    log.info(`registered intent ${SHOPFILTER_TYPE}`);
  }
  if (!Object.hasOwn(C2S, DIY_TYPE)) {
    C2S[DIY_TYPE] = { slots: isDiySlots, extra: isDiyExtras, skills: isDiySkills, mods: isDiyMods };
    log.info(`registered intent ${DIY_TYPE}`);
  }
  if (!Object.hasOwn(C2S, ENABLE_TYPE)) {
    C2S[ENABLE_TYPE] = { features: isFeatures };
    log.info(`registered intent ${ENABLE_TYPE}`);
  }

  // ---- 2. the router (+ the raw-intent log) ----------------------------------------------------------
  if (typeof Match?.prototype?.handle !== 'function') {
    missing.push('Match.prototype.handle');
  } else {
    const origHandle = Match.prototype.handle;
    Match.prototype.handle = function handle(playerId, msg) {
      let res;
      if (msg && typeof msg.t === 'string' && msg.t.startsWith('g.mod')
        && !(this.experimental && this.experimental.luckConsole === true)) {
        const denied = fail(ERR.BAD_TARGET, '这一局没有开启 Luck 测试插件（房间的实验性选项）');
        recordIntent(state, log, this, playerId, msg, denied);
        return denied;
      }
      if (msg && msg.t === PICK_TYPE) res = handlePick(this, playerId, msg, state, ERR);
      else if (msg && msg.t === BUY_TYPE) res = handleBuy(this, playerId, msg, state, ERR);
      else if (msg && msg.t === CONFIG_TYPE) res = handleConfig(this, playerId, msg, state, ERR);
      else if (msg && msg.t === SPEED_TYPE) res = handleSpeed(this, playerId, msg, state, ERR);
      else if (msg && msg.t === AUTO_TYPE) res = handleAuto(this, playerId, msg, state, ERR, log);
      else if (msg && msg.t === BANDS_TYPE) res = handleBands(this, playerId, msg, state, ERR);
      else if (msg && msg.t === PLACE_TYPE) res = handlePlace(this, playerId, msg, state, ERR);
      else if (msg && msg.t === SHOPLEVEL_TYPE) res = handleShopLevel(this, playerId, msg, state, ERR);
      else if (msg && msg.t === UNIT_TYPE) res = handleUnit(this, playerId, msg, state, ERR);
      else if (msg && msg.t === SHOPFILTER_TYPE) res = handleShopFilter(this, playerId, msg, state, ERR);
      else if (msg && msg.t === DIY_TYPE) res = handleModDiy(this, playerId, msg, state, ERR);
      else if (msg && msg.t === ENABLE_TYPE) res = handleEnable(this, playerId, msg, state, ERR);
      else if (msg && msg.t === TESTFUNDS_TYPE) res = handleTestFunds(this, playerId, msg, state, ERR);
      else if (msg && msg.t === TESTROUND_TYPE) res = handleTestRound(this, playerId, msg, state, ERR);
      else if (msg && msg.t === TESTCAP_TYPE) res = handleTestCap(this, playerId, msg, state, ERR);
      else if (msg && msg.t === TESTENEMY_TYPE) res = handleTestEnemy(this, playerId, msg, state, ERR);
      else if (msg && msg.t === TESTMAP_TYPE) res = handleTestMap(this, playerId, msg, state, ERR);
      else if (msg && msg.t === TESTBOND_TYPE) res = handleTestBond(this, playerId, msg, state, ERR);
      else if (msg && msg.t === TESTCOMBOS_TYPE) res = handleTestCombos(this, playerId, msg, state, ERR);
      else if (msg && msg.t === TESTBOSS_TYPE) res = handleTestBoss(this, playerId, msg, state, ERR);
      else if (msg && msg.t === TESTTIMER_TYPE) res = handleTestTimer(this, playerId, msg, state, ERR);
      else res = origHandle.call(this, playerId, msg);
      recordIntent(state, log, this, playerId, msg, res);
      return res;
    };
    log.info('hooked Match.prototype.handle');
  }

  // ---- 3. the slot swap, the direct buy, and the pickable/quota view ---------------------------------
  if (typeof PlayerState?.prototype?.privateView !== 'function') {
    missing.push('PlayerState.prototype.privateView');
  } else if (typeof PlayerState.prototype.modPickSlot !== 'function') {
    PlayerState.prototype.modPickSlot = function modPickSlot(slotIdx, id) {
      return pickSlot(this, slotIdx, id, { ERR, PHASE });
    };
    PlayerState.prototype.modBuyDirect = function modBuyDirect(id) {
      return directBuy(this, id, { ERR });
    };
    const origPrivateView = PlayerState.prototype.privateView;
    PlayerState.prototype.privateView = function privateView() {
      const view = origPrivateView.call(this);
      try {
        if (view && view.shop) {
          view.shop.modPickable = { ...pickable(this), quota: quotaView(this, state) };
          // the 阵营锁: this seat's own setting, the bonds it may name, and how many operators pass it right now
          view.shop.modShopFilter = shopFilterView(this);
        }
        // the battle speed the match is running at — the panel marks the button from this (never its own memory)
        if (view) view.modSpeed = speedView(this, state);
        // and how fast the fixed presentation steps are running (see installPresentationScale)
        if (view) view.modPace = paceView(this, state);
        // the last 自动倒转 result — the panel marks its button and shows the tally from this too
        if (view) view.modAuto = state.auto;
        // the sandbox: this seat's extra strategies and the process-wide deploy unlock
        if (view) view.modSandbox = sandboxView(this, state);
        // the unit rules: the config the server holds (the panel compares its own against this before pushing)
        if (view) view.modUnits = state.unit;
        // the 自选位 kit: the per-slot overrides the server holds (process-wide — the def patcher cannot see a seat)
        if (view) view.modDiy = { slots: diyCfgView(), extra: diyExtrasView(), skills: { ...diySkills }, mods: { ...diyMods } };
        // the master switches: the panel renders FROM this, not from its own memory, so a second tab (or a reload)
        // shows the switches the server is actually honouring
        if (view) view.modEnable = { ...state.enable };
      } catch (e) {
        log.warn('modPickable failed', e?.message || e);
      }
      return view;
    };
    log.info('hooked PlayerState (privateView + modPickSlot + modBuyDirect)');
  }

  // ---- 4. the battle speed sticks to the match --------------------------------------------------------
  if (typeof Match?.prototype?.start !== 'function') {
    missing.push('Match.prototype.start');
  } else {
    const origStart = Match.prototype.start;
    Match.prototype.start = function start(...args) {
      // 本局没有勾选「Luck 测试插件」（房间的实验性选项）：把进程级的改动全部收回，倍速交回游戏自己。
      // sandbox / 自选位 / 技能与属性 / 调度中心都是整进程状态，不收回就会漏到下一局；这条保证
      // 「没勾选 = 完全不影响对局」，即使同一进程里上一局开过 Luck。rollbackFeature 就是总开关逐项关掉走的路。
      if (!(this.experimental && this.experimental.luckConsole === true)) {
        for (const k of FEATURE_KEYS) {
          try { rollbackFeature(this, state, k); } catch (e) { log.warn('luck-off reset failed', e?.message || e); }
        }
        state.speed = null;
      }
      // the lobby builds a fresh Match per game; the speed the player chose survives across those
      if (state.speed && state.speed !== this.gameSpeed) {
        try { applyGameSpeed(this, state.speed); } catch (e) { log.warn('apply speed failed', e?.message || e); }
      }
      state.auto = null; // a new game starts with the auto reverse off, whatever the last one left behind
      return origStart.apply(this, args);
    };
    log.info('hooked Match.prototype.start');
  }

  // ---- 4b. the fixed presentation steps follow the battle speed ---------------------------------------
  missing.push(...installPresentationScale({ Match, DELAYS, state, log }));

  // ---- 5. the sandbox --------------------------------------------------------------------------------
  const sandboxMissing = installSandbox({ Match, PlayerState, EffectDispatcher, board, Battle, bands, state, log });
  missing.push(...sandboxMissing);

  // ---- 5a. the shop bond filter (阵营锁) --------------------------------------------------------------
  missing.push(...installShopFilter({ PlayerState, log }));


  // ---- 5b. the unit rules (技能 / 技力 / 属性) ---------------------------------------------------------
  missing.push(...installUnitRules({ PlayerState, DataSource, SkillRuntime, state, log }));

  // ---- 5c. the 自选位 kit (盟约 / 特质 / 数值) ---------------------------------------------------------
  missing.push(...installSlotRules({ PlayerState, Battle, GameData: gamedataMod.GameData, DataSource, support: supportMod, diyMod, diyDataMod, bondsMetaMod, log }));

  // ---- 6. the recorder -------------------------------------------------------------------------------
  if (state.record) {
    const recMissing = installRecorder({ Match, PlayerState, state, log });
    if (recMissing.length) log.warn(`录制锚点没找到（这几类事件不会出现）：${recMissing.join(', ')}`);
    else log.info('recorder installed');
  }

  if (missing.length) log.warn(`anchors not found (the mod is partially inert): ${missing.join(', ')}`);
  return { ok: missing.length === 0, missing, logFile: state.logFile };
}

// -----------------------------------------------------------------------------------------------------
// the per-round budget
// -----------------------------------------------------------------------------------------------------

/**
 * This seat's budget for the current round. The counter lives outside `ps.round` because startRound replaces that
 * whole object; a round change is detected lazily by comparing `m.round`.
 */
function quota(ps) {
  const r = ps?.m?.round ?? 0;
  if (!ps.__modQuota || ps.__modQuota.round !== r) ps.__modQuota = { round: r, used: 0 };
  return ps.__modQuota;
}

/** 0 = unlimited. */
const overQuota = (ps, state) => state.pickLimit > 0 && quota(ps).used >= state.pickLimit;

/** What the panel reads: how many of this round's actions are spent, and the cap (0 = 不限). */
function quotaView(ps, state) {
  return { used: quota(ps).used, limit: state.pickLimit };
}

/** What the panel reads: the speed the match is actually running at (2 = the game's own baseline). */
function speedView(ps, state) {
  const n = Number(ps?.m?.gameSpeed);
  return Number.isFinite(n) && n > 0 ? n : state.speed;
}

/**
 * What the panel reads: how fast the fixed presentation steps (see installPresentationScale) are running. 1 = the game's
 * own pacing; below 1 the 结算 / 回合开始 / 战斗结束 waits have been shortened to match the battle speed.
 */
function paceView(ps, state) {
  const n = speedView(ps, state);
  let solo = false;
  try { solo = !!ps?.m?.soloUntimed; } catch { solo = false; }
  return { delayScale: solo && n > GAME_SPEED ? GAME_SPEED / n : 1, solo };
}

// -----------------------------------------------------------------------------------------------------
// the intent owners
// -----------------------------------------------------------------------------------------------------

/** Mirrors Match.handle's guard (bots/left can't act, spectators only watch, no acting after the match ended). */
function seatFor(match, playerId) {
  const ps = match.players?.get(playerId) || match.spectators?.get(playerId);
  if (!ps || ps.isBot || ps.left) return { error: fail('NOT_IN_ROOM') };
  if (ps.spectator) return { error: fail('SPECTATOR') };
  if (match.disposed || match.ended) return { error: fail('WRONG_PHASE') };
  return { ps };
}

/**
 * Shared body of the two mod actions: gate, run, flush, then bill the round's budget only on success.
 *
 * `bills(ps)` says whether THIS action costs a pick. 装备 does not (author, 2026-10-10): the budget is there to pace
 * how fast you can stuff 干员 into your board, and an item is bought and equipped on the spot. So placing or buying an
 * item is free AND still possible after the round's budget is spent — neither the gate nor the counter touches it.
 */
function runModAction(match, playerId, state, ERR, name, body, bills = null) {
  const seat = seatFor(match, playerId);
  if (seat.error) return seat.error;
  const ps = seat.ps;
  let charged = true;
  try { charged = bills ? !!bills(ps) : true; } catch { charged = true; }
  if (charged && overQuota(ps, state)) {
    return fail(MOD_LIMIT, `本回合自选次数已用完（${state.pickLimit}）`);
  }
  let res;
  try {
    res = body(ps);
  } catch (e) {
    match.reportError?.(name, e);
    res = fail('INTERNAL');
  }
  // bill BEFORE the flush: the pushed private view carries the quota, so counting after it would show the panel the
  // value from one action ago (and nothing else flushes until the next one).
  if (charged && !(res && res.error)) quota(ps).used++;
  try {
    match.flush();
  } catch (e) {
    match.reportError?.('flush', e);
  }
  return res && res.error ? res : OK;
}

/** Whether `id` names an operator rather than a piece of equipment (the same test directBuy uses). */
const isChessId = (ps, id) => !!ps?.gd?.chess?.(id);

function handlePick(match, playerId, msg, state, ERR) {
  if (!state.enable.shop) return fail(ERR.BAD_TARGET, '自选商店已关闭（总开关）');
  return runModAction(match, playerId, state, ERR, 'modPick', (ps) => ps.modPickSlot(msg.slot, msg.id), (ps) => isChessId(ps, msg.id));
}

function handleBuy(match, playerId, msg, state, ERR) {
  if (!state.enable.shop) return fail(ERR.BAD_TARGET, '自选商店已关闭（总开关）');
  return runModAction(match, playerId, state, ERR, 'modBuy', (ps) => ps.modBuyDirect(msg.id), (ps) => isChessId(ps, msg.id));
}

/** g.modConfig { pickLimit } — the panel sets the per-round budget (0 = 不限). Not billed to the budget itself. */
function handleConfig(match, playerId, msg, state, ERR) {
  if (!state.enable.shop) return fail(ERR.BAD_TARGET, '自选商店已关闭（总开关）');
  const seat = seatFor(match, playerId);
  if (seat.error) return seat.error;
  if (!isPickLimit(msg.pickLimit)) return fail(ERR.BAD_TARGET, '次数上限不合法');
  state.pickLimit = msg.pickLimit;
  try {
    seat.ps.dirty?.();
    match.flush();
  } catch (e) {
    match.reportError?.('flush', e);
  }
  return OK;
}

/**
 * g.modSpeed { n } — the battle speed: game seconds per real second. 2 is the game's own forced baseline, so this
 * only moves the knob the engine already has (`Match.gameSpeed`, from `opts.combatSpeed`): every client battle's
 * `b.start.speed`, the server-run fields' tick rate, and every deadline/release behind them. It never touches the
 * simulation, so a battle plays out tick for tick the same at any speed. Not billed to the round's budget.
 */
function handleSpeed(match, playerId, msg, state, ERR) {
  const seat = seatFor(match, playerId);
  if (seat.error) return seat.error;
  if (!isSpeed(msg.n)) return fail(ERR.BAD_TARGET, `倍速要取 ${MIN_SPEED}–${MAX_SPEED} 的整数`);
  state.speed = msg.n;
  try {
    applyGameSpeed(match, msg.n);
  } catch (e) {
    match.reportError?.('modSpeed', e);
    return fail('INTERNAL');
  }
  try {
    seat.ps.dirty?.(); // ship the new modSpeed in the next private view (and retrigger the panel)
    match.flush();
  } catch (e) {
    match.reportError?.('flush', e);
  }
  return OK;
}

// -----------------------------------------------------------------------------------------------------
// the auto buy/sell (自动买卖, g.modAuto): buy a target operator → cash in what it drops → sell it back, on repeat
//
// The player drives this from the panel: while the toggle is on it keeps sending the same `g.modAuto` batch, so
// every call runs a bounded number of cycles and the loop stops by itself when the seat readies, the shop closes
// or the money runs out. Nothing here is billed to the round's pick budget — that budget is for hand-made picks.
//
// It only ever touches what it bought this cycle (the piece, and the coins THAT piece just dropped): coins and
// operators double as a piggy bank, so the loop must not sell or spend anything it did not itself bring in.
//
// SEVERAL TARGETS SHARE ONE LOOP (author, 2026-10-11). `cardIds` is the panel's ticked set, not one card: each cycle
// buys whichever ticked card is on the table. The cards are not interchangeable — their payouts differ in WHEN they
// land, and that is what the class in auto-rules.js encodes (`autoCardAllowedNow`):
//
//   'now'      pays this prep (盟约之币 / 免费刷新 / 白嫖干员 / 1 金价) — always buyable.
//   'deferred' pays NEXT prep (能天使 & 新约能天使 on 获得, 泥岩 & 格雷伊 on 售出: SERVER_ONCE_GOLD). Only worth taking
//              while the loop is PAYING for its rolls, where next prep's gold offsets today's spend; while the rolls
//              are free it is dead weight, so it is skipped. What counts as free is `isRefreshFree` — 奇迹 at or past
//              its 100-layer milestone, plus any free-refresh credit already in hand.
//   'item'     drops an item the loop cannot cash (不融冰 / 定制品 / …) — never in the loop normally, so the panel
//              leaves it unticked; if the player ticks it anyway, the loop buys it like any other target.
//
// Two gates ride on top of the classes, both only in the PAID regime:
//
//   * `economy` — 收费时既然决定自动倒转了，那肯定是只抓经济牌 (author). 焰尾 lands an operator rather than gold, so it
//     is out; the four 下期 cards are in, since the gold they hand over next prep offsets today's rolls.
//   * a FREE round trip — 远见's permanent −1 turns a two-gold operator into one gold, and 售出 gives one back, so
//     buying and selling that card nets nothing: 「就变得可抓可卖了」, the same deal 至简 already gets from its own
//     购买价格为 1. `roundTripNet(ps, id) >= 0` is that test, and it lets a card the class list would have turned away
//     (焰尾 included) back into the loop.
//
// TWO WAYS TO GET A TARGET IN, and the difference is the whole point of `mode`:
//
//   'shop'   (default) — the game's own shop. `buy` / `refresh` / `sell` / `equip` are plain PlayerState verbs, the
//                        ones the player's own buttons call: no mod feature is involved, so this works in a match with
//                        every master switch off. With `refresh` on it rolls for the targets, which is what makes it a
//                        loop rather than a one-shot: 奇迹 at enough layers makes the roll free (bond_refresh_shop_next_free)
//                        and 远见 at layer2 makes every operator cost 1 less (permanently), so the two together are a
//                        self-funding engine. While the rolls are FREE `misses` bounds the hunting (a card the shop is
//                        not offering has to stop the run instead of spinning forever); while they are PAID the seat's
//                        own funds are the bound, and the loop just keeps rolling — 作者 2026-10-11: 「你如果没碰到
//                        经济牌的话，那就接着刷」.
//   'direct' — the mod's 直购 (straight into the hand, no slot, no roll). That is a GAMEPLAY change and belongs to the
//              自选商店 group: it is refused when that group's master switch is off. Kept because it still works in a
//              match whose shop cannot produce a target at all (a banned card, a level the shop will not reach).
// -----------------------------------------------------------------------------------------------------

/** consume-on-equip items that pay gold the moment they are equipped (盟约之币, 骑士储蓄罐) — the loop cashes these in. */
const COIN_IDS = new Set(['chess_item_1_03_e_a', 'chess_item_1_03_e_b', 'chess_item_3_12_e_a', 'chess_item_3_12_e_b']);
/** 随身身份牌 — equip-and-destroy, +3 layers to the carrier's bond (golden +6): gold into layers. */
const ID_CARD_ID = 'chess_item_1_04_e_a';
/** keep this much back before spending on an identity card, so the loop itself never starves. */
const ID_CARD_RESERVE = 3;
/** the bond the identity cards are aimed at; a carrier of this bond is preferred, any other operator is the fallback. */
const ID_CARD_PREFER_BOND = 'visiShip';
/** Consecutive shop rolls without the target before a batch gives up (see "the auto buy/sell"). A constant, not a knob:
 *  it only has to be large enough that a rare-but-present card is found, and small enough that a card the shop cannot
 *  offer stops the run rather than spinning. */
const AUTO_MAX_MISSES = 40;

/** Every uid this seat owns right now: chess on board/hand/temp, plus items lying in the hand/temp. */
function ownedUids(ps) {
  const s = new Set();
  for (const p of ps.allChess()) s.add(p.uid);
  for (const arr of [ps.hand, ps.temp]) for (const p of arr) if (p && p.kind === 'item') s.add(p.uid);
  return s;
}

/** Σ layers over the ACTIVE bonds — what the loop reports as "层数涨了多少". */
function activeLayers(ps) {
  try { return ps.activatedLayers(); } catch { return 0; }
}

/** 奇迹 — the bond whose layer count decides which of the two rolling regimes the loop is in. */
const FREE_REFRESH_BOND = 'miraShip';
/** 奇迹到家这一层，作者就按「刷新免费」那一套倒（100 是奇迹自己的层数里程碑）。 */
const FREE_REFRESH_LAYERS = 100;

/**
 * Is the loop rolling for free right now? Two regimes, and the author named the switch between them (2026-10-11):
 *
 *   * **奇迹满一百** — 按免费刷那一套走；
 *   * **奇迹不满一百** — 按收费刷那一套走。
 *
 * Plus one certain case on top: a free-refresh credit already in hand (`ps.shop.freeRefreshes > 0`, what 普罗旺斯 /
 * 德克萨斯 / 奇迹's own grant hand out) makes THIS roll free no matter what, so it belongs on the free side too.
 *
 * The layer number is `ps.layers[奇迹]` — the same field the engine's own `layersIn` reads, and the number the bond
 * strip shows. (`gd.refreshPrice === 0` is the degenerate third case: a shop whose rolls never cost anything.)
 */
function isRefreshFree(ps) {
  if ((Number(ps?.shop?.freeRefreshes) || 0) > 0) return true;
  const layers = Number(ps?.layers?.[FREE_REFRESH_BOND]);
  if (Number.isFinite(layers) && layers >= FREE_REFRESH_LAYERS) return true;
  return Number(ps?.gd?.refreshPrice) === 0;
}

/**
 * What one buy→sell round trip nets for `id` RIGHT NOW. `>= 0` means the loop can run that card through itself for
 * free, which makes it a target for the PAID regime the same way 至简 is (作者 2026-10-11: 远见 −1 之后原价两块变一块,
 * 卖掉还一块, 「变得可抓可卖了」).
 *
 * The buy side goes through the same price chain a real purchase does — `priceOf` on a slot shaped exactly like the
 * one `directBuy` mints and the one the roll builds — so every on-price discount (远见's permanent −1, 至简's own
 * 购买价格为 1) lands in it. The sell side is `gd.sellPrice`, what `sell()` pays before its onSold dispatch.
 */
function roundTripNet(ps, id) {
  const price = Number(ps.priceOf({ kind: 'chess', id, basePrice: ps.gd.chessPrice(id), frozen: false, sold: false }));
  if (!Number.isFinite(price)) return -1;
  const gain = Number(ps.gd.sellPrice(id));
  return (Number.isFinite(gain) ? Math.max(0, Math.trunc(gain)) : 1) - price;
}

/** The operator the last directBuy actually put in hand: an owned copy of `cardId` whose uid is new. */
function boughtPiece(ps, before, cardId) {
  for (const p of ps.allChess()) if (!before.has(p.uid) && p.id === cardId) return p;
  return null;
}

/** Items that appeared in the hand/temp since `before` — what a 获得时 trait just dropped. */
function freshItems(ps, before) {
  const out = [];
  for (const arr of [ps.hand, ps.temp]) for (const p of arr) if (p && p.kind === 'item' && !before.has(p.uid)) out.push(p);
  return out;
}

/** Where an identity card should go: an operator of the preferred bond, else anything on the board/hand. */
function idCardCarrier(ps) {
  const chess = ps.allChess();
  const bondsOf = (p) => (ps.gd.chess(p.id) || {}).bonds || [];
  return chess.find((p) => bondsOf(p).includes(ID_CARD_PREFER_BOND)) || chess[0] || null;
}

/** The unsold shop slot holding `id`, or -1. The shop is the seat's own roll already on the table. */
function findShopSlot(ps, id) {
  const slots = ps.shop?.slots || [];
  for (let i = 0; i < slots.length; i++) if (slots[i] && !slots[i].sold && slots[i].id === id) return i;
  return -1;
}

/** One batch of the loop. Returns what happened so the panel (and the log) can show it. */
function autoLoop(ps, cfg, { ERR, allowDirect = true }) {
  const gold0 = ps.funds;
  const layers0 = activeLayers(ps);
  const wanted = cfg.cardIds.filter((id) => ps.gd.chess(id));
  const shopMode = cfg.mode !== 'direct';
  const bought = {};
  let done = 0;
  let refreshes = 0;
  let misses = 0;
  let free = isRefreshFree(ps); // which rolling regime this batch is in (echoed so the panel can say so)
  let stop = 'cycles';
  if (wanted.length === 0) return { done, refreshes, gold: 0, layers: 0, stop: 'bad-card', free };
  if (!shopMode && !allowDirect) return { done, refreshes, gold: 0, layers: 0, stop: 'direct-off', free };
  while (done < cfg.cycles) {
    const gate = ps._gate();
    if (gate) { stop = gate.error === ERR.WRONG_PHASE && ps.ready ? 'ready' : (gate.detail || gate.error); break; }
    // what this cycle may buy: the ticked ids, minus the ones the class rules gate out (deferred while rolls are free)
    // and the ones whose purchase would merge into an operator the seat already owns (that would eat the piece instead
    // of returning it). Re-tested every cycle — a roll can flip `isRefreshFree` and an identity card can change `funds`.
    free = isRefreshFree(ps);
    // 收费刷再多一条出路：这一进一出不亏的牌，等于至简，抓了不花钱（远见减价之后两张价的牌都到这一步）
    const allowed = wanted.filter((id) => autoCardAllowedNow(id, free) || (!free && roundTripNet(ps, id) >= 0));
    const pool = allowed.filter((id) => !ps.completesChessMerge(id));
    if (pool.length === 0) { stop = allowed.length ? 'would-merge' : (free ? 'all-deferred' : 'no-economy'); break; }
    let slotIdx = -1;
    let cardId = null;
    if (shopMode) {
      for (const id of pool) { const i = findShopSlot(ps, id); if (i >= 0) { slotIdx = i; cardId = id; break; } }
      if (slotIdx < 0) {
        // not on the table: roll for one, the way the player's own 刷新 button would. The game decides the price (free
        // while a 奇迹 credit is in hand), so nothing here needs to know how the roll is paid for.
        if (!cfg.refresh) { stop = 'no-target'; break; }
        const r = ps.refresh();
        refreshes++;
        if (r && r.error) { stop = r.detail || r.error; break; }
        // 免费刷时一滚不花钱，找不到目标就会一直转，所以这里得收；收费刷时每一滚都记在账上，作者（2026-10-11）说
        // 「没碰到经济牌就接着刷」，钱花光 `refresh()` 自己会拒，所以不另设上限。
        if (free && ++misses >= cfg.maxMisses) { stop = 'no-target'; break; }
        continue; // a roll is not one of the `cycles`; `misses` (免费刷) or the funds (收费刷) is what bounds this
      }
    } else {
      // 直购: no slot to look at, so take the first ticked card the seat can afford
      cardId = pool.find((id) => ps.funds >= ps.gd.chessPrice(id)) || null;
      if (!cardId) { stop = 'no-funds'; break; }
    }
    const price = slotIdx >= 0 ? ps.priceOf(ps.shop.slots[slotIdx]) : ps.gd.chessPrice(cardId);
    if (ps.funds < price) { stop = 'no-funds'; break; }

    const before = ownedUids(ps);
    const err = slotIdx >= 0 ? (() => { const r = ps.buy(slotIdx); return r && r.error ? r : null; })() : directBuy(ps, cardId, { ERR });
    if (err) { stop = err.detail || err.error; break; }
    const piece = boughtPiece(ps, before, cardId);
    if (!piece) { stop = 'no-piece'; break; }
    misses = 0;
    bought[cardId] = (bought[cardId] || 0) + 1;
    if (cfg.equipCoins) for (const it of freshItems(ps, before)) if (COIN_IDS.has(it.id)) ps.equip(it.uid, piece.uid);
    const sold = ps.sell(piece.uid);
    if (sold && sold.error) { stop = sold.detail || sold.error; break; }
    done++;
    if (cfg.idCard) spendOnIdCard(ps, ERR);
  }
  return { done, refreshes, gold: ps.funds - gold0, layers: activeLayers(ps) - layers0, stop, bought, free };
}

/** Buy one 随身身份牌 and put it on the operator whose bond we are stacking (no-op when there is no room/money). */
function spendOnIdCard(ps, ERR) {
  if (ps.funds < ID_CARD_RESERVE) return;
  const carrier = idCardCarrier(ps);
  if (!carrier) return;
  const before = ownedUids(ps);
  if (directBuy(ps, ID_CARD_ID, { ERR })) return;
  const card = freshItems(ps, before).find((it) => it.id === ID_CARD_ID);
  if (card) ps.equip(card.uid, carrier.uid);
}

/**
 * g.modAuto { on, cardIds, cycles, equipCoins, idCard, refresh, mode } — one batch of the auto buy/sell. `cardIds` is
 * the panel's ticked set (see the section header for what the classes do). `on: false` is the stop signal (the panel
 * sends it when the toggle goes off); it just records the request and does nothing else. The result of every batch is
 * echoed back through `privateView.modAuto` and, as one summary line, into the log.
 * Not billed to the round's budget (the panel re-sends this many times a second).
 */
function handleAuto(match, playerId, msg, state, ERR, log) {
  const seat = seatFor(match, playerId);
  if (seat.error) return seat.error;
  if (!isBool(msg.on) || !isAutoTargets(msg.cardIds) || !isCycles(msg.cycles) || !isBool(msg.equipCoins) || !isBool(msg.idCard)
    || !isBool(msg.refresh) || !isAutoMode(msg.mode)) {
    return fail(ERR.BAD_TARGET, '自动买卖参数不合法');
  }
  const ps = seat.ps;
  // Keep only what the catalogue knows AND this match's data has: the class lookup is the server's own, so a stale or
  // hand-rolled panel cannot smuggle in a card by claiming a class. Duplicates collapse, order is the panel's.
  const cardIds = [...new Set(msg.cardIds)].filter((id) => autoClassOf(id) && ps.gd.chess(id));
  if (msg.on && cardIds.length === 0) return fail(ERR.BAD_TARGET, '没有可用的倒转目标');
  const call = {
    on: msg.on, cardIds, cycles: msg.cycles, equipCoins: msg.equipCoins, idCard: msg.idCard,
    refresh: msg.refresh, mode: msg.mode, maxMisses: AUTO_MAX_MISSES,
  };
  let done = 0;
  let gold = 0;
  let layers = 0;
  let refreshes = 0;
  let bought = {};
  let free = false;
  let stop = 'off';
  let on = false;
  if (call.on) {
    const saved = state.record;
    state.record = false; // one summary line, not one per buy/sell/equip
    try {
      const r = autoLoop(ps, call, { ERR, allowDirect: state.enable.shop });
      ({ done, gold, layers, refreshes, stop, bought, free } = r);
    } catch (e) {
      state.record = saved;
      match.reportError?.('modAuto', e);
      return fail('INTERNAL');
    }
    state.record = saved;
    // 'cycles' just means the batch ran out: the panel should send another. Anything else is a real stop, and
    // flipping `on` off is how the panel finds out (it is driving, so it cannot see the server's own verdict).
    on = stop === 'cycles';
  }
  state.auto = { ...call, on, done, gold, layers, refreshes, stop, bought, free };
  if (call.on) emitEvent(state, log, autoEvent(ps, state.auto));
  try {
    ps.dirty?.(); // ship the fresh modAuto in the next private view (and retrigger the panel)
    match.flush();
  } catch (e) {
    match.reportError?.('flush', e);
  }
  return OK;
}

/**
 * Point the match at `n` game seconds per real second, mid-battle included.
 *
 * Everything the game paces off `match.gameSpeed` follows by itself: the server-run fields (`FieldRunner` /
 * `HeadlessPacer` read it every pump), the fields launched from now on (`b.start.speed`), and every deadline
 * armed from here on. Two things need a nudge:
 *
 *   * a field already running — its origin `startAt` is rescaled so its game clock stays where it is
 *     (`_fieldElapsed` is `((clockNow − startAt) / 1000) × gameSpeed`, so rescaling at the moment of the change
 *     leaves the elapsed game time untouched and everything derived from it — boss pool math, timelines,
 *     releases — continuous instead of jumping);
 *   * a client field's result deadline, which was armed at the old speed: at a lower speed it would fire first
 *     and the server would take a battle over that the player is still watching.
 */
function applyGameSpeed(match, n) {
  const old = Number(match.gameSpeed);
  if (!isSpeed(n) || n === old) return;
  const now = typeof match._clockNow === 'function' ? match._clockNow() : match.sched.now();
  const live = [];
  for (const f of Array.isArray(match.fields) ? match.fields : []) {
    if (!f || f.done || !Number.isFinite(f.startAt)) continue;
    let gt = 0;
    try { gt = match._fieldElapsed(f); } catch { gt = 0; }
    live.push({ f, gt });
  }
  match.gameSpeed = n;
  for (const { f, gt } of live) f.startAt = now - (gt / n) * 1000;
  for (const { f } of live) {
    if (f.mode === 'client' && f.kind !== 'boss' && f.kind !== 'hidden') {
      if (match.paused) {
        if (f.deadlineTimer) { match.cancel(f.deadlineTimer); f.deadlineTimer = null; }
        f.rearmDeadline = true; // _resume re-arms it (matching Match.setPause's own bookkeeping)
      } else {
        try { match._armDeadline(f); } catch (e) { match.reportError?.('armDeadline', e); }
      }
    } else if (f.mode === 'server' && f.result != null) {
      // a finished server-run field waiting out its release: move the release to the new clock too
      try { match._armRelease(f); } catch (e) { match.reportError?.('armRelease', e); }
    }
  }
}

/**
 * The three fixed presentation steps between phases follow the battle speed too.
 *
 * The game parks you in plain real-time waits: 1.5 s after a battle (DELAYS.COMBAT_END, combat.js), 3 s of 结算
 * (DELAYS.SETTLE, settle.js), 2 s of 回合开始 (DELAYS.ROUND_START, phases.js), plus the 3 s BATTLE_CHECK step, which
 * shares the 3000 value. They read `Match.timerScale`, never `gameSpeed`, so at 8× they stay the same 6.5 real seconds
 * per round — that is the "顿一下" between the battle ending and the next prep (nothing is being loaded; it is the
 * game's own pacing).
 *
 * So `scaled` is wrapped and exactly those values are divided by `speed / GAME_SPEED`. Only ever shortened: at the
 * game's own 2× baseline (and at 1×, which is slower than the game ever runs) nothing changes. Only those values:
 * every other user of `scaled` is waited on for CORRECTNESS, not for pacing — BOSS_RESULT_GRACE_MS is the window a
 * client gets to report the boss result before the server synthesizes one, and shrinking that could throw away a real
 * result.
 *
 * Solo / lone-human matches only. There (`soloUntimed`) no step is timed at all — nothing a human has to read or click
 * runs on a clock — so shortening these cannot cost anybody a decision. A co-op room keeps the game's own pacing.
 */
function installPresentationScale({ Match, DELAYS, state, log }) {
  if (typeof Match?.prototype?.scaled !== 'function') return ['Match.prototype.scaled'];
  if (!DELAYS || typeof DELAYS !== 'object') return ['Match DELAYS'];
  const steps = new Set([DELAYS.COMBAT_END, DELAYS.SETTLE, DELAYS.ROUND_START].map((v) => Math.round(v)));
  const origScaled = Match.prototype.scaled;
  Match.prototype.scaled = function scaled(ms) {
    const base = origScaled.call(this, ms);
    const n = Number(state.speed);
    if (!(n > GAME_SPEED) || !steps.has(Math.round(ms))) return base;
    let solo = false;
    try { solo = !!this.soloUntimed; } catch { solo = false; }
    if (!solo) return base;
    return Math.max(MIN_STEP_MS, Math.round((base * GAME_SPEED) / n));
  };
  log.info(`hooked Match.prototype.scaled (过场等待跟倍速：${[...steps].join(' / ')} ms，仅单人局)`);
  return [];
}

// -----------------------------------------------------------------------------------------------------
// the sandbox: extra 策略 (strategies) on top of the drafted one, and the deploy unlock
//
//   * 策略. The game fixes a seat's strategy once, in the draft (`Match.pickBand` → `_applyBand`), and every effect
//     dispatch reads that single `ps.bandId` (effectsMeta.js:218). Extra ids ride on `ps.modBands`; the dispatcher is
//     wrapped so each of them gets its own `band:<id>` handler called, with its OWN source (the source is only read for
//     toast / offer titles, but a shared one would name the wrong strategy). The starting LP is one number per
//     strategy, so a stack takes the MAX of the picks (`_applyBand` is the only place that sets it).
//
//   * 地块. Legality is one chain: the stage's tile legend (`height` × `buildable`) → buildDeployMap → canPlace →
//     PlayerState._legal, which is also what the single "put it back" pass (_evictIllegal) consults. So the unlock is
//     a MAP change, not a rule change: every tile whose legend says it cannot be built on is added, high ground as
//     ranged-only (the one rule worth keeping), and tiles a device took away (阻隔工事, an inactive platform) stay as
//     the game left them. `height` is never touched — the renderer reads it. The browser reads its own copy of
//     stages.json, so overlay.js widens its side the same way. Turning it off re-runs `recompute()`, which pulls back
//     whatever now stands somewhere illegal.
// -----------------------------------------------------------------------------------------------------

/** Wrap the dispatcher, `_applyBand`, the deploy map / class and the battle pass. Returns what it could not find. */
function installSandbox({ Match, PlayerState, EffectDispatcher, board, Battle, bands, state, log }) {
  const missing = [];

  // -- extra strategies: every dispatch also runs each extra strategy's own band handler --
  if (typeof EffectDispatcher?.prototype?.dispatch !== 'function') {
    missing.push('EffectDispatcher.prototype.dispatch');
  } else {
    const origDispatch = EffectDispatcher.prototype.dispatch;
    EffectDispatcher.prototype.dispatch = function dispatch(ps, hook, ev = {}, opts = {}) {
      const extra = ps && Array.isArray(ps.modBands) ? ps.modBands : null;
      // the income assigners run first: they overwrite `ev.income` outright, so anything added before them is lost
      if (extra?.length && hook === 'onIncome') {
        for (const id of extra) if (id !== ps.bandId && INCOME_ASSIGN_BANDS.has(id)) callBand(this, ps, id, hook, ev);
      }
      const res = origDispatch.call(this, ps, hook, ev, opts);
      if (extra?.length) {
        for (const id of extra) {
          if (id === ps.bandId) continue;
          if (hook === 'onIncome' && INCOME_ASSIGN_BANDS.has(id)) continue; // already ran, before the primary
          callBand(this, ps, id, hook, ev);
        }
      }
      // 鸭爵 as an extra: its effect is a GLOBAL handler, not a `band:` one, so the loop above never reaches it
      if (ps && hook === 'onBattleStart') duckAsExtra(this, ps, ev);
      return res;
    };
    log.info('hooked EffectDispatcher.dispatch (sandbox strategies)');
  }

  // -- starting LP: one number per strategy, so a stack keeps the biggest --
  if (typeof Match?.prototype?._applyBand !== 'function') {
    missing.push('Match.prototype._applyBand');
  } else {
    const origApply = Match.prototype._applyBand;
    Match.prototype._applyBand = function _applyBand(ps, bandId, opts) {
      const res = origApply.call(this, ps, bandId, opts);
      try { applyMaxLp(this, ps); } catch (e) { log.warn('sandbox LP failed', e?.message || e); }
      return res;
    };
    log.info('hooked Match.prototype._applyBand (sandbox LP)');
  }

  // -- the deploy unlock: widen the map the game hands out --
  if (typeof Match?.prototype?.deployMapFor !== 'function' || !board) {
    missing.push('Match.prototype.deployMapFor');
  } else {
    const origMap = Match.prototype.deployMapFor;
    Match.prototype.deployMapFor = function deployMapFor(ps, field) {
      const map = origMap.call(this, ps, field);
      try {
        if (state.sandbox.place) widenDeployMap(this.stage, field ?? this.deployFieldOf(ps), map, board);
      } catch (e) {
        log.warn('deploy unlock failed', e?.message || e);
      }
      return map;
    };
    log.info('hooked Match.prototype.deployMapFor (deploy unlock)');
  }

  // -- the deploy unlock also lifts the placement CLASS, not just the tiles --
  // A melee chess may stand on a 高台 when its trait reads 「可以放置于远程位」 (shared/highGround.js: 歌蕾蒂娅/崖心/见行者).
  // The class is the game's own knob for that: `placeClass` → positionClass 'all' passes canPlace on every deployable
  // tile, 高台 included. Lifting it here (instead of faking a trait, which the detail card shows) gives every piece the
  // same shoes, and it matches what overlay.js does to its own copy of the stage.
  if (typeof PlayerState?.prototype?._placementOf !== 'function') {
    missing.push('PlayerState.prototype._placementOf');
  } else {
    const origPlacementOf = PlayerState.prototype._placementOf;
    PlayerState.prototype._placementOf = function _placementOf(piece) {
      const pos = origPlacementOf.call(this, piece);
      return state.sandbox.place && pos !== 'all' ? 'all' : pos;
    };
    log.info('hooked PlayerState._placementOf (melee on 高台)');
  }

  // -- the deploy cap: a floor on top of the game's own number (the getter is inherited from PlayerBasics) --
  let capGetter = null;
  for (let o = PlayerState?.prototype; o && !capGetter; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, 'deployCap');
    if (d && typeof d.get === 'function') capGetter = d.get;
  }
  if (!capGetter) {
    missing.push('PlayerState deployCap getter');
  } else {
    Object.defineProperty(PlayerState.prototype, 'deployCap', {
      configurable: true,
      enumerable: false,
      get() {
        const n = capGetter.call(this);
        const cap = state.sandbox.cap;
        return cap == null || !Number.isFinite(n) ? n : Math.max(n, cap);
      },
    });
    log.info('hooked PlayerState deployCap');
  }

  // -- 坎诺特's 利滚利 (leftover funds survive the prep) is a MATCH rule, not an effect, and reads the single `bandId` --
  if (typeof PlayerState?.prototype?.endPrep !== 'function') {
    missing.push('PlayerState.prototype.endPrep');
  } else {
    const origEndPrep = PlayerState.prototype.endPrep;
    PlayerState.prototype.endPrep = function endPrep(...args) {
      const keeps = keepsLeftoverFunds(this);
      const before = this.funds;
      const res = origEndPrep.apply(this, args);
      if (keeps && this.funds === 0 && before > 0) {
        this.funds = before; // the prep end wiped them: an extra 坎诺特 keeps them
        this.dirty?.();
      }
      return res;
    };
    log.info('hooked PlayerState.endPrep (sandbox 利滚利)');
  }

  // -- the extras ride along on the battle spec, so the browser's own copy of the sim installs them too --
  if (typeof PlayerState?.prototype?.battleInput !== 'function') {
    missing.push('PlayerState.prototype.battleInput');
  } else {
    const origBattleInput = PlayerState.prototype.battleInput;
    PlayerState.prototype.battleInput = function battleInput(...args) {
      const input = origBattleInput.apply(this, args);
      try {
        if (input && Array.isArray(this.modBands) && this.modBands.length) input.modBands = [...this.modBands];
      } catch { /* ignore */ }
      return input;
    };
    log.info('hooked PlayerState.battleInput (extras in the battle spec)');
  }

  // -- the BATTLE side of the extra strategies --
  // `bands/battle.js install()` walks `battle.players` and installs the IN_BATTLE buffs of each player's single
  // `bandId`; the strategies whose whole effect is combat (歌利亚, 阿米娅, 卡莱莎, Touch …) live nowhere else. The extras
  // ride on the battle spec (`battleInput` → the player entry), so hooking the one seam every Battle construction goes
  // through covers both processes. `install()` itself is not re-enterable per band, so the extras go in one at a time
  // with the other players masked out: only the extra's own buffs land, and nobody's are installed twice.
  //
  // The seam is the content install (slot-rules.patchContentSeam): 0.3.0 dropped the `_safe('installContent')` wrapper
  // the mod used to hang this on. Registered before the 自选位 numbers hook so that the extras install while the patched
  // data is still swapped in — the order the two `_safe` wrappers had it.
  if (typeof bands?.install !== 'function'
    || !patchContentSeam(Battle, {
      afterInstall: (b) => {
        try { installExtraBands(b, bands); } catch (e) { log.warn('battle-side extra strategies failed', e?.message || e); }
      },
    })) {
    missing.push('the battle content install (extra strategies)');
  } else {
    log.info('hooked the battle content install (battle-side extra strategies)');
  }

  return missing;
}

/**
 * Install the battle part of a seat's extra strategies into a whole Battle. `bands.install` reads each player's single
 * `bandId`, so each extra runs as a one-band pass: every other player is masked to null for the call and put back
 * afterwards, which keeps the primary strategies from being installed a second time. Returns how many were installed.
 */
function installExtraBands(battle, bands) {
  const players = Array.isArray(battle?.players) ? battle.players : null;
  if (!players?.length || typeof bands?.install !== 'function') return 0;
  const jobs = [];
  for (const p of players) {
    const ids = p?.input?.modBands;
    if (!Array.isArray(ids) || !ids.length) continue;
    const own = ids.filter((id) => id && id !== p.bandId);
    if (own.length) jobs.push([p, own]);
  }
  if (!jobs.length) return 0;
  const saved = players.map((p) => p.bandId);
  let n = 0;
  try {
    for (const [p, ids] of jobs) {
      for (const id of ids) {
        for (const q of players) q.bandId = null;
        p.bandId = id;
        bands.install(battle);
        n++;
      }
    }
  } finally {
    players.forEach((p, i) => { p.bandId = saved[i]; });
  }
  return n;
}

/**
 * Run one extra strategy's band handler for `hook`, with the source naming THAT strategy (offer/toast titles and the
 * layer `reason` read it). Strategies with no prep-side handler (the combat-only ones) simply have no handler here —
 * their half is installed into the Battle instead (see installExtraBands).
 */
function callBand(dispatcher, ps, id, hook, ev) {
  const key = `band:${id}`;
  const h = dispatcher.registry?.get?.(key);
  if (!h) return;
  const m = dispatcher.m;
  const band = m?.gd?.band ? m.gd.band(id) : null;
  dispatcher._call(ps, key, h, hook, { kind: 'band', key, bandId: id, band }, ev);
}

/**
 * Run the 鸭爵 global for a field that holds the duck only as an EXTRA strategy.
 *
 * The gate reads each seat's live `ps.bandId` (ctx.bandId / ctx.teammates), so the fix is to mask the bandId of every
 * seat whose `modBands` names the duck for the duration of the call, then put them back. The handler itself is fetched
 * from the registry by key, exactly like callBand. Two guards:
 *   * a PRIMARY duck — the game's own pass already ran the handler for every seat of the field (its `held` check is
 *     satisfied for all of them), so running it again here would swap the enemies twice;
 *   * the original dispatch already ran the global for THIS seat (returning early, since it saw no duck): this is the
 *     missing half, run once per seat, matching how the primary case edits each seat's own half of a shared field.
 * Only the server needs this: the spawn list is built server-side (combat.js:45-51, bossRounds.js:79-88) and sanitised
 * after dispatch returns, and both processes get that same list through the battle spec.
 */
function duckAsExtra(dispatcher, ps, ev) {
  const m = dispatcher.m;
  const players = typeof m?.alivePlayers === 'function' ? m.alivePlayers() : null;
  if (!players?.length) return;
  if (players.some((p) => p.bandId === DUCK_BAND)) return; // primary pass already covered the whole field
  const holders = players.filter((p) => Array.isArray(p.modBands) && p.modBands.includes(DUCK_BAND));
  if (!holders.length) return;
  const h = dispatcher.registry?.get?.(DUCK_GLOBAL);
  if (!h || typeof h.onBattleStart !== 'function') return;
  const saved = holders.map((p) => p.bandId);
  try {
    for (const p of holders) p.bandId = DUCK_BAND;
    dispatcher._call(ps, DUCK_GLOBAL, h, 'onBattleStart', { kind: 'global', key: DUCK_GLOBAL }, ev);
  } finally {
    holders.forEach((p, i) => { p.bandId = saved[i]; });
  }
}

/** Whether any of the seat's strategy picks is one whose leftover funds survive the prep (坎诺特 利滚利). */
function keepsLeftoverFunds(ps) {
  const kept = ps?.gd?.leftoverKeptBands;
  if (!Array.isArray(kept) || !kept.length) return false;
  const ids = [ps.bandId, ...(Array.isArray(ps.modBands) ? ps.modBands : [])];
  return ids.some((id) => id && kept.includes(id));
}

/** Deck the seat's LP to the biggest 初始目标生命值 among its strategy picks. */
function applyMaxLp(match, ps) {
  const ids = [ps?.bandId, ...(Array.isArray(ps?.modBands) ? ps.modBands : [])].filter(Boolean);
  if (ids.length < 2 || typeof match.gd?.startLp !== 'function') return;
  let best = 0;
  for (const id of ids) {
    const lp = Number(match.gd.startLp(id));
    if (Number.isFinite(lp) && lp > best) best = lp;
  }
  if (!(best > 0) || ps.lp === best) return;
  ps.lp = best;
  match.markPrivate?.(ps);
  match.markPublic?.();
}

/**
 * Add the tiles the stage's own legend refuses to `map`, so the unlock is exactly "every tile you could not build on
 * is now buildable": high ground joins as ranged-only, and anything a device took away (a crate, an inactive
 * platform) is left alone — the game's device pass already ran, and the deck stays a part of the board.
 */
function widenDeployMap(stage, field, map, board) {
  const rows = Array.isArray(stage?.rows) ? stage.rows : null;
  const legend = stage && typeof stage.tiles === 'object' && stage.tiles ? stage.tiles : null;
  if (!rows || !legend || typeof board?.fieldTile !== 'function') return;
  const F = board.FIELD;
  for (let r = F.r0; r <= F.r1; r++) {
    for (let c = F.c0; c <= F.c1; c++) {
      const k = board.tileKey(r, c);
      if (map.has(k)) continue;
      const [sr, sc] = board.fieldTile(field, r, c);
      const line = typeof rows[sr] === 'string' ? rows[sr] : null;
      const glyph = line ? line[sc] : null;
      const tile = glyph != null && Object.hasOwn(legend, glyph) ? legend[glyph] : null;
      // the legend says this one CAN be built on ⇒ the map lost it to a device, not to its terrain: leave it out
      if (tile && typeof tile.buildable === 'string' && tile.buildable !== 'NONE') continue;
      map.set(k, tile && tile.height === 'HIGH' ? 'ranged' : 'melee');
    }
  }
}

/** What the panel reads: this seat's extra strategies, the strategies the match allows, and the two deploy knobs. */
function sandboxView(ps, state) {
  testScope(ps, state);
  const gd = ps?.m?.gd;
  let pool = [];
  try {
    if (typeof gd?.bandIds === 'function') pool = gd.bandIds().filter((id) => gd.bandAllowed(id));
  } catch { pool = []; }
  return {
    bands: Array.isArray(ps?.modBands) ? ps.modBands : [],
    pool,
    test: {
      matchId: state.test.matchId,
      funds: state.test.funds,
      round: state.test.round,
      roundCap: state.test.roundCap,
      enemy: { list: state.test.enemy.list, wave: state.test.enemy.wave },
      map: mapNowId(ps),
      maps: mapChoices(ps),
      bond: state.test.bond,
      bonds: bondChoices(ps),
      combos: combosView(ps, state),
      timer: timerNow(ps, state),
      boss: state.test.boss,
    },
    place: !!state.sandbox.place,
    cap: state.sandbox.cap,
    shopLevel: { level: state.shopLevel.level },
  };
}

/** g.modBands { ids } — replace this seat's extra strategies. Not billed to the round's budget. */
function handleBands(match, playerId, msg, state, ERR) {
  if (!state.enable.sandboxBands) return fail(ERR.BAD_TARGET, '沙盒·策略叠加已关闭（总开关）');
  const seat = seatFor(match, playerId);
  if (seat.error) return seat.error;
  if (!isIdList(msg.ids)) return fail(ERR.BAD_TARGET, '策略列表不合法');
  const ps = seat.ps;
  const gd = match.gd;
  const ids = [];
  for (const id of msg.ids) {
    if (!gd.bandAllowed(id)) return fail(ERR.BAD_TARGET, `本局没有这个策略（${id}）`);
    if (id === ps.bandId) continue; // the drafted one is already running
    if (ids.includes(id)) continue; // twice would double every counter and every grant
    ids.push(id);
  }
  ps.modBands = ids;
  applyMaxLp(match, ps);
  try { ps.dirty?.(); match.flush(); } catch (e) { match.reportError?.('modBands', e); }
  return OK;
}

/**
 * 测试页的三个意图。三者的共同点：**只动游戏自己那本账，不另立一套**。
 *
 *   `g.modTestFunds  { funds }` —— 直接写 `ps.funds`。资金在游戏里就是 PlayerState 上的一个数
 *                              （`PlayerState.js` 的 `this.funds = 0`），没有任何派生物要跟着重算。
 *   `g.modTestRound  { round }` —— 把这一局跳到第 N 回合。**走游戏自己的 `startRound()`**，所以每回合该发生的
 *                              事情（发钱、刷商店、开波次、审计 `round → round+1`）都照常发生；不是硬写计数器。
 *   `g.modTestRoundCap { round }` — 改「最后一回合」。`gamedata` 的 `lastRound` / `bossRound` 都是 **getter**
 *                              （分别读 `mode.lastRound` / `mode.bossRound`），没法直接赋值，所以在 gd 实例上
 *                              `Object.defineProperty` 各盖一个 —— 和 Luck 自己处理 `deployCap` 是同一套。
 *                              ⚠️ **两个都要盖**：`mode_multi_normal` 里 `lastRound` 与 `bossRound` 都写死成 14，
 *                              只盖上限定值的话 boss 回合还在 14，上限设到 7 就永远走不到 boss。游戏自己的默认
 *                              形状就是 `bossRound === lastRound`，这里照它来。`hiddenRound`（15）不动。
 *
 * 夹取：`validateC2S()` 在真路径（`server/net.js:717`、`cluster/ingress.js:268`、`cluster/game-node.js:380`）会跑，
 * 但 `Match.handle()` 这条直接派发路径不经它 —— 处理器自己再夹一道，保证「绝不越界」是处理器的性质。
 */
function testSeat(match, playerId, state, key, ERR) {
  if (!state.enable[key]) return { fail: fail(ERR.BAD_TARGET, '测试页已关闭（总开关）') };
  const seat = seatFor(match, playerId);
  if (seat.error) return { fail: seat.error };
  return { ps: seat.ps };
}

/**
 * 「一局的测试就是一局的」：`state` 是**整进程一份**（`installServerPatch()` 装一次），所以换了一局必须把
 * 上一局设过的回显清掉 —— 否则新的一局打开测试页会看到上一局的资金/回合/上限/地图/盟约（实测就是这么被举报的）。
 * `enemy.installed` 也要复位：影子补丁装在**那一局的 `gd` 实例**上，新的一局是个新 `gd`，标记不清的话
 * `installTestEnemy()` 会直接 return ⇒ 「设置敌人」在新一局静默失效。
 * 每帧的私有视图都会走 `sandboxView()` ⇒ 由它调用（见 L4-scope）。
 */
function testScope(ps, state) {
  const mid = ps && ps.m ? (ps.m.battlePrefix ?? null) : null;
  if (!state || !state.test || state.test.matchId === mid) return;
  state.test.matchId = mid;
  state.test.funds = null;
  state.test.round = null;
  state.test.roundCap = null;
  state.test.map = null;
  state.test.bond = null;
  state.test.timer.combat = null;
  state.test.timer.prep = null;
  state.test.enemy.list = [];
  state.test.enemy.wave = null;
  state.test.enemy.installed = false;
}

/** `g.modTestFunds { funds }` —— 本座的资金设成 `funds`。返回值里带上真实落到的数，方便面板回显。 */
function handleTestFunds(match, playerId, msg, state, ERR) {
  const got = testSeat(match, playerId, state, 'testFunds', ERR);
  if (got.fail) return got.fail;
  const ps = got.ps;
  if (!Number.isInteger(msg.funds)) return fail(ERR.BAD_TARGET, '资金要是一个整数');
  try {
    const want = Math.max(0, Math.min(99999, msg.funds));
    ps.funds = want;
    state.test.funds = want;
    ps.dirty?.();
    match.flush?.();
    return { ok: true, funds: want };
  } catch (e) {
    match.reportError?.('modTestFunds', e);
    return fail(ERR.BAD_TARGET, '设置资金失败');
  }
}

/** `g.modTestRound { round }` —— 跳到第 `round` 回合（走游戏自己的 startRound）。 */
function handleTestRound(match, playerId, msg, state, ERR) {
  const got = testSeat(match, playerId, state, 'testRound', ERR);
  if (got.fail) return got.fail;
  if (!Number.isInteger(msg.round) || msg.round < 1) return fail(ERR.BAD_TARGET, '回合要是 1 以上的整数');
  try {
    // 游戏自己的开回合入口；不同版本名字可能不同，所以逐个试，全都没有才认输。
    const start = ['startRound', 'beginRound', 'nextRound'].find((k) => typeof match[k] === 'function');
    if (!start) return fail(ERR.BAD_TARGET, '这一版没有可以跳回合的入口');
    const want = Math.max(1, Math.min(99, Math.trunc(msg.round)));
    match[start](want);
    state.test.round = want;
    match.flush?.();
    return { ok: true, round: match.round };
  } catch (e) {
    match.reportError?.('modTestRound', e);
    return fail(ERR.BAD_TARGET, '跳回合失败');
  }
}

/** `g.modTestRoundCap { round }` —— 把这一局的最后一回合改成 `round`。 */
function handleTestCap(match, playerId, msg, state, ERR) {
  const got = testSeat(match, playerId, state, 'testRoundCap', ERR);
  if (got.fail) return got.fail;
  if (!Number.isInteger(msg.round) || msg.round < 1) return fail(ERR.BAD_TARGET, '回合上限要是 1 以上的整数');
  const gd = got.ps.gd || match.gd || null;
  if (!gd) return fail(ERR.BAD_TARGET, '拿不到这一局的数据表');
  try {
    const want = Math.max(1, Math.min(99, Math.trunc(msg.round)));
    // `gamedata` 的 lastRound / bossRound 都是 getter（读 mode.lastRound / mode.bossRound），
    // 而这一版的 mode 里两个都写死成 14，所以**两个都要盖**。游戏自己的默认形状就是
    // bossRound === lastRound，这里照它来；hiddenRound（15）不动。
    const shadow = (prop, value) => Object.defineProperty(gd, prop, {
      configurable: true, enumerable: false,
      get() { return value; },
    });
    shadow('lastRound', want);
    shadow('bossRound', want);
    state.test.roundCap = want;
    for (const p of match.players?.values?.() || []) p.dirty?.();
    match.flush?.();
    return { ok: true, lastRound: gd.lastRound, bossRound: gd.bossRound };
  } catch (e) {
    match.reportError?.('modTestRoundCap', e);
    return fail(ERR.BAD_TARGET, '设置回合上限失败');
  }
}

/**
 * 测试页·设置敌人。做法是**合成一份假模板，交给游戏自己的 `buildNormalWave()` 去构建** ——
 * 这样回合缩放（`roundMods`）、`mods`、`preview`、路线分配、`actions` 账本全都由引擎算，
 * 我们只提供「怪 + 数量」。
 *
 * 装配方式是影子 `gd.roundCfg` / `gd.wave`（装在 gd 实例上）：
 *   - `gd.roundCfg(r)` 把**非 boss 回合**的 `template` 换成哨兵 id（或者用户挑的那个现成模板）；
 *   - `gd.wave(id)` 遇到哨兵 id 就吐出合成模板。
 * `phases.js:315` 每个回合都会走 `buildNormalWave(gd, …)` ⇒ **装上之后每回合自动生效**，
 * 不用去包 `Match.prototype.startRound`（少动一处公共管道）。`boss` 回合不碰：那一路走 `buildBossWave`。
 */
const TEST_ENEMY_SENTINEL = '__sptest_enemies__';

/** 游戏自己的波次模块。`installServerPatch()` 装的时候赋进来（见那里的 L4-import）。
 *  处理器是模块级函数，所以它必须是模块级的 —— 局部变量它们看不见。 */
let wavesMod = null;

/** 盟约层数的上限（`shared/constants.js` 的 BOND_LAYER_CAP，装补丁时读进来）。 */
let bondCap = 999;

/** 合成模板：路线沿用当前这一波自己的（没有就空），怪按名单铺开。 */
function testEnemyTemplate(match, state) {
  const base = match && match.wave ? match.wave : null;
  const routes = base && Array.isArray(base.routes) ? base.routes : [];
  return {
    routes,
    spawns: state.test.enemy.list.map((e, i) => ({
      key: e.key, count: e.count, interval: 2, time: i * 2, routeIndex: 0,
    })),
  };
}

/** 装影子（幂等 —— 装过一次就不再包第二层）。 */
function installTestEnemy(match, gd, state) {
  if (state.test.enemy.installed) return;
  const realWave = gd.wave.bind(gd);
  const realRoundCfg = gd.roundCfg.bind(gd);
  gd.wave = (id) => (id === TEST_ENEMY_SENTINEL ? testEnemyTemplate(match, state) : realWave(id));
  gd.roundCfg = (r) => {
    const rc = realRoundCfg(r);
    if (!rc) return rc;
    const out = { ...rc };
    // 测试页的两个时限（gd.combatTimeLimitReal / gd.prepTime 都读这里 ⇒ 改这里就生效，下一回合起）。
    const timer = state.test.timer || {};
    if (Number.isInteger(timer.combat) && timer.combat >= 1) out.combatTimeLimit = timer.combat;
    if (Number.isInteger(timer.prep) && timer.prep >= 1) out.prepTime = timer.prep;
    if (rc.isBoss) return out;
    const want = state.test.enemy.wave || (state.test.enemy.list.length ? TEST_ENEMY_SENTINEL : null);
    if (want) out.template = want;
    return out;
  };
  // 数据表原值：面板要拿它当「这一回合的默认值」（影子改了 template/时限，原值只能从这里拿）。
  gd.roundCfg.base = realRoundCfg;
  state.test.enemy.installed = true;
}

/** 当场按新名单重建这一回合的波次。⚠️ 会多消耗一次 `roundPick` 的随机数（测试工具，可以接受）。 */
function rebuildTestEnemy(match, gd) {
  if (!wavesMod || typeof wavesMod.buildNormalWave !== 'function') return false;
  match.wave = wavesMod.buildNormalWave(gd, match.rngWaves, match.factions, match.round);
  return true;
}

/** `g.modTestEnemy { list, wave }` —— 换掉这一回合的怪。两边都不给就是恢复原样。 */
function handleTestEnemy(match, playerId, msg, state, ERR) {
  const got = testSeat(match, playerId, state, 'testEnemy', ERR);
  if (got.fail) return got.fail;
  const gd = got.ps.gd || match.gd || null;
  if (!gd) return fail(ERR.BAD_TARGET, '拿不到这一局的数据表');
  const list = Array.isArray(msg.list) ? msg.list : null;
  if (list) {
    for (const e of list) {
      if (!gd.enemy(e.key)) return fail(ERR.BAD_TARGET, '数据表里没有这只怪：' + e.key);
    }
  }
  if (typeof msg.wave === 'string' && !gd.wave(msg.wave)) return fail(ERR.BAD_TARGET, '数据表里没有这个波次模板：' + msg.wave);
  try {
    state.test.enemy.list = list ? list.map((e) => ({ key: e.key, count: e.count })) : [];
    state.test.enemy.wave = typeof msg.wave === 'string' ? msg.wave : null;
    installTestEnemy(match, gd, state);
    const rebuilt = rebuildTestEnemy(match, gd);
    got.ps.dirty?.();
    match.flush?.();
    // ⚠️ 用字面量 `'PREP'`，不用 `PHASE.PREP`：`PHASE` 是 `installServerPatch()` 里的局部绑定
    //    （`const { ERR, PHASE } = constants;`），模块级的处理器看不到它。游戏自己的 `constants.js` 里
    //    `PHASE = Object.freeze({ PREP: 'PREP', … })` —— 值就是键名，所以两者等价。
    return { ok: true, list: state.test.enemy.list, wave: state.test.enemy.wave, rebuilt: rebuilt && match.phase === 'PREP' };
  } catch (e) {
    match.reportError?.('modTestEnemy', e);
    return fail(ERR.BAD_TARGET, '设置敌人失败：' + (e && e.message ? e.message : String(e)));
  }
}

/**
 * 测试页·更换地图的候选：本模式自己会抽的那些图（`gd.mode.stages`）。
 * 面板默认只列这一份，勾上「列出全部地图」才放开到整份 data/stages.json。
 */
function mapChoices(ps) {
  const gd = ps?.m?.gd;
  const out = [];
  try {
    const ids = Array.isArray(gd?.mode?.stages) ? gd.mode.stages : [];
    for (const id of ids) {
      if (typeof id !== 'string') continue;
      const s = gd.stage(id);
      if (s) out.push({ id, name: typeof s.name === 'string' && s.name ? s.name : id });
    }
  } catch { /* 拿不到就只让面板自己列 data/stages.json */ }
  return out;
}

/**
 * 这一局现在这张图的 id。**现读 `match`**：面板要显示真值，而 `state.test.map` 只是「面板上次设过的那张」，
 * 地图还可能来自游戏自己的流程（`setupVote` 选图 / 恢复存档 / 模式默认），那些都不会经过这里。
 */
function mapNowId(ps) {
  try {
    const m = ps && ps.m;
    const id = m && (m.stageId || (m.stage && m.stage.id));
    if (typeof id === 'string' && id) return id;
  } catch { /* 拿不到就当没有 */ }
  return null;
}

/**
 * `g.modTestMap { stageId }` —— 把这一局的地图换成 `stageId` 那张。
 *
 * 地图在引擎里就是 `match` 上的两个字段（`Match.js` 的 setup：`this.stageId = setup.stageId;` +
 * `this.stage = gd.stage(...)`），而读它的地方全是**现读**：布置图走 `Match.deployMapFor()` →
 * `buildDeployMap(this.stage, …)`；战斗 spec 与 `m.field` 里的 `stageId`（`combat.js` / `views.js`）；
 * 客户端那份 data/stages.json 的地图装饰也是按 `m.field.stageId` 找的。
 *
 * 所以换完只要**让每个玩家的布置图缓存作废**（`ps.invalidateDeployMap()`，和游戏自己的地形机变
 * `effectsMeta.js` 的 setDeviceActive / setTileOverride 是同一个写法），再 flush 一次就生效。
 * ⚠️ PREP 里顺手 `recompute()` 一次：新图上原来那格不合法的棋子照地形机变的规矩撤回，不带着它进战斗。
 * ⚠️ 严格说能换出来的图不限于本模式抽得到的那些（服务端不拦，面板默认只列本模式的池子）——
 * 那是测试工具的本意：维护者就是要试「这张图在本模式下会怎样」。换图**不重开回合**，这一回合的怪不动。
 */
function handleTestMap(match, playerId, msg, state, ERR) {
  const got = testSeat(match, playerId, state, 'testMap', ERR);
  if (got.fail) return got.fail;
  const gd = match.gd || got.ps.gd || null;
  if (!gd) return fail(ERR.BAD_TARGET, '拿不到这一局的数据表');
  const id = typeof msg.stageId === 'string' ? msg.stageId : '';
  if (!id) return fail(ERR.BAD_TARGET, '地图 id 不合法');
  let stage = null;
  try { stage = typeof gd.stage === 'function' ? gd.stage(id) : null; } catch { stage = null; }
  if (!stage) return fail(ERR.BAD_TARGET, '数据表里没有这张地图：' + id);
  if (!Array.isArray(stage.rows) || !stage.rows.length) return fail(ERR.BAD_TARGET, '这张地图没有地形数据：' + id);
  try {
    match.stageId = id;
    match.stage = stage;
    state.test.map = { id, name: typeof stage.name === 'string' && stage.name ? stage.name : id };
    for (const p of match.players?.values?.() || []) {
      p.invalidateDeployMap?.();
      if (match.phase === 'PREP') { try { p.recompute?.(); } catch { /* 单个玩家算不动就算了 */ } }
      p.dirty?.();
    }
    match.flush?.();
    return { ok: true, stageId: id, name: state.test.map.name };
  } catch (e) {
    match.reportError?.('modTestMap', e);
    return fail(ERR.BAD_TARGET, '换地图失败：' + (e && e.message ? e.message : String(e)));
  }
}

/** 盟约候选：数据表里的全部盟约（`gd.bondIds` 是按 identifier 排好的）→ `[{ id, name }]`。 */
function bondChoices(ps) {
  const gd = ps && ps.m ? ps.m.gd : null;
  const ids = gd && Array.isArray(gd.bondIds) ? gd.bondIds : [];
  try {
    return ids.map((id) => {
      const rec = typeof gd.bond === 'function' ? gd.bond(id) : null;
      return { id, name: rec && typeof rec.name === 'string' && rec.name ? rec.name : id };
    });
  } catch {
    return ids.map((id) => ({ id, name: id }));
  }
}

/**
 * 测试页·设置盟约层数：把某个盟约的层数直接设成你填的数（0..bondCap）。
 * 涨层走游戏自己的加层入口（`ps.addLayers()`：会 `onLayers` 派发、PREP 里由 `dirty()` 送去播报，
 * 和正常加层完全同一条路）；降层没有现成入口（加层接口只加不减），所以直接写 `ps.layers[bondId]`
 * 再 `ps.recompute()` —— recompute 就是游戏自己每次改层数后走的那个：重算 `ps.bonds`（激活 / 层数 / 和谐）
 * 并 `dirty()`（`invariants.js` 要求 `ps.bonds` 与重新计算的结果一致，所以这一步不能省）。
 * 上限按 `BOND_LAYER_CAP` 夹取（装补丁时读进 `bondCap`）。
 */
function handleTestBond(match, playerId, msg, state, ERR) {
  const got = testSeat(match, playerId, state, 'testBond', ERR);
  if (got.fail) return got.fail;
  const ps = got.ps;
  const gd = match.gd || ps.gd || null;
  if (!gd) return fail(ERR.BAD_TARGET, '拿不到这一局的数据表');
  const bondId = typeof msg.bondId === 'string' ? msg.bondId : '';
  if (!bondId) return fail(ERR.BAD_TARGET, '盟约 id 不合法');
  let bond = null;
  try { bond = typeof gd.bond === 'function' ? gd.bond(bondId) : null; } catch { bond = null; }
  if (!bond) return fail(ERR.BAD_TARGET, '数据表里没有这个盟约：' + bondId);
  const want = Math.max(0, Math.min(bondCap, Math.floor(Number(msg.layers) || 0)));
  try {
    const before = ps.layers && Number.isFinite(ps.layers[bondId]) ? ps.layers[bondId] : 0;
    if (want > before && typeof ps.addLayers === 'function') ps.addLayers(bondId, want - before, { reason: 'testBond' });
    if ((ps.layers && ps.layers[bondId] ? ps.layers[bondId] : 0) !== want) {
      if (ps.layers) ps.layers[bondId] = want;
      ps.recompute?.();
    }
    state.test.bond = { id: bondId, layers: ps.layers && Number.isFinite(ps.layers[bondId]) ? ps.layers[bondId] : want, before };
    ps.dirty?.();
    match.flush?.();
    return { ok: true, bondId, layers: state.test.bond.layers, before };
  } catch (e) {
    match.reportError?.('modTestBond', e);
    return fail(ERR.BAD_TARGET, '设置盟约层数失败：' + (e && e.message ? e.message : String(e)));
  }
}


/** 出怪组合全集的上限（面板一次最多看这么多条；boss 回合全列时用得上）。 */
const TEST_COMBO_MAX = 240;
const TEST_ACLOON = 'enemy_9012_acloon';

/** 数据表里和「随机出怪」有关的三块。 */
function comboData(gd) {
  const fx = gd && gd.raw ? gd.raw.factions : null;
  const gen = fx && fx.generation ? fx.generation : null;
  const types = fx && fx.types && typeof fx.types === 'object' ? Object.values(fx.types) : [];
  const entries = fx && fx.entries && typeof fx.entries === 'object' ? Object.values(fx.entries) : [];
  return { fx, gen, types, entries };
}

/** 占位怪表：数据里给了 generation.placeholders 就用它，否则按 templateSlots 推。 */
function comboPlaceholders(gd) {
  const { fx, gen } = comboData(gd);
  const map = new Map();
  const given = gen && gen.placeholders && typeof gen.placeholders === 'object' ? gen.placeholders : null;
  if (given) {
    for (const key of Object.keys(given)) {
      const p = given[key];
      if (p && typeof p === 'object') {
        map.set(key, {
          cls: typeof p.cls === 'string' ? p.cls : 'normal',
          fly: !!p.fly,
          slot: typeof p.slot === 'string' ? p.slot : null,
        });
      }
    }
    return map;
  }
  const slots = fx && fx.templateSlots && typeof fx.templateSlots === 'object' ? fx.templateSlots : {};
  for (const key of Object.keys(slots)) {
    const slot = slots[key];
    if (typeof slot !== 'string' || !slot) continue;
    const head = slot.slice(0, 1);
    const cls = head === 'E' ? 'elite' : head === 'S' ? 'special' : 'normal';
    map.set(key, { cls, fly: slot.indexOf('F') >= 0, slot });
  }
  return map;
}

/** 这只怪是不是飞行（走游戏自己的 isFlyKey，拿不到就退回 motion === 'FLY'）。 */
function comboFly(gd, key) {
  try {
    if (wavesMod && typeof wavesMod.isFlyKey === 'function') return !!wavesMod.isFlyKey(gd, key);
  } catch { /* 落到下面 */ }
  try {
    const rec = typeof gd.enemy === 'function' ? gd.enemy(key) : null;
    return String((rec && rec.motion) || '').toUpperCase() === 'FLY';
  } catch { return false; }
}

/** 占位怪换成新怪之后的数量（游戏自己的 replacedCount）。 */
function comboReplaced(gd, tplKey, n, newKey) {
  try {
    if (wavesMod && typeof wavesMod.replacedCount === 'function') return wavesMod.replacedCount(gd, tplKey, n, newKey);
  } catch { /* 落到 n 上 */ }
  return n;
}

/**
 * 一波（模板 + 一个候选 pick）会出哪些怪。逐条照 server/match/waves.js 的 templateSpawns：
 * 占位怪按 cls 换成 pick 的 normal/elite/key；换出来的怪与占位的空/地类别不符 ⇒ 整组不出（dropped）；
 * 非占位（字面量）条目原样保留。
 */
function comboRowsOf(gd, tpl, pick, ph) {
  const got = new Map();
  let dropped = 0;
  let literal = 0;
  const spawns = tpl && Array.isArray(tpl.spawns) ? tpl.spawns : [];
  for (const s of spawns) {
    if (!s || typeof s !== 'object') continue;
    if (s.action != null && s.action !== 'SPAWN') continue;
    const key0 = s.key != null ? s.key : s.enemyKey;
    if (typeof key0 !== 'string' || !key0 || key0 === TEST_ACLOON) continue;
    const n = Math.max(1, Math.min(50, Math.trunc(Number(s.count) || 1)));
    const p = ph.get(key0);
    if (!p) {
      got.set(key0, (got.get(key0) || 0) + n);
      literal += 1;
      continue;
    }
    const newKey = p.cls === 'special' ? pick.key : p.cls === 'elite' ? pick.elite : pick.normal;
    if (typeof newKey !== 'string' || !newKey || comboFly(gd, newKey) !== !!p.fly) {
      dropped += 1;
      continue;
    }
    const count = Math.max(1, Math.min(50, Math.trunc(Number(comboReplaced(gd, key0, n, newKey)) || n)));
    got.set(newKey, (got.get(newKey) || 0) + count);
  }
  return { rows: [...got.entries()].map(([key, count]) => ({ key, count })), dropped, literal };
}

function comboName(gd, key) {
  try {
    const rec = typeof gd.enemy === 'function' ? gd.enemy(key) : null;
    return rec && typeof rec.name === 'string' && rec.name ? rec.name : key;
  } catch { return key; }
}

function comboLabel(gd, rows) {
  const parts = rows.slice(0, 4).map((r) => comboName(gd, r.key) + ' x' + r.count);
  if (rows.length > 4) parts.push('+' + (rows.length - 4) + ' 种');
  return parts.join(' · ');
}

/**
 * 这一回合的候选 pick（每个都带一个归一化概率）。返回的是**展开后**的列表：
 * 一个条目可能有多个 N / E 变体，每个变体各算一条（面板上就是一条组合）。
 */
function comboPickCandidates(gd, round) {
  const { gen, types, entries } = comboData(gd);
  const maxSlots = gen && Number.isInteger(gen.maxLevelCnt) && gen.maxLevelCnt > 0 ? gen.maxLevelCnt : 15;
  const firstHalfMax = gen && Number.isInteger(gen.firstHalfMaxRound) && gen.firstHalfMaxRound > 0
    ? gen.firstHalfMaxRound : Math.floor(maxSlots / 2);
  const half = round <= firstHalfMax;
  const drawNum = gen && Number.isInteger(gen.specialEnemyNum) && gen.specialEnemyNum > 0 ? gen.specialEnemyNum : 3;
  const fillType = gen && typeof gen.fillType === 'string' ? gen.fillType : 'SPECIAL';
  const inactive = gd && gd.inactiveEnemies && typeof gd.inactiveEnemies.has === 'function' ? gd.inactiveEnemies : null;
  const involve = types.filter((t) => t && t.involveRandom);
  const drawP = involve.length ? Math.max(1, Math.min(drawNum, involve.length)) / involve.length : 1;
  const w = (e) => (Number.isFinite(e && e.weight) && e.weight > 0 ? e.weight : 1);
  const keys = (list) => (Array.isArray(list) ? list.filter((x) => x && typeof x.key === 'string' && x.key && x.key !== TEST_ACLOON).map((x) => x.key) : []);
  const candidates = (type) => entries.filter((e) => e && e.type === type && !!e.firstHalf === half
    && e.key !== TEST_ACLOON && gd.enemy(e.key) && (!inactive || !inactive.has(e.key)));
  const out = [];
  let usedSlots = 0;
  for (const t of involve) {
    const count = Number.isFinite(t.count) && t.count > 0 ? t.count : 0;
    const pool = candidates(t.type);
    if (!pool.length) continue;
    usedSlots += count;
    const typeP = drawP * (count / maxSlots);
    let wsum = 0;
    for (const e of pool) wsum += w(e);
    for (const e of pool) {
      const N = keys(e.N);
      const E = keys(e.E);
      if (!N.length || !E.length || !wsum) continue;
      out.push({
        type: t.type, entry: e.key, key: e.key, normal: N[0], elite: E[0], fly: !!e.fly,
        weight: typeP * (w(e) / wsum) / (N.length * E.length),
        fallback: false,
      });
    }
  }
  // fillType（SPECIAL）固定填满剩下的槽；另外「某个类型这一半没有候选、被 pickRoundEntry 回退成
  // SPECIAL」的那些槽，概率也算到它头上（标 fallback，面板会给一句说明）。
  const fillSlots = Math.max(0, maxSlots - usedSlots);
  let fallbackP = 0;
  for (const t of involve) {
    const count = Number.isFinite(t.count) && t.count > 0 ? t.count : 0;
    if (!candidates(t.type).length) fallbackP += drawP * (count / maxSlots);
  }
  const fillP = (fillSlots / maxSlots) + fallbackP;
  const fillPool = candidates(fillType);
  if (fillPool.length && fillP > 0) {
    let wsum = 0;
    for (const e of fillPool) wsum += w(e);
    for (const e of fillPool) {
      const N = keys(e.N);
      const E = keys(e.E);
      if (!N.length || !E.length || !wsum) continue;
      out.push({
        type: fillType, entry: e.key, key: e.key, normal: N[0], elite: E[0], fly: !!e.fly,
        weight: fillP * (w(e) / wsum) / (N.length * E.length),
        fallback: fallbackP > 0,
      });
    }
  }
  let total = 0;
  for (const c of out) total += c.weight;
  for (const c of out) c.p = total > 0 ? c.weight / total : 0;
  return { half, maxSlots, firstHalfMax, picks: out };
}

/** 本局这一回合**实际**抽到的 pick：优先 setup 里那份 schedule（按回合取），
 *  取不到就用 match.wave.pick —— 那是游戏自己刚构建的那一波（只在看当前回合时才算数）。 */
function comboActualPick(match, round) {
  try {
    const sch = match && match.factions && match.factions.schedule ? match.factions.schedule : null;
    const picks = sch && Array.isArray(sch.picks) ? sch.picks : null;
    let p = picks ? picks[round] : null;
    let source = p ? 'schedule' : null;
    if (!p && match && match.wave && match.wave.pick && (!match.round || round === match.round)) {
      p = match.wave.pick;
      source = 'wave';
    }
    if (!p || typeof p !== 'object') return null;
    return {
      type: p.type != null ? p.type : null,
      key: p.key != null ? p.key : null,
      normal: p.normal != null ? p.normal : null,
      elite: p.elite != null ? p.elite : null,
      source,
      id: String(p.type || '') + '|' + String(p.key || '') + '|' + String(p.normal || '') + '|' + String(p.elite || ''),
    };
  } catch { return null; }
}

/**
 * 视图里的出怪组合全集（面板读 v.priv.modSandbox.test.combos）。
 * 结果按 matchId / 回合 / 是否全 boss / solo 缓存 —— 视图每帧都建，不缓存就是每帧重算一百多条。
 */
function combosView(ps, state) {
  try {
    const m = ps && ps.m ? ps.m : null;
    const gd = m && m.gd ? m.gd : null;
    if (!m || !gd || typeof gd.roundCfg !== 'function') return null;
    const round = Number.isInteger(state.test.comboRound) && state.test.comboRound >= 1
      ? state.test.comboRound
      : (Number.isInteger(m.round) && m.round >= 1 ? m.round : 1);
    const rc = gd.roundCfg(round);
    const bossMap = rc && rc.bossTemplates && typeof rc.bossTemplates === 'object' ? rc.bossTemplates : null;
    const bossIds = bossMap ? Object.keys(bossMap) : [];
    const solo = !!gd.isSolo;
    const currentBoss = round === gd.hiddenRound && round !== gd.bossRound ? (m.hiddenBossId || null) : (m.bossId || null);
    const want = bossIds.length
      ? (state.test.comboAll ? bossIds : [currentBoss || bossIds[0]].filter(Boolean))
      : [null];
    const cacheKey = [m.battlePrefix || '', round, state.test.comboAll ? 1 : 0, want.join(','), solo ? 1 : 0].join('|');
    if (state.test.combos && state.test.combos.key === cacheKey) return state.test.combos.value;
    const ph = comboPlaceholders(gd);
    const cand = comboPickCandidates(gd, round);
    const actual = comboActualPick(m, round);
    const combos = [];
    let templateId = typeof rc.template === 'string' ? rc.template : null;
    for (const bossId of want) {
      const baseId = bossId ? bossMap[bossId] : rc.template;
      if (bossId) templateId = baseId;
      let tpl = null;
      try { tpl = typeof baseId === 'string' && typeof gd.wave === 'function' ? gd.wave(baseId) : null; } catch { tpl = null; }
      if (!tpl && solo && typeof baseId === 'string') {
        try { tpl = gd.wave(baseId + '_s'); } catch { tpl = null; }
      }
      if (!tpl) continue;
      for (const c of cand.picks) {
        const got = comboRowsOf(gd, tpl, c, ph);
        const id = (bossId ? bossId + '|' : '') + c.type + '|' + c.key + '|' + c.normal + '|' + c.elite;
        combos.push({
          id,
          type: c.type,
          entry: c.entry,
          boss: bossId || null,
          bossName: bossId ? comboName(gd, bossId) : null,
          p: c.p,
          rows: got.rows,
          kinds: got.rows.reduce((sum, r) => sum + r.count, 0),
          dropped: got.dropped,
          fallback: !!c.fallback,
          hasLiteral: got.literal > 0,
          label: comboLabel(gd, got.rows),
          current: !!actual && actual.id === id,
        });
      }
    }
    combos.sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0) || b.p - a.p || String(a.id).localeCompare(String(b.id)));
    const value = {
      round,
      all: !!state.test.comboAll,
      templateId: templateId || null,
      bossIds,
      half: cand.half,
      maxSlots: cand.maxSlots,
      firstHalfMax: cand.firstHalfMax,
      actual: actual && actual.id ? actual : null,
      truncated: combos.length > TEST_COMBO_MAX,
      combos: combos.slice(0, TEST_COMBO_MAX),
    };
    state.test.combos = { key: cacheKey, value };
    return value;
  } catch (e) {
    return null;
  }
}

/**
 * `g.modTestCombos { round?, all? }` —— 让面板决定「看第几回合 / 要不要把全部 boss 都列出来」。
 * 组合本身跟着**私有视图**回给面板（和别的测试回显同一条路），返回的 res 只是个 ack。
 */
function handleTestCombos(match, playerId, msg, state, ERR) {
  const got = testSeat(match, playerId, state, 'testEnemy', ERR);
  if (got.fail) return got.fail;
  const round = Number.isInteger(msg.round) && msg.round >= 1 && msg.round <= 99 ? Math.trunc(msg.round) : null;
  try {
    state.test.comboRound = round;
    state.test.comboAll = msg.all === true;
    state.test.combos = null;
    got.ps.dirty?.();
    match.flush?.();
    return { ok: true, round: state.test.comboRound, all: state.test.comboAll };
  } catch (e) {
    match.reportError?.('modTestCombos', e);
    return fail(ERR.BAD_TARGET, '列出出怪组合失败：' + (e && e.message ? e.message : String(e)));
  }
}

/**
 * `g.modTestBoss { bossId }` —— 跳到 boss 回合，并把这一局要打的 boss 换成这只（boss_1..boss_10）。
 * 只动两样：match.bossId / match.hiddenBossId（面子上那只是哪只），以及走游戏自己的开回合流程跳过去。
 */
function handleTestBoss(match, playerId, msg, state, ERR) {
  const got = testSeat(match, playerId, state, 'testEnemy', ERR);
  if (got.fail) return got.fail;
  const gd = match.gd || got.ps.gd || null;
  const bossId = typeof msg.bossId === 'string' ? msg.bossId.trim() : '';
  if (!gd || !bossId) return fail(ERR.BAD_TARGET, '打 boss 缺 bossId');
  const target = Number.isInteger(gd.bossRound) && gd.bossRound >= 1 ? gd.bossRound : null;
  if (!target) return fail(ERR.BAD_TARGET, '这一局没有 boss 回合');
  try {
    const rc = typeof gd.roundCfg === 'function' ? gd.roundCfg(target) : null;
    const map = rc && rc.bossTemplates && typeof rc.bossTemplates === 'object' ? rc.bossTemplates : null;
    if (map && !Object.prototype.hasOwnProperty.call(map, bossId)) {
      return fail(ERR.BAD_TARGET, '这一局的 boss 表里没有 ' + bossId);
    }
    match.bossId = bossId;
    if (Number.isInteger(gd.hiddenRound) && gd.hiddenRound >= 1) match.hiddenBossId = bossId;
    if (match.round !== target) {
      const step = ['startRound', 'beginRound', 'nextRound'].find((k) => typeof match[k] === 'function');
      if (!step) return fail(ERR.BAD_TARGET, '找不到开回合的入口');
      match[step](target);
    }
    state.test.boss = { id: bossId, round: target, name: comboName(gd, bossId) };
    state.test.combos = null;
    got.ps.dirty?.();
    match.flush?.();
    return { ok: true, bossId, round: target };
  } catch (e) {
    match.reportError?.('modTestBoss', e);
    return fail(ERR.BAD_TARGET, '打 boss 失败：' + (e && e.message ? e.message : String(e)));
  }
}

/** 这一回合现在的两个时限（给面板回显）：combat = 战斗时限的真实秒数，prep = 备战时间秒数（null = 不限时）。 */
function timerNow(ps, state) {
  const m = ps && ps.m ? ps.m : null;
  const gd = m && m.gd ? m.gd : null;
  const round = m && Number.isInteger(m.round) && m.round >= 1 ? m.round : 1;
  let rc = null;
  let base = null;
  try { rc = gd && round && typeof gd.roundCfg === 'function' ? gd.roundCfg(round) : null; } catch (e) { rc = null; }
  try { base = gd && typeof gd.roundCfg === 'function' && typeof gd.roundCfg.base === 'function' ? gd.roundCfg.base(round) : rc; } catch (e) { base = rc; }
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null);
  const want = state && state.test && state.test.timer ? state.test.timer : { combat: null, prep: null };
  return {
    round,
    combat: rc ? num(rc.combatTimeLimit) : null,
    prep: rc ? num(rc.prepTime) : null,
    base: { combat: base ? num(base.combatTimeLimit) : null, prep: base ? num(base.prepTime) : null },
    want: { combat: want.combat, prep: want.prep },
  };
}

/**
 * `g.modTestTimer { combat?, prep? }` —— 把这一局的战斗时限 / 备战时间改成你要的秒数（null = 恢复游戏原本的）。
 * 装配方式是影子 `gd.roundCfg`（与「设置敌人」共用那一层）⇒ 从**下一个回合**开始生效。
 * combat 是 data 里的真实秒数（游戏内的战斗限时 = 它 × combatTimeScale）；prep 给了就变成有限时的备战。
 */
function handleTestTimer(match, playerId, msg, state, ERR) {
  const got = testSeat(match, playerId, state, 'testEnemy', ERR);
  if (got.fail) return got.fail;
  const gd = got.ps.gd || match.gd || null;
  if (!gd) return fail(ERR.BAD_TARGET, '拿不到这一局的数据表');
  const parse = (v) => (v === null || v === undefined ? null : (Number.isInteger(v) && v >= 1 && v <= 9999 ? v : NaN));
  const combat = parse(msg.combat);
  const prep = parse(msg.prep);
  if (Number.isNaN(combat) || Number.isNaN(prep)) return fail(ERR.BAD_TARGET, '时限要给 1..9999 的整数秒（null 恢复原样）');
  try {
    if (msg.combat !== undefined) state.test.timer.combat = combat;
    if (msg.prep !== undefined) state.test.timer.prep = prep;
    installTestEnemy(match, gd, state);
    got.ps.dirty?.();
    match.flush?.();
    return { ok: true, combat: state.test.timer.combat, prep: state.test.timer.prep, round: match.round ?? null };
  } catch (e) {
    match.reportError?.('modTestTimer', e);
    return fail(ERR.BAD_TARGET, '设置时限失败：' + (e && e.message ? e.message : String(e)));
  }
}

/**
 * `g.modShopLevel { level }` —— 直接把本座的调度中心（商店）等级设成 `level`（1..gamedata.maxShopLevel，即 6）。
 *
 * 维护者实测反馈：原来那版「升级不花钱」不好用 —— 它只是把价钱拿掉，仍然要自己点、仍然受每回合节奏约束，
 * 测起来还是绕。改成**直接设等级**，一步到位。两个方向都支持：
 *
 *   want > 现在：**走游戏自己的 `levelUp()`**（只在调用前把价钱临时补上、返回后收回去），所以等级上限、
 *              开槽（`_openLevelSlots`）、审计（`server/match/audit.js` 的 `level → level+1`）与 `SHOP_LEVEL`
 *              事件全部照原样逐步发生 —— 引擎看到的就是「连着升了几级」，不是被硬写一个数。
 *   want < 现在：游戏自己没有「降级」路径，才直接写回 `shop.level`，并把 `upgradePrice` 用游戏自己的
 *              `gd.upgradeBase()` 重算、调一次 `_openLevelSlots()`。
 *
 * 上游 Luck 的 README 把「调度中心等级限制」列进「没改的」第一条，代码里也确实只读不写（`ps.shop.level` 出现 11 次
 * 全是读；`levelUp` 只出现在对局记录器的 `PS_ACTIONS` 表里）—— 所以这是 StrongholdPro 加的一件，不碰上游行为。
 */
function handleShopLevel(match, playerId, msg, state, ERR) {
  if (!state.enable.shopLevel) return fail(ERR.BAD_TARGET, '调度中心·设置等级已关闭（总开关）');
  const seat = seatFor(match, playerId);
  if (seat.error) return seat.error;
  const ps = seat.ps;
  if (!ps.shop || !Number.isInteger(ps.shop.level)) return fail(ERR.BAD_TARGET, '这一局还没到有商店的阶段');
  const gd = ps.gd;
  const max = Number.isInteger(gd && gd.maxShopLevel) ? gd.maxShopLevel : 6;
  const want = Number.isInteger(msg.level) ? Math.max(1, Math.min(max, msg.level)) : ps.shop.level;
  const from = ps.shop.level;
  if (want === from) return OK;
  try {
    if (want < from) {
      ps.shop.level = want;
      ps.shop.upgradePrice = (gd && typeof gd.upgradeBase === 'function' ? gd.upgradeBase(want) : null) || 0;
      ps._openLevelSlots?.();
    } else {
      const before = ps.funds;
      let guard = 0;
      while (ps.shop.level < want && guard++ < 64) {
        const price = Math.max(0, Number(ps.shop.upgradePrice) || 0);
        if (Number.isFinite(before)) ps.funds = before + price;   // 临时补上，让游戏自己那道 `funds < price` 通过
        const res = ps.levelUp();
        if (res && res.error) {
          if (Number.isFinite(before)) ps.funds = before;
          return fail(ERR.BAD_TARGET, `升级被拒：${res.error}`);
        }
      }
      if (Number.isFinite(before)) ps.funds = before;
    }
    ps.dirty?.();
    match.flush?.();
  } catch (e) {
    match.reportError?.('modShopLevel', e);
    return fail(ERR.BAD_TARGET, '设置调度中心等级失败');
  }
  return OK;
}
/** g.modPlace { on, cap } — the deploy unlock and the deploy cap (cap null = the game's own number). */
function handlePlace(match, playerId, msg, state, ERR) {
  if (!state.enable.sandboxPlace) return fail(ERR.BAD_TARGET, '沙盒·地块解锁已关闭（总开关）');
  const seat = seatFor(match, playerId);
  if (seat.error) return seat.error;
  if (!isBool(msg.on) || !isDeployCap(msg.cap)) return fail(ERR.BAD_TARGET, '地块解锁参数不合法');
  state.sandbox.place = msg.on;
  state.sandbox.cap = msg.cap;
  try {
    for (const ps of match.players?.values?.() || []) {
      ps.invalidateDeployMap?.();
      ps.recompute?.(); // turning it off pulls back whatever now stands somewhere illegal
    }
    match.flush();
  } catch (e) {
    match.reportError?.('modPlace', e);
  }
  return OK;
}

// -----------------------------------------------------------------------------------------------------
// the unit rules (技能 / 技力 / 属性)
//
// Three seams, because the game resolves an operator's body in three places:
//
//   1. DataSource.getChess(id, loadout) — the stats the def carries. The battle spec has none, so EACH side resolves them
//      from data/chess.json through this one method; a wrapper here reaches every consumer on this side
//      (battle/players.js `_makeAlly`, content/index.js `swapDef`). The panel wraps the browser's own copy the same way.
//   2. SkillRuntime.reset() — 技力. A kit's SkillSpec may name its own `spCost` / `initSp` and those WIN over the def's
//      (skills.js), so the def-level rewrite would be silently ignored for those operators; the runtime is the only place
//      that always decides.
//   3. PlayerState.battleInput() — 换技能. The chosen skill rides on the unit's `skillIndex`, which is what the sim
//      resolves the def with; that field is this seat's own, so the swap is exactly as wide as the seat (and it reaches
//      the browser, which simulates the player's field: the spec carries `skillIndex`).
//
// Scope 这一名 / 我的全部 are the PANEL's own field — the browser simulates it, so this side is told to sit out and only
// 全场 turns the def/runtime wrappers on here (they are process-wide: every seat's field, the AI teammates included).
// -----------------------------------------------------------------------------------------------------

/** The process-wide patcher behind the getChess wrapper. One config at a time (the panel is a single seat's). */
const unitPatcher = createUnitPatcher();

/** g.modUnit { cfg } — replace the unit-rules config. Not billed to the round's budget. */
function handleUnit(match, playerId, msg, state, ERR) {
  if (!state.enable.sandboxUnit) return fail(ERR.BAD_TARGET, '沙盒·单位已关闭（总开关）');
  const seat = seatFor(match, playerId);
  if (seat.error) return seat.error;
  const cfg = normalizeUnitCfg(msg.cfg);
  if (msg.cfg !== null && !cfg) return fail(ERR.BAD_TARGET, '单位设置不合法');
  // 全场 is the only scope this side applies: the others are the browser's own field (see the header above)
  const appliedHere = !!(cfg && cfg.on && cfg.scope === 'all');
  state.unit = cfg ? { ...cfg, owner: playerId, appliedHere } : null;
  unitPatcher.set(appliedHere ? cfg : null);
  try {
    // the stats of a field already under way do not change (they were copied into every unit at install), but the panel
    // marks itself from this echo — so push it to every seat at once
    for (const ps of match.players?.values?.() || []) ps.dirty?.();
    match.flush();
  } catch (e) {
    match.reportError?.('modUnit', e);
  }
  return OK;
}

/**
 * Install the two server-side seams of the unit rules. `DataSource.getChess` is wrapped on the PROTOTYPE — every source
 * the process builds (Match's own `new DataSource(data)`, the default one, a per-battle loadout view's delegate) goes
 * through it, so there is nothing to re-install per match.
 */
function installUnitRules({ PlayerState, DataSource, SkillRuntime, state, log }) {
  const missing = [];

  if (typeof DataSource?.prototype?.getChess !== 'function') {
    missing.push('DataSource.prototype.getChess');
  } else {
    const origGetChess = DataSource.prototype.getChess;
    DataSource.prototype.getChess = function getChess(id, loadout = null) {
      // the 自选位 kit rides the same seam: unitPatcher owns the stats, diyPatcher the bonds / 特质 of a 自选 def
      return diyPatcher.def(unitPatcher.def(id, origGetChess.call(this, id, loadout)));
    };
    log.info('hooked DataSource.getChess (unit stats)');
  }

  // 技力: the runtime is where spCost / initSp are finally decided (a kit's SkillSpec beats the def).
  if (typeof SkillRuntime?.prototype?.reset !== 'function') {
    missing.push('SkillRuntime.prototype.reset');
  } else {
    const origReset = SkillRuntime.prototype.reset;
    SkillRuntime.prototype.reset = function reset(carry) {
      const cfg = unitPatcher.cfg;
      const u = this.unit;
      const id = u ? (u.defId ?? u.def?.id) : null;
      // operators only: a token's def id is a token id, and the panel never means those
      if (cfg && u && u.kind === 'op' && id != null && unitCovers(cfg, id)) {
        if (cfg.spCost != null) this.baseSpCost = cfg.spCost;
        if (cfg.initSp != null) this.initSp = cfg.initSp;
      }
      return origReset.call(this, carry);
    };
    log.info('hooked SkillRuntime.reset (unit 技力)');
  }

  // 换技能: the seat's own loadout result, rewritten on the way into the battle spec.
  if (typeof PlayerState?.prototype?.battleInput !== 'function') {
    missing.push('PlayerState.prototype.battleInput');
  } else {
    const origBattleInput = PlayerState.prototype.battleInput;
    PlayerState.prototype.battleInput = function battleInput(...args) {
      const input = origBattleInput.apply(this, args);
      try {
        const cfg = state.unit;
        if (cfg?.on && cfg.scope === 'one' && cfg.skill != null && cfg.owner === this.playerId && Array.isArray(input?.units)) {
          const want = baseChessId(cfg.id);
          for (const u of input.units) {
            // a 自选 slot and a 补位 stand-in carry their own skill (round.js says so) — leave those alone
            if (!u || u.kind !== 'chess' || u.diy || u.standIn) continue;
            if (baseChessId(u.chessId) !== want) continue;
            u.skillIndex = cfg.skill;
          }
        }
      } catch (e) {
        log.warn('unit skill swap failed', e?.message || e);
      }
      return input;
    };
    log.info('hooked PlayerState.battleInput (unit 换技能)');
  }

  return missing;
}

// -----------------------------------------------------------------------------------------------------
// the 自选位 rules (盟约 / 特质, and later their numbers)
//
// The author's ask (2026-10-10): a 自选编队 piece should stop being a bare 协防干员 body. He wants to decide, PER SLOT,
// which 盟约 it carries and which 特质 it bears, so whoever he slots there is a core member of his build. The kit stays
// with the SLOT, not the operator (「作用于那个位置」).
//
// Two seams, one per side of the game:
//
//   1. the PREP side — `ps.gd`. `PlayerDiy.setDiy` composes one record per slotted slot and installs
//      `ps.gd = diyGameData(m.gd, records)`; every prep rule reads a record through that view (bondsMeta.pieceBonds,
//      effectsMeta's 特质 ctx, initDiyStock's ban check). So the patch rebuilds the record map and re-installs the view.
//      `setDiy` runs from the PlayerState CONSTRUCTOR (PlayerState.js:183), BEFORE hand / board / layers exist, so that
//      rebuild must NOT compute bonds — the constructor's own `computeBonds` (line 242) picks the new `ps.gd` up by
//      itself. A mid-match change goes through `recompute()` instead.
//   2. the BATTLE side — `DataSource.prototype.getChess`, wrapped once in installUnitRules above (one wrapper, two
//      patchers). The composed 自选 record reaches the sim as the unit's `def` (`simdata.getDiy` → `normalizeChess`), and
//      `def.bonds` / `def.raw.garrisonIds` is what the battle content reads.
//
// The config is PROCESS-WIDE (one map keyed by slot base id), never per seat: the def patcher cannot see a player, and
// only a human seat fields 自选 pieces at all (bots field none, player/diy.js setDiy returns early for them). Every seat
// gets the same echo back through `view.modDiy`, so the panel can show what the server holds.
// -----------------------------------------------------------------------------------------------------

/** The process-wide 自选位 patcher; `diyPatcher.def` is what the getChess wrapper above calls. */
const diyPatcher = createSlotPatcher();
/** The game helpers the rebuild needs, captured once by installSlotRules (the rebuild runs from module-level handlers). */
const slotDeps = { diyGameData: null, diySlot: null, diyRecord: null, checkDiyPick: null, support: null };
/**
 * The kit's number edits as a data object (see slot-rules.patchGameData). Memoised per BASE object and invalidated by
 * `slotGen`, so a mid-match edit rebuilds it once instead of once per lookup (the prep side asks per piece, the battle
 * side per install).
 */
let slotGen = 0;
let slotMemo = { gen: -1, byBase: new WeakMap() };
function patchedDataOf(base) {
  if (!base || typeof base !== 'object') return base;
  if (!hasNumberEdits(diyPatcher.entries())) return base;
  if (slotMemo.gen !== slotGen) slotMemo = { gen: slotGen, byBase: new WeakMap() };
  const hit = slotMemo.byBase.get(base);
  if (hit) return hit;
  const out = patchGameData(diyPatcher.entries(), base);
  slotMemo.byBase.set(base, out);
  return out;
}

/**
 * The mod's own 自选位 (see slot-rules.js "更多自选位"): `[{ k, tier, pick }]`, process-wide like the kit — the game's
 * four slots are fixed in its data, these are the extra ones the panel defines at any tier 1..6.
 */
let diyExtras = [];
/**
 * The 携带技能 the panel set, `{ [slotBaseId]: 0..9 }`. A slot named here has its composed record rebuilt around that
 * skill (the game's own 自选编队 pick keeps whatever it chose, which the panel can thus override).
 */
let diySkills = Object.create(null);
/** The 模组 the panel set, `{ [slotBaseId]: uniEquipId | null }` (null = 不带模组; absent = keep the composed one). */
let diyMods = Object.create(null);
/** The chess records the extra slots add, per economy object (the price differs per tier); rebuilt when the slots change. */
let extraGen = -1;
let extraCache = new WeakMap();
let extraNoEco;
function extraChessTable(holder) {
  if (extraGen !== slotGen) { extraGen = slotGen; extraCache = new WeakMap(); extraNoEco = undefined; }
  if (!diyExtras.length) return null;
  const eco = holder && typeof holder.economy === 'object' ? holder.economy : null;
  if (!eco) {
    if (extraNoEco === undefined) extraNoEco = extraDiyData(diyExtras, null)?.chess ?? null;
    return extraNoEco;
  }
  let hit = extraCache.get(eco);
  if (hit === undefined) {
    hit = extraDiyData(diyExtras, eco)?.chess ?? null;
    extraCache.set(eco, hit);
  }
  return hit;
}

/** The config the panel reads back: slot base id → `{ bonds, addBonds, garrisons, bondBb, garrisonBb }` (ids only). */
function diyCfgView() {
  const out = {};
  for (const s of diyPatcher.slots) {
    const c = diyPatcher.cfgOf(s);
    if (!c) continue;
    const garrisonBb = {};
    for (const g of c.garrisons) if (g.bb) garrisonBb[g.id] = g.bb;
    out[s] = {
      bonds: c.bonds,
      addBonds: c.addBonds,
      garrisons: c.garrisons.map((g) => g.id),
      bondBb: c.bondBb || {},
      garrisonBb,
    };
  }
  return out;
}

/** The mod's own slots as the panel reads them back: `[{ k, tier, pick }]`. */
function diyExtrasView() {
  return diyExtras.map((e) => ({ k: e.k, tier: e.tier, pick: e.pick }));
}

/**
 * Rebuild this seat's composed 自选 records with the slot kit applied, and re-install the data view. True when anything
 * changed. `recompute` (mid-match only) re-derives the bonds afterwards; the constructor path must leave it off.
 */
function applyModDiy(ps, { recompute = false } = {}) {
  const gd = ps?.m?.gd;
  // ALWAYS from the game's own composed records (`__diyBase`, captured by the setDiy wrapper), never from a map this
  // function already patched — otherwise a second edit would layer on top of the first instead of replacing it.
  const src = ps?.__diyBase instanceof Map ? ps.__diyBase : ps?._diyRecords;
  if (!gd || !slotDeps.diyGameData || !(src instanceof Map)) return false;
  // ⭐ The mod's OWN slots are the PLAYER's, never the match's. `handleModDiy` rebuilds every seat in the room (the
  // kit is process-wide), and the game hands EVERY seat an empty `_diyRecords` Map at construction (PlayerState.js:178,
  // `new Map()` before the `isBot` guard on line 183), so without this line the loop below composes the author's
  // custom slots onto the bots as well: they land in `ps.diy`, `initDiyStock` then stocks them like any 自选 piece
  // (`refreshDiyStock` reads `ps.diy`), and `_rollChessSlot` feeds `diyRollEntries()` into the bot's own roll — so a
  // bot rolls, buys and fields them. Author's report 2026-10-11: "AI 也能买到我的自选干员".
  const extras = ps?.isBot ? [] : diyExtras;
  if (src.size === 0 && extras.length === 0) return ps._diyRecords === src ? false : restoreDiyBase(ps, gd, src, recompute);
  // 携带技能 / 模组: rebuild the slots the panel edited, from the game's own pick with those fields replaced
  const skilled = new Map();
  for (const baseId of new Set([...Object.keys(diySkills), ...Object.keys(diyMods)])) {
    const pick = ps.__diyPicks?.[baseId];
    if (!pick) continue;
    const idx = diySkills[baseId];
    const hasMod = Object.prototype.hasOwnProperty.call(diyMods, baseId);
    const made = composeOwnSlot(gd, baseId, {
      ...pick,
      skillIndex: Number.isInteger(idx) ? idx : pick.skillIndex,
      uniEquipId: hasMod ? diyMods[baseId] : pick.uniEquipId,
    });
    if (made) skilled.set(baseId, made);
  }
  const records = new Map();
  for (const [id, rec] of src) {
    const baseId = (rec && rec.diyFor) || id;
    const made = skilled.get(baseId);
    const from = made ? (id === made.goldenId || String(id).endsWith('_b') ? made.elite : made.normal) : rec;
    records.set(id, applySlotOverride(diyPatcher.cfgOf(baseId), from));
  }
  // the mod's own slots (slot-rules "更多自选位"): composed here, because the game's own setDiy never saw them
  const extraPicks = {};
  for (const e of extras) {
    const made = composeExtraSlot(gd, e);
    if (!made) continue;
    const cfg = diyPatcher.cfgOf(made.baseId);
    records.set(made.baseId, applySlotOverride(cfg, made.normal));
    records.set(made.goldenId, applySlotOverride(cfg, made.elite));
    extraPicks[made.baseId] = made.pick;
  }
  const picks = { ...(ps.__diyPicks || {}), ...extraPicks };
  for (const [baseId, made] of skilled) picks[baseId] = made.pick;
  // compared against what the seat HOLDS right now (not against `src`): a config cleared back to nothing must still
  // replace a previously patched map, or the old kit would stick.
  const prev = ps._diyRecords;
  let changed = !(prev instanceof Map) || prev.size !== records.size;
  if (!changed) for (const [id, rec] of records) if (prev.get(id) !== rec) { changed = true; break; }
  if (!changed && sameDiyPicks(ps.diy, picks)) return false;
  ps._diyRecords = records;
  ps.diy = Object.freeze(picks);
  ps.gd = slotDeps.diyGameData(gd, records);
  if (recompute && typeof ps.recompute === 'function' && ps.board && ps.hand) {
    try { ps.recompute(); } catch (e) { /* the view is still installed; the strip catches up on the next recompute */ }
  }
  return true;
}

/** Put the seat back on the game's own records (a cleared kit must undo a previous one). */
function restoreDiyBase(ps, gd, src, recompute) {
  ps._diyRecords = src;
  ps.diy = Object.freeze({ ...(ps.__diyPicks || {}) });
  ps.gd = slotDeps.diyGameData(gd, src);
  if (recompute && typeof ps.recompute === 'function' && ps.board && ps.hand) {
    try { ps.recompute(); } catch (e) { /* the strip catches up on the next recompute */ }
  }
  return true;
}

/**
 * Re-compose one of the GAME's own 自选 slots around an edited 携带技能: the same steps setDiy takes (checkDiyPick, then
 * diyRecord for both forms) with `pick.skillIndex` replaced. Null when the pick or the skill is illegal, in which case
 * that slot simply keeps the record the game composed.
 */
function composeOwnSlot(gd, slotId, pick) {
  const data = gd?.raw;
  if (!data || !slotDeps.diyRecord || !slotDeps.checkDiyPick || !slotDeps.diySlot) return null;
  let chk;
  try { chk = slotDeps.checkDiyPick(slotId, pick, data); } catch { return null; }
  if (!chk || !('ok' in chk)) return null;
  const slot = slotDeps.diySlot(slotId, data);
  if (!slot) return null;
  let normal;
  let elite;
  try {
    normal = slotDeps.diyRecord(slotId, chk.pick, { elite: false, data });
    elite = slotDeps.diyRecord(slotId, chk.pick, { elite: true, data });
  } catch { return null; }
  if (!normal || !elite) return null;
  return { baseId: slot.baseId, goldenId: slot.goldenId, normal, elite, pick: chk.pick };
}

/** Whether two pick maps say the same thing (identity differs every rebuild, so compare the entries). */
function sameDiyPicks(a, b) {
  const ka = Object.keys(a || {});
  const kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  return ka.every((k) => {
    const x = a[k];
    const y = b[k];
    return !!y && x.charId === y.charId && x.skillIndex === y.skillIndex && (x.uniEquipId ?? null) === (y.uniEquipId ?? null);
  });
}

/**
 * Compose the pair of records of one mod-owned slot (slot-rules "更多自选位"). The game's `diyRecord` is reused through a
 * data shim that carries the mod's chess records and `diy.slots` entries, so a mod slot validates and composes exactly
 * like one of the game's own. Null when the pick is illegal or the data is missing.
 * @returns {{ baseId: string, goldenId: string, normal: object, elite: object, pick: object }|null}
 */
function composeExtraSlot(gd, e) {
  const base = gd?.raw;
  const slotId = extraSlotId(e?.k, false);
  const table = extraChessTable(gd);
  const slot = table?.[slotId];
  if (!base || !slot || !slotDeps.diyRecord || !slotDeps.checkDiyPick) return null;
  const data = {
    chess: { ...base.chess, ...table },
    backups: { ...base.backups, diy: extraDiyTable(base.backups?.diy, diyExtras) },
  };
  let chk;
  try { chk = slotDeps.checkDiyPick(slotId, e.pick, data); } catch { return null; }
  if (!chk || !('ok' in chk)) return null;
  let normal;
  let elite;
  try {
    normal = slotDeps.diyRecord(slotId, chk.pick, { elite: false, data });
    elite = slotDeps.diyRecord(slotId, chk.pick, { elite: true, data });
  } catch { return null; }
  if (!normal || !elite) return null;
  return { baseId: slotId, goldenId: extraSlotId(e.k, true), normal, elite, pick: chk.pick };
}

/**
 * Re-derive a seat's 自选 stock after a kit change, WITHOUT resetting the copies it already holds (`initDiyStock` rebuilds
 * every cap from scratch, which would hand back sold copies). A slot whose bonds are now all banned loses its stock, the
 * same rule the game applies once the bans are drawn.
 */
function refreshDiyStock(ps, off) {
  const stock = ps?.diyStock;
  const gd = ps?.m?.gd;
  if (!stock?.entries || !gd || !(off instanceof Set)) return;
  const banned = [];
  // a slot that is no longer slotted at all (a mod slot the panel removed) must lose its stock too
  for (const id of [...stock.entries.keys()]) if (!Object.prototype.hasOwnProperty.call(ps.diy || {}, id)) stock.entries.delete(id);
  for (const slotId of Object.keys(ps.diy || {})) {
    const rec = ps._diyRecords?.get?.(slotId);
    const bonds = rec && Array.isArray(rec.bonds) ? rec.bonds : [];
    if (bonds.length > 0 && bonds.every((b) => off.has(b))) { stock.entries.delete(slotId); banned.push(slotId); continue; }
    const cap = gd.poolCopies(slotId);
    if (!(cap > 0)) { stock.entries.delete(slotId); continue; }
    const slot = slotDeps.diySlot ? slotDeps.diySlot(slotId, gd.raw) : null;
    const entry = stock.entries.get(slotId);
    if (!entry) stock.entries.set(slotId, { cap, left: cap, tier: gd.tierOf(slotId), shopLevel: slot?.shopLevel ?? gd.tierOf(slotId) });
    else entry.cap = cap;
  }
  ps.diyBanned = Object.freeze(banned);
}

/** g.modDiy { slots } — the 自选位 kit. Not billed to the round's budget. */
function handleModDiy(match, playerId, msg, state, ERR) {
  const seat = seatFor(match, playerId);
  if (seat.error) return seat.error;
  if (!isDiyCfg(msg)) return fail(ERR.BAD_TARGET, '自选位设置不合法');
  // the master switches: a group that is off contributes NOTHING here, which also means the panel's next push clears
  // whatever it had set (the payload is a full replacement, not a patch).
  const slotsCfg = state.enable.diy ? msg.slots : {};
  const extraCfg = state.enable.diyExtra ? msg.extra : [];
  const skillsCfg = state.enable.diy ? msg.skills : {};
  const modsCfg = state.enable.diy ? msg.mods : {};
  const data = match.gd?.raw || null;
  const knownSlots = new Set(Object.keys(data?.backups?.diy?.slots || {}));
  for (const e of extraCfg || []) if (e && Number.isInteger(e.k)) knownSlots.add(extraSlotId(e.k, false));
  const tables = data ? { bonds: data.bonds, garrisons: data.garrisons } : null;
  const next = new Map();
  for (const [slotId, raw] of Object.entries(slotsCfg || {})) {
    const base = slotBaseId(slotId);
    if (!knownSlots.has(base)) return fail(ERR.BAD_TARGET, `不是本局的位子（${slotId}）`);
    if (raw == null) continue;
    const cfg = normalizeSlotCfg(raw, tables);
    // an explicit-but-illegal config (a bond that does not exist) is refused rather than silently dropped
    const wanted = (Array.isArray(raw.bonds) && raw.bonds.length) || (Array.isArray(raw.addBonds) && raw.addBonds.length)
      || (Array.isArray(raw.garrisons) && raw.garrisons.length);
    if (!cfg && wanted) return fail(ERR.BAD_TARGET, `自选位设置里没有可用的盟约或特质（${slotId}）`);
    if (!cfg) continue;
    next.set(base, cfg);
  }
  diyPatcher.set(next);
  // the mod's own slots: a slot with no pick yet is not built (nothing to compose), and `k` is unique by construction
  const extras = [];
  const seen = new Set();
  for (const e of extraCfg || []) {
    if (!e || !e.pick || typeof e.pick.charId !== 'string' || seen.has(e.k)) continue;
    seen.add(e.k);
    extras.push({ k: e.k, tier: e.tier, pick: { charId: e.pick.charId, skillIndex: e.pick.skillIndex ?? null, uniEquipId: e.pick.uniEquipId ?? null } });
  }
  diyExtras = extras;
  const skills = Object.create(null);
  for (const [slotId, idx] of Object.entries(skillsCfg || {})) {
    if (Number.isInteger(idx) && idx >= 0 && idx <= 9) skills[slotBaseId(slotId)] = idx;
  }
  diySkills = skills;
  const mods = Object.create(null);
  for (const [slotId, id] of Object.entries(modsCfg || {})) {
    if (id === null || typeof id === 'string') mods[slotBaseId(slotId)] = id || null;
  }
  diyMods = mods;
  slotGen++; // the number edits changed: the memoised data patches have to be rebuilt
  // every seat is OFFERED the rebuild (the config is process-wide); `applyModDiy` itself declines on a bot, so only a
  // seat that can actually field 自选 pieces is touched
  let n = 0;
  for (const ps of match.players?.values?.() || []) {
    if (applyModDiy(ps, { recompute: true })) {
      if (ps.__modDiyOff) refreshDiyStock(ps, ps.__modDiyOff);
      n++;
    }
  }
  try { match.flush(); } catch (e) { match.reportError?.('modDiy', e); }
  return OK;
}

// -----------------------------------------------------------------------------------------------------
// the master switches (g.modEnable)
//
// The author's ask (2026-10-11): he keeps ending up "wanting everything", which flattens the game, so he wants a
// switch per GROUP of gameplay-changing features — and a switch has to mean the feature DOES NOT EXIST, not merely
// that new messages are refused. Hence `rollbackFeature`: turning one off takes back what is already in effect.
//
// 倍速 and 自动倒转 are not in the table and are untouched by any of this. Neither changes the simulation (the speed
// is presentation, and the auto loop spends only the seat's own funds on its own purchases), which is what leaves the
// "play it straight, but fast, and let the loop do the shopping" session possible.
// -----------------------------------------------------------------------------------------------------

/** g.modEnable { features } — set the master switches; each one turned off has its live state taken back. */
function handleEnable(match, playerId, msg, state, ERR) {
  const seat = seatFor(match, playerId);
  if (seat.error) return seat.error;
  if (!isFeatures(msg.features)) return fail(ERR.BAD_TARGET, '开关参数不合法');
  const next = { ...state.enable };
  for (const [k, v] of Object.entries(msg.features)) if (FEATURE_KEYS.includes(k)) next[k] = v;
  const turnedOff = FEATURE_KEYS.filter((k) => state.enable[k] && !next[k]);
  state.enable = next;
  for (const k of turnedOff) {
    try { rollbackFeature(match, state, k); } catch (e) { match.reportError?.(`modEnable:${k}`, e); }
  }
  try {
    for (const ps of match.players?.values?.() || []) ps.dirty?.();
    match.flush();
  } catch (e) {
    match.reportError?.('modEnable', e);
  }
  return OK;
}

/** Take back one group's live effect. Everything here is process-wide, so it runs over every seat. */
function rollbackFeature(match, state, key) {
  const seats = [...(match.players?.values?.() || [])];
  if (key === 'shop') {
    // nothing persistent: a pick or a direct buy lands the moment it arrives, and the round's budget is spent as it
    // goes. Refusing the next one (the guard in the handlers) is the whole of it.
  } else if (key === 'sandboxBands') {
    for (const ps of seats) {
      ps.modBands = [];
      // The LP floor a stack raised is NOT taken back: lp is already spent and the game cannot unsay it. `applyMaxLp`
      // re-reads `modBands` on every band apply, so with the list emptied nothing keeps raising it.
      try { applyMaxLp(match, ps); } catch { /* the floor just stays where it was */ }
    }
  } else if (key === 'shopLevel') {
    // 只是把「上次设过几级」的记账清掉；本座当前等级本来就在 `ps.shop.level` 上，由游戏自己管。
    state.shopLevel.level = 1;
  } else if (key === 'sandboxPlace') {
    // both the unlock and the cap are read at the CALL SITE (deployMapFor / _placementOf / the deployCap getter), so
    // clearing these two is enough — the same path handlePlace takes when the panel switches it off.
    state.sandbox.place = false;
    state.sandbox.cap = null;
    for (const ps of seats) ps.invalidateDeployMap?.();
  } else if (key === 'sandboxUnit') {
    state.unit = null;
    unitPatcher.set(null);
  } else if (key === 'diy' || key === 'diyExtra') {
    if (key === 'diy') diyPatcher.set(new Map());
    else diyExtras = [];
    for (const ps of seats) {
      // rebuild from the game's own records; with both maps empty this puts the seat back on `__diyBase` exactly
      try { applyModDiy(ps, { recompute: false }); } catch { /* the view stays; the strip catches up on recompute */ }
      try { if (ps.__modDiyOff) refreshDiyStock(ps, ps.__modDiyOff); } catch { /* stock refresh is best-effort */ }
    }
  } else if (key === 'test') {
    // 测试页的值都只是「上次设过多少」的回显；真实状态在游戏自己的对象上（funds / round / gd.lastRound）。
    // ⚠️ `enemy.installed` 不动 —— 影子补丁装在 `gd` 上，关总开关只是让它不再生效（list 空了），
    // 拆掉反而会在下一回合换回来、把已经改好的波次又盖回去。
    state.test.funds = null;
    state.test.round = null;
    state.test.roundCap = null;
    state.test.map = null;
    state.test.bond = null;
    state.test.comboRound = null;
    state.test.comboAll = false;
    state.test.combos = null;
    state.test.boss = null;
    state.test.timer.combat = null;
    state.test.timer.prep = null;
    state.test.enemy.list = [];
    state.test.enemy.wave = null;
  } else if (key === 'shopFilter') {
    for (const ps of seats) ps.modShopFilter = { on: false, bonds: [], mode: 'only' };
  }
  for (const ps of seats) { try { ps.recompute?.(); } catch { /* best effort */ } }
}

/** Install the 自选位 seams: the prep rebuild (setDiy / initDiyStock) and the stock refresh hook. */
function installSlotRules({ PlayerState, Battle, GameData, DataSource, support, diyMod, diyDataMod, bondsMetaMod, log }) {
  const missing = [];
  if (typeof diyMod?.diyGameData !== 'function') missing.push('server/match/player/diy.js diyGameData');
  else slotDeps.diyGameData = diyMod.diyGameData;
  if (typeof diyDataMod?.diySlot === 'function') slotDeps.diySlot = diyDataMod.diySlot;
  if (typeof diyDataMod?.diyRecord === 'function') slotDeps.diyRecord = diyDataMod.diyRecord;
  if (typeof diyDataMod?.checkDiyPick === 'function') slotDeps.checkDiyPick = diyDataMod.checkDiyPick;
  if (typeof bondsMetaMod?.computeBonds !== 'function') missing.push('server/match/bondsMeta.js computeBonds');
  if (typeof support?.gameData === 'function' && typeof support?.setGameData === 'function') slotDeps.support = support;
  else missing.push('server/sim/content/support/index.js setGameData');

  // the kit's number edits, resolved by the PREP side: a 特质 the author gave his own numbers lives under a minted id
  // (slot-rules mintGarrisonId) that the data does not have; a 盟约 keeps its own id but carries the author's `bb`.
  if (typeof GameData?.prototype?.garrison !== 'function') {
    missing.push('GameData.prototype.garrison');
  } else {
    const origGarrison = GameData.prototype.garrison;
    GameData.prototype.garrison = function garrison(id) {
      const patched = patchedDataOf(this.raw);
      return (patched !== this.raw ? patched.garrisons?.[id] : null) ?? origGarrison.call(this, id);
    };
    const origBond = GameData.prototype.bond;
    GameData.prototype.bond = function bond(id) {
      const patched = patchedDataOf(this.raw);
      return (patched !== this.raw ? patched.bonds?.[id] : null) ?? origBond.call(this, id);
    };
    // the mod's own slots: every accessor (`tierOf`, `poolCopies`, `chessPrice`, `baseIdOf`, `goldenIdOf`, …) reads the
    // chess table through this one method, so resolving them here is enough for the whole prep side
    const origChess = GameData.prototype.chess;
    GameData.prototype.chess = function chess(id) {
      const table = extraChessTable(this);
      if (table && isExtraSlotId(id) && table[id]) return table[id];
      return origChess.call(this, id);
    };
    log.info('hooked GameData.garrison / .bond / .chess (自选位 numbers + 更多位子)');
  }

  // the BATTLE side resolves a 自选 def through the DataSource's own tables (`rawChess` / `rawBackups`), so a mod slot
  // has to answer there too or its piece would come out as an unknown chess on both processes.
  if (typeof DataSource?.prototype?.rawChess === 'function') {
    const origRawChess = DataSource.prototype.rawChess;
    DataSource.prototype.rawChess = function rawChess(id) {
      const table = extraChessTable(this);
      if (table && isExtraSlotId(id) && table[id]) return table[id];
      return origRawChess.call(this, id);
    };
    const origRawBackups = DataSource.prototype.rawBackups;
    DataSource.prototype.rawBackups = function rawBackups() {
      const b = origRawBackups.call(this);
      if (!b || !diyExtras.length) return b;
      return { ...b, diy: extraDiyTable(b.diy, diyExtras) };
    };
    log.info('hooked DataSource.rawChess / .rawBackups (更多位子)');
  } else {
    missing.push('DataSource.prototype.rawChess');
  }

  // the BATTLE side reads its numbers from `support.gameData()`; the swap has to bracket the content install, which is
  // the one moment every bond / 特质 installer reads its `bb` (they capture it then and re-apply from the closure).
  // A stack, not a single slot: one Battle's install never nests another's today, and if it ever did the bracket would
  // still unwind in the right order.
  const swapStack = [];
  if (slotDeps.support && patchContentSeam(Battle, {
    beforeInstall: () => {
      const base = slotDeps.support.gameData();
      const patched = patchedDataOf(base);
      swapStack.push(base);
      if (patched !== base) slotDeps.support.setGameData(patched);
    },
    afterInstall: () => {
      const base = swapStack.pop();
      if (base !== undefined) slotDeps.support.setGameData(base);
    },
  })) {
    log.info('hooked the battle content install (自选位 numbers)');
  } else {
    missing.push('the battle content install (自选位 numbers)');
  }

  if (typeof PlayerState?.prototype?.setDiy !== 'function') {
    missing.push('PlayerState.prototype.setDiy');
    return missing;
  }
  const origSetDiy = PlayerState.prototype.setDiy;
  PlayerState.prototype.setDiy = function setDiy(picks, opts) {
    const res = origSetDiy.call(this, picks, opts);
    // keep the game's own composed records as the base every rebuild starts from (applyModDiy must never layer)
    if (this._diyRecords instanceof Map) this.__diyBase = this._diyRecords;
    this.__diyPicks = { ...(this.diy || {}) };
    // the constructor calls this before hand / board exist: rebuild the records and the view, no bond recompute
    try { applyModDiy(this, { recompute: false }); } catch (e) { log.warn('自选位 kit rebuild failed', e?.message || e); }
    return res;
  };
  const origInitStock = PlayerState.prototype.initDiyStock;
  if (typeof origInitStock === 'function') {
    PlayerState.prototype.initDiyStock = function initDiyStock(off = new Set()) {
      this.__modDiyOff = off instanceof Set ? off : new Set();
      const res = origInitStock.call(this, off);
      // the kit may make a slot 本局禁用 (all its bonds banned) or un-ban it: re-derive the stock from the patched records
      try { if (!diyPatcher.empty) refreshDiyStock(this, this.__modDiyOff); } catch (e) { log.warn('自选位 stock refresh failed', e?.message || e); }
      return res;
    };
  } else {
    missing.push('PlayerState.prototype.initDiyStock');
  }
  return missing;
}

// -----------------------------------------------------------------------------------------------------
// the shop mutations
// -----------------------------------------------------------------------------------------------------

/**
 * Fill shop slot `slotIdx` with `id`. Same gates as PlayerState.buy's first half (prep phase, alive, not ready,
 * unsold slot, matching kind) and the same eligibility the roll itself obeys.
 * @returns {null | { error: string, detail?: string }} null = done
 */
function pickSlot(ps, slotIdx, id, { ERR, PHASE }) {
  const gate = ps._gate();
  if (gate) return gate;
  if (ps.m?.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);

  const slots = ps.shop?.slots;
  if (!Array.isArray(slots) || !Number.isInteger(slotIdx) || slotIdx < 0 || slotIdx >= slots.length) return fail(ERR.BAD_TARGET);
  const cur = slots[slotIdx];
  if (cur && cur.sold) return fail(ERR.BAD_TARGET, '该槽位已售出');

  const layout = ps.shop.layout || { chess: slots.length, item: 0 };
  const frozen = !!ps.shop.frozen;

  if (slotIdx < layout.chess) {
    const bad = chessEligibility(ps, id, ERR);
    if (bad) return bad;
    slots[slotIdx] = { kind: 'chess', id, basePrice: ps.gd.chessPrice(id), frozen, sold: false };
  } else {
    const bad = itemEligibility(ps, id, ERR);
    if (bad) return bad;
    slots[slotIdx] = { kind: 'item', id, basePrice: ps.gd.itemPrice(id), frozen, sold: false };
  }

  ps.dirty();
  return null;
}

/**
 * Buy `id` straight into the hand: no shop slot, no roll, no refresh. Mirrors PlayerState.buy's first half
 * (PlayerState.js:888) against a synthetic slot, then runs the same tail (spend → acquire → stats → onBuy → after
 * spend → recompute). The synthetic slot matters: onBuy handlers read `ev.slot.id` (server/sim/content/bands/meta.js).
 * @returns {null | { error: string, detail?: string }} null = done
 */
function directBuy(ps, id, { ERR }) {
  const gate = ps._gate();
  if (gate) return gate; // already enforces PREP / alive / not ready

  const kind = ps.gd.chess(id) ? 'chess' : ps.gd.item(id) ? 'item' : null;
  if (!kind) return fail(ERR.BAD_TARGET, '不是可招募的干员或装备');
  const bad = kind === 'chess' ? chessEligibility(ps, id, ERR) : itemEligibility(ps, id, ERR);
  if (bad) return bad;

  const handFull = !ps.hand.some((p) => p == null);
  if (handFull && !(kind === 'chess' ? ps.completesChessMerge(id) : ps.completesItemMerge(id))) {
    return fail(ERR.HAND_FULL);
  }

  const slot = { kind, id, basePrice: kind === 'chess' ? ps.gd.chessPrice(id) : ps.gd.itemPrice(id), frozen: false, sold: false };
  const price = ps.priceOf(slot); // keeps the onPrice chain (band/garrison discounts) working
  if (ps.funds < price) return fail(ERR.NO_FUNDS);

  ps.spend(price);
  slot.sold = true;
  const piece = kind === 'chess' ? ps.acquireChess(id, { source: 'buy' }) : ps.acquireItem(id, { source: 'buy' });
  ps.stats.buys++;
  ps.round.buys++;
  ps.m.dispatch(ps, 'onBuy', { piece, slot, price, kind });
  ps._afterSpend(price, 'buy');
  ps.recompute();
  return null;
}

/** The eligibility the roll itself obeys for a base chess: visible, tier ≤ shop level, a copy left in the pool. */
function chessEligibility(ps, id, ERR) {
  const rec = ps.gd.chess(id);
  if (!rec || rec.isGolden || rec.isHidden || !Number.isInteger(rec.tier)) {
    return fail(ERR.BAD_TARGET, '不是可招募的干员');
  }
  // 自选编队 (0.2.0): `ps.gd` is THIS seat's own data view, so a slot they filled resolves to the composed record of
  // their own pick (`diyFor`, player/diy.js diyGameData). An unfilled slot, another seat's, or a bot's has no `diyFor`
  // and stays refused — exactly like the raw slot record the rolled shop would never draw.
  if (rec.isDiy) return diyEligibility(ps, id, rec, ERR);
  if (!rec.visible) return fail(ERR.BAD_TARGET, '不是可招募的干员');
  if (rec.tier > ps.shop.level) return fail(ERR.BAD_TARGET, '调度中心等级不足');
  if (!ps.m.pool?.has(id) || ps.m.pool.left(id) < 1) return fail(ERR.SOLD_OUT, '卡池里没有多余的该干员');
  return null;
}

/**
 * The eligibility a 自选 piece obeys: this seat's own stock of the slot, and the same 调度中心 gate the roll uses.
 * A slot's stock is per player and never enters the shared pool (player/diy.js DiyStock); a slot whose bonds are all
 * switched off this match has no stock at all, so it leaves the shop like a preset whose bonds are gone. The gate is
 * the slot's own `shopLevel` (activity_table: the tier-5 slots at level 5, the tier-6 ones at level 6), not its tier.
 */
function diyEligibility(ps, id, rec, ERR) {
  if (!rec.diyFor) return fail(ERR.BAD_TARGET, '不是本局可用的自选干员');
  const stock = ps.diyStock?.entries?.get(ps.gd.baseIdOf(id));
  if (!stock) return fail(ERR.BAD_TARGET, '不是本局可用的自选干员');
  if (ps.shop.level < stock.shopLevel) return fail(ERR.BAD_TARGET, `调度中心等级不足（自选干员要 Lv.${stock.shopLevel}）`);
  if (!(stock.left > 0)) return fail(ERR.SOLD_OUT, '这名自选干员的份额已经用完了');
  return null;
}

/** The eligibility the roll itself obeys for an item: shop-eligible and its tier unlocked. */
function itemEligibility(ps, id, ERR) {
  const rec = ps.gd.item(id);
  if (!rec) return fail(ERR.BAD_TARGET, '不是装备');
  const tier = Number.isInteger(rec.tier) ? rec.tier : 1;
  const list = ps.gd.shopItemsByTier?.[tier];
  if (tier > ps.shop.level || !Array.isArray(list) || !list.includes(id)) return fail(ERR.BAD_TARGET, '这档装备不会出现在商店');
  return null;
}

// -----------------------------------------------------------------------------------------------------
// the shop bond filter (阵营锁)
//
// The author's ask (2026-10-10): once you have settled on the bonds you are building, the shop stops offering
// anything else. The scope he set:
//
//   * the AUTOMATIC roll only — the panel's 自选/直购 list is left alone (he explicitly did not want it locked);
//   * this seat only — the setting rides on `ps.modShopFilter`, so the AI seats (same code, different seat) are a
//     no-op;
//   * a slot the filter leaves empty STAYS empty (`roll` returns null and `rollShop` already accepts null slots) —
//     that is the lock working, so there is no fallback.
//
// 2026-10-12, the author's second pass: keep the MULTI-bond chips, and put the reading on top of them as a second
// axis. (A first cut collapsed both to a single bond; the author shot that down — the multi-select is the thing he
// builds with, and the reading is what he was missing.) The two readings pick which way the chosen set is joined:
//
//   * mode 'has'  — 并集, 带所选里任意一条即留. The wide net: under {拉特兰, 迅捷} every 拉特兰 piece and every 迅捷
//     piece passes, 能天使 (拉特兰+迅捷) included.
//   * mode 'only' — 子集, 干员的盟约全都落在所选内才留. The narrow net (this is the 2026-10-10 reading, unchanged):
//     under {拉特兰, 迅捷} a pure-拉特兰 or pure-迅捷 piece passes and 能天使 does too, but a 拉特兰+维多利亚 piece is
//     dropped. Pick a single bond and it degenerates to "只留纯单盟约".
//
// Both axes are the author's; the panel shows the live admitted count so a selection that empties the shop is
// visible before it bites.
//
// The seam is `PlayerState.prototype._rollChessSlot` (server/match/player/economy.js:63): three lines that hand
// `{ maxTier, extra }` to `SharedPool.roll`, which already takes a `filter` — the very mechanism the game's own
// bond grants use (choices.js:484-491, builtinMeta.js:54). Re-implementing those three lines is the cheapest
// injection point; wrapping `pool.roll` instead would need a "which seat is rolling" side channel, since the pool
// is shared and seat-blind. `extra` (this seat's own 自选编队 stock) goes through the same filter, so a 自选
// operator outside the chosen bonds stops appearing too.
// -----------------------------------------------------------------------------------------------------

/** The seat's active filter, or null when it is off / empty (an empty set must not blank the shop by accident). */
function activeShopFilter(ps) {
  const f = ps?.modShopFilter;
  if (!f || !f.on || !Array.isArray(f.bonds) || !f.bonds.length) return null;
  return { bonds: f.bonds, mode: isFilterMode(f.mode) ? f.mode : 'only' };
}

/**
 * `SharedPool.roll`'s `filter(id, entry)` for the chosen bond set:
 *   'has'  — 并集: the operator carries AT LEAST ONE of the chosen bonds.
 *   'only' — 子集: EVERY one of the operator's bonds is in the chosen set.
 */
const bondFilter = (ps, bonds, mode) => {
  const set = new Set(bonds);
  return (cid) => {
    const c = ps.gd.chess(cid);
    const bs = c && Array.isArray(c.bonds) ? c.bonds : null;
    if (!bs || !bs.length) return false;
    return mode === 'has' ? bs.some((b) => set.has(b)) : bs.every((b) => set.has(b));
  };
};

/**
 * The bonds that are actually in play this match, for the panel's picker: any bond carried by a chess that is in the
 * pool (so a 本局禁用 or hidden operator's bonds never show). Memoised on the match — the pool's roster is fixed for
 * the whole match, and this runs out of `privateView`, which is rebuilt on every change.
 */
function bondPool(ps) {
  const m = ps?.m;
  if (!m) return [];
  if (Array.isArray(m.__modBondPool)) return m.__modBondPool;
  const gd = ps.gd;
  const seen = new Set();
  const out = [];
  for (const id of gd.visibleChess || []) {
    if (!m.pool?.has?.(id)) continue;
    const c = gd.chess(id);
    for (const b of (c && Array.isArray(c.bonds)) ? c.bonds : []) {
      if (seen.has(b) || !gd.bond(b)) continue;
      seen.add(b);
      const rec = gd.bond(b);
      out.push({ id: b, name: rec.name || b, isCore: !!rec.isCore });
    }
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  m.__modBondPool = out;
  return out;
}

/** How many DISTINCT operators the filter admits right now (same guards as the roll: in pool, tier ≤ level, copies
 *  left; plus this seat's 自选编队 stock). Lets the panel warn before a selection empties the shop. */
function shopFilterCount(ps, bonds, mode) {
  const keep = bondFilter(ps, bonds, mode);
  const level = ps.shop?.level ?? 1;
  let n = 0;
  for (const id of ps.gd.visibleChess || []) {
    if (!ps.m?.pool?.has?.(id)) continue;
    if (ps.gd.tierOf(id) > level || ps.m.pool.left(id) < 1) continue;
    if (keep(id)) n++;
  }
  for (const [id, e] of ps.diyStock?.entries || []) {
    if (!(e.left > 0) || e.shopLevel > level) continue;
    const rec = ps.gd.chess(id);
    if (rec && rec.diyFor && keep(id)) n++;
  }
  return n;
}

/** What the panel reads: this seat's 阵营锁 (bonds + mode), the bonds it may name, and the live admitted count. */
function shopFilterView(ps) {
  const f = ps?.modShopFilter;
  const on = !!(f && f.on);
  const bonds = f && Array.isArray(f.bonds) ? f.bonds : [];
  const mode = f && isFilterMode(f.mode) ? f.mode : 'only';
  return { on, bonds, mode, pool: bondPool(ps), count: on && bonds.length ? shopFilterCount(ps, bonds, mode) : null };
}

/** g.modShopFilter { on, bonds, mode } — the 阵营锁. Not billed to the round's budget. */
function handleShopFilter(match, playerId, msg, state, ERR) {
  if (!state.enable.shopFilter) return fail(ERR.BAD_TARGET, '阵营锁已关闭（总开关）');
  const seat = seatFor(match, playerId);
  if (seat.error) return seat.error;
  if (!isShopFilter(msg)) return fail(ERR.BAD_TARGET, '阵营锁参数不合法');
  const ps = seat.ps;
  const gd = match.gd;
  const bonds = [];
  for (const id of msg.bonds) {
    if (!gd.bond(id)) return fail(ERR.BAD_TARGET, `没有这个盟约（${id}）`);
    if (!bonds.includes(id)) bonds.push(id);
  }
  ps.modShopFilter = { on: !!msg.on, bonds, mode: msg.mode };
  try { ps.dirty?.(); match.flush(); } catch (e) { match.reportError?.('modShopFilter', e); }
  return OK;
}

/** The `_rollChessSlot` wrapper: the game's own three lines with `filter` folded in when this seat's lock is on. */
function installShopFilter({ PlayerState, log }) {
  if (typeof PlayerState?.prototype?._rollChessSlot !== 'function') return ['PlayerState.prototype._rollChessSlot'];
  const origRollChess = PlayerState.prototype._rollChessSlot;
  PlayerState.prototype._rollChessSlot = function _rollChessSlot() {
    const f = activeShopFilter(this);
    if (!f) return origRollChess.call(this);
    const extra = typeof this.diyRollEntries === 'function' ? this.diyRollEntries() : null;
    const id = this.m.pool.roll(this.m.rngShop, {
      maxTier: this.shop.level,
      extra,
      filter: bondFilter(this, f.bonds, f.mode),
    });
    return id ? { kind: 'chess', id, basePrice: this.gd.chessPrice(id), frozen: false, sold: false } : null;
  };
  log.info('hooked PlayerState._rollChessSlot (阵营锁)');
  return [];
}

// -----------------------------------------------------------------------------------------------------
// what the panel may offer
// -----------------------------------------------------------------------------------------------------

/**
 * The ids this player could legitimately roll into a shop slot right now: visible base chess of tier ≤ shop level
 * that are in this match's pool with a copy left, plus the shop-eligible items of those tiers, plus this seat's own
 * 自选编队 pieces.
 * Recomputed per private view (the view is rebuilt on every change), so it always agrees with the server.
 */
function pickable(ps) {
  const level = ps.shop?.level ?? 1;
  const chess = [];
  // every card THIS match's protocol deals, at any level: the auto-reverse target list filters on this, so a card
  // that is 本局禁用 or hidden never shows up in it (调度中心等级 is a temporary limit, not a ban — the list would
  // otherwise shrink to tier 1 at the start of every match)
  const pool = [];
  for (const id of ps.gd.visibleChess || []) {
    if (!ps.m?.pool?.has(id)) continue;
    pool.push(id);
    if (ps.gd.tierOf(id) > level || ps.m.pool.left(id) < 1) continue;
    chess.push(id);
  }
  const item = [];
  for (let t = 1; t <= level; t++) {
    const list = ps.gd.shopItemsByTier?.[t];
    if (Array.isArray(list)) item.push(...list);
  }
  // 自选编队 (0.2.0): this seat's own slotted operators. They never join the shared pool — each seat has its own stock
  // (player/diy.js DiyStock) and only its own shop draws from it — so they are listed from that stock instead. Listed
  // as soon as the seat has one with copies left, `ok: false` while the 调度中心 is still below the slot's own
  // `shopLevel` (the same gate diyRollEntries applies): the player's own picks must not be invisible just because the
  // level is low — the panel greys them and says which level opens them.
  const diy = [];
  for (const [id, e] of ps.diyStock?.entries || []) {
    if (!(e.left > 0)) continue;
    const rec = ps.gd.chess(id);
    if (!rec || !rec.diyFor) continue; // an unfilled slot has no composed record of ours
    diy.push({ id, tier: e.tier, level: e.shopLevel, ok: level >= e.shopLevel, left: e.left });
  }
  // slot counts come from the level's own table, not from the current roll: a private view sent before the shop rolled
  // (slots still empty) must still tell the panel which slots there are
  const lv = ps.gd.shopSlots(level) || { chess: 3, item: 1 };
  const layout = ps.shop?.layout;
  const chessSlots = layout && Number.isInteger(layout.chess) && layout.chess > 0 ? layout.chess : lv.chess;
  const itemSlots = layout && Number.isInteger(layout.item) && layout.item > 0 ? layout.item : lv.item;
  return { chess, pool, item, diy, chessSlots, itemSlots };
}

// =====================================================================================================
// RECORDER — one JSONL, one event per line. See README "记录了什么".
//
//   act     a seat action (human or bot): name, args, ok/err, and before/after fingerprints + a noop flag, so a
//           rejected action and a does-nothing action are both distinguishable. A HUMAN act also carries `snap`
//           (the full private view).
//   intent  the raw `g.*` a human sent (thin; covers intents with no PlayerState verb and validation rejects)
//   round   once per round: stage, the three special enemy types, this round's enemy plan, per-seat summary
//   prep    once per round per human: the full private view at the start of prep
//   combat  once per combat: each seat's kills/leaks/perfect
//   settle  once per round: each seat's LP before→after, damage taken, leaks, elimination
//   start   round 1: mode/difficulty/stage/factions/boss rounds/the 15-round type schedule
//   end     the match finished
// =====================================================================================================

function installRecorder({ Match, PlayerState, state, log }) {
  const missing = [];
  const emit = (ev) => emitEvent(state, log, ev);

  // -- per-seat actions --------------------------------------------------------------------------------
  for (const name of PS_ACTIONS) {
    if (typeof PlayerState.prototype[name] !== 'function') { missing.push(`PlayerState.${name}`); continue; }
    const orig = PlayerState.prototype[name];
    PlayerState.prototype[name] = function (...args) {
      const before = fingerprint(this);
      const h1 = stateHash(this);
      let res;
      try {
        res = orig.apply(this, args);
      } catch (e) {
        emit(actEvent(this, name, args, fail('THREW', String(e?.message || e)), before, fingerprint(this), null));
        throw e;
      }
      const noop = h1 != null && h1 === stateHash(this) && !(res && res.error);
      emit(actEvent(this, name, args, res, before, fingerprint(this), noop));
      return res;
    };
  }

  // -- match-level actions (act PlayerState is the first argument) --------------------------------------
  // a card or an autoplay toggle can act entirely outside the seat's visible state, so no noop verdict there
  const NOOP_TRACKED = (name) => name !== 'pickCard' && name !== 'setAutoplay';
  for (const name of MATCH_ACTIONS) {
    if (typeof Match.prototype[name] !== 'function') { missing.push(`Match.${name}`); continue; }
    const orig = Match.prototype[name];
    Match.prototype[name] = function (ps, ...rest) {
      const before = ps ? fingerprint(ps) : null;
      const h1 = ps && NOOP_TRACKED(name) ? stateHash(ps) : null;
      const res = orig.apply(this, [ps, ...rest]);
      if (ps && ps.playerId) {
        const noop = h1 != null && h1 === stateHash(ps) && !(res && res.error) ? true : null;
        emit(actEvent(ps, name, rest, res, before, fingerprint(ps), noop));
      }
      return res;
    };
  }

  // -- lifecycle --------------------------------------------------------------------------------------
  for (const [name, build] of [
    ['startRound', (m) => [roundEvent(m), m.round === 1 ? startEvent(m) : null]],
    ['enterPrep', (m) => prepEvents(m)],
    ['_finishCombat', (m) => [combatEvent(m)]],
  ]) {
    if (typeof Match.prototype[name] !== 'function') { missing.push(`Match.${name}`); continue; }
    const orig = Match.prototype[name];
    Match.prototype[name] = function (...args) {
      const res = orig.apply(this, args);
      try { for (const ev of build(this) || []) if (ev) emit(ev); } catch (e) { log.warn(`record ${name} failed`, e?.message || e); }
      return res;
    };
  }

  // settle needs the pre-charge LP; finish marks the end.
  if (typeof Match.prototype.settle !== 'function') {
    missing.push('Match.settle');
  } else {
    const origSettle = Match.prototype.settle;
    Match.prototype.settle = function (...args) {
      const before = new Map();
      for (const ps of this.players?.values?.() || []) before.set(ps.playerId, { lp: ps.lp, leaks: ps.stats?.leaks ?? 0 });
      const res = origSettle.apply(this, args);
      try { emit(settleEvent(this, before)); } catch (e) { log.warn('record settle failed', e?.message || e); }
      return res;
    };
  }
  if (typeof Match.prototype.finish !== 'function') {
    missing.push('Match.finish');
  } else {
    const origFinish = Match.prototype.finish;
    Match.prototype.finish = function (...args) {
      const res = origFinish.apply(this, args);
      try { emit(endEvent(this)); } catch (e) { log.warn('record finish failed', e?.message || e); }
      return res;
    };
  }

  return missing;
}

// ---- event builders ----------------------------------------------------------------------------------

function actEvent(ps, fn, args, res, before, after, noop) {
  const ok = !(res && typeof res === 'object' && res.error);
  const ev = {
    k: 'act',
    t: nowIso(),
    round: ps.m?.round ?? null,
    phase: ps.m?.phase ?? null,
    seat: ps.playerId,
    ai: !!ps.isBot,
    controlled: !!ps.botControlled, // true once a human toggled AI 托管: `ai` is then misleading
    fn,
    args: jsonSafe(args),
    ok: !!ok,
    before,
    after,
  };
  if (noop !== null && noop !== undefined) ev.noop = !!noop;
  if (!ok) { ev.err = res.error; if (res.detail) ev.detail = res.detail; }
  if (!ps.isBot) ev.snap = safeView(ps);
  return ev;
}

function roundEvent(m) {
  return {
    k: 'round',
    t: nowIso(),
    round: m.round,
    stageId: m.stageId ?? null,
    factions: Array.from(m.factions || []),
    wave: waveBrief(m),
    seats: seatBriefs(m),
  };
}

function startEvent(m) {
  return {
    k: 'start',
    t: nowIso(),
    round: m.round,
    mode: m.mode ?? null,
    difficulty: m.difficulty ?? null,
    // the match's master seed and its battleId prefix: without them a recorded run cannot be replayed headlessly
    // (Match.js sets this.seed from the lobby's seedFn; battlePrefix is `<seed36>[-<matchNo36>]`). Old logs lack them.
    seed: (Number(m.seed) >>> 0) || null,
    battleId: m.battlePrefix ?? null,
    stageId: m.stageId ?? null,
    factions: Array.from(m.factions || []),
    bossRound: m.gd?.bossRound ?? null,
    hiddenRound: m.gd?.hiddenRound ?? null,
    schedule: scheduleBrief(m),
  };
}

function prepEvents(m) {
  const out = [];
  for (const ps of m.players?.values?.() || []) {
    if (ps.isBot || ps.spectator || !ps.alive) continue;
    out.push({ k: 'prep', t: nowIso(), round: m.round, seat: ps.playerId, brief: seatBrief(ps), snap: safeView(ps) });
  }
  return out;
}

function combatEvent(m) {
  const seats = [];
  for (const [pid, r] of m.lastResults || []) {
    if (!r) continue;
    seats.push({
      seat: pid,
      killed: r.killed ?? null,
      total: r.total ?? null,
      leaks: (r.leaked || []).filter((l) => l && l.counted !== false).length,
      perfect: r.perfect !== false,
    });
  }
  return { k: 'combat', t: nowIso(), round: m.round, seats };
}

function settleEvent(m, before) {
  const seats = [];
  for (const ps of m.players?.values?.() || []) {
    const b = before.get(ps.playerId) || { lp: ps.lp, leaks: ps.stats?.leaks ?? 0 };
    const leaks = (ps.stats?.leaks ?? 0) - b.leaks;
    seats.push({
      seat: ps.playerId,
      lpBefore: b.lp,
      lpAfter: ps.lp,
      damage: b.lp - ps.lp,
      leaks,
      eliminated: !ps.alive,
    });
  }
  return { k: 'settle', t: nowIso(), round: m.round, seats };
}

function endEvent(m) {
  return { k: 'end', t: nowIso(), round: m.round, victory: !!m.victory, outcome: jsonSafe(m.outcome ?? null), seats: seatBriefs(m) };
}

// ---- small helpers -----------------------------------------------------------------------------------

function seed(ps) {
  return {
    seat: ps.playerId,
    ai: !!ps.isBot,
    controlled: !!ps.botControlled,
    alive: !!ps.alive,
    lp: ps.lp,
    funds: ps.funds,
    level: ps.shop?.level ?? null,
    handN: ps.hand ? ps.hand.filter(Boolean).length : 0,
    boardN: ps.deployCount ?? 0,
    bandId: ps.bandId ?? null,
  };
}

function seatBrief(ps) {
  const s = seed(ps);
  s.bonds = bondsBrief(ps);
  return s;
}

function seatBriefs(m) {
  const out = [];
  for (const ps of m.players?.values?.() || []) out.push(seatBrief(ps));
  return out;
}

function bondsBrief(ps) {
  const out = [];
  let view;
  try { view = ps.bondsView ? ps.bondsView() : ps.bonds; } catch { view = null; }
  for (const [id, b] of Object.entries(view || {})) {
    if (!b || !((b.count > 0) || (b.layers > 0) || b.active)) continue;
    out.push({ id, count: b.count ?? 0, tier: b.tier ?? 0, layers: b.layers ?? 0, active: !!b.active });
  }
  return out;
}

function waveBrief(m) {
  if (Array.isArray(m.bossWaves) && m.bossWaves.length) {
    return { boss: true, groups: m.bossWaves.map((g) => ({ players: g.players, spawns: spawnsBrief(g.wave) })) };
  }
  const w = m.wave;
  if (!w) return null;
  const p = w.pick || {};
  return {
    boss: false,
    templateId: w.templateId ?? null,
    timeLimit: w.timeLimit ?? null,
    pick: { round: p.round ?? null, type: p.type ?? null, key: p.key ?? null, normal: p.normal ?? null, elite: p.elite ?? null },
    spawns: spawnsBrief(w),
  };
}

function spawnsBrief(w) {
  return (w?.spawns || []).map((s) => ({
    t: s.time,
    enemyKey: s.enemyKey,
    count: s.count,
    gate: s.preview?.gate ?? null,
    elite: !!s.preview?.elite,
    boss: !!s.preview?.boss,
    tag: s.tag ?? null,
  }));
}

function scheduleBrief(m) {
  const sc = m.factions && m.factions.schedule;
  if (!sc || typeof sc !== 'object') return null;
  return { typeSlots: jsonSafe(sc.typeSlots ?? null), picks: jsonSafe(sc.picks ?? null) };
}

/** A small readable summary of a seat, for the log. */
function fingerprint(ps) {
  const shop = Array.isArray(ps.shop?.slots)
    ? ps.shop.slots.map((s) => (s ? `${s.id}${s.sold ? '!' : ''}` : '-')).join(',')
    : '';
  return {
    funds: ps.funds,
    level: ps.shop?.level ?? null,
    lp: ps.lp,
    handN: ps.hand ? ps.hand.filter(Boolean).length : 0,
    boardN: ps.deployCount ?? 0,
    shop,
  };
}

/**
 * The full player-visible state as one string: hand (uid+id), board (tile+uid+id+facing+items), shop, funds, level,
 * LP, ready, frozen, band. Two equal hashes ⇒ the action changed nothing the player can feel — the `noop` verdict
 * (a light fingerprint is not enough: a `move` to another tile, an `equip`, a `setReady` all leave counts unchanged).
 */
function stateHash(ps) {
  try {
    const hand = (ps.hand || []).map((p) => (p ? `${p.uid}:${p.id}` : '-')).join(',');
    const board = [...(ps.board?.entries?.() || [])]
      .map(([k, p]) => `${k}:${p.uid}:${p.id}:${p.dir ?? ''}:${(p.items || []).map((i) => i.uid).join('+')}`)
      .sort()
      .join(',');
    const shop = Array.isArray(ps.shop?.slots)
      ? ps.shop.slots.map((s) => (s ? `${s.id}${s.sold ? '!' : ''}` : '-')).join(',')
      : '';
    return [ps.funds, ps.shop?.level, ps.lp, ps.ready ? 1 : 0, ps.shop?.frozen ? 1 : 0, ps.bandId ?? '', hand, board, shop].join('|');
  } catch {
    return null;
  }
}

function safeView(ps) {
  try { return ps.privateView(); } catch { return null; }
}

/** JSON-safe copy for the log; anything unserializable degrades to a string, never throws. */
function jsonSafe(v) {
  try {
    JSON.stringify(v);
    return v;
  } catch {
    try { return String(v); } catch { return null; }
  }
}

function nowIso() {
  return new Date().toISOString();
}

/** The raw human intents (thin): covers intents with no PlayerState verb, plus validation/quota rejects. */
function recordIntent(state, log, match, playerId, msg, res) {
  if (!state.record) return;
  // 录制也只记开了 Luck 的对局：没勾选的对局连一行日志都不写
  if (!(match && match.experimental && match.experimental.luckConsole === true)) return;
  if (!msg || typeof msg.t !== 'string' || !msg.t.startsWith('g.')) return;
  const ps = match.players?.get(playerId);
  if (!ps || ps.isBot) return; // bots never go through handle; only humans are logged here
  const { t, ...payload } = msg;
  const ev = {
    k: 'intent',
    t: nowIso(),
    round: match.round ?? null,
    phase: match.phase ?? null,
    seat: playerId,
    type: t,
    msg: jsonSafe(payload),
    ok: !(res && res.error),
  };
  if (res && res.error) { ev.err = res.error; if (res.detail) ev.detail = res.detail; }
  emitEvent(state, log, ev);
}

/** One line per auto batch: what the loop was asked for and what it got done (never the individual cycles). */
function autoEvent(ps, a) {
  return {
    k: 'auto',
    t: nowIso(),
    round: ps?.m?.round ?? null,
    seat: ps?.playerId ?? null,
    cardIds: a.cardIds,
    cycles: a.cycles,
    equipCoins: !!a.equipCoins,
    idCard: !!a.idCard,
    bought: a.bought,
    done: a.done,
    gold: a.gold,
    layers: a.layers,
    stop: a.stop,
  };
}

function emitEvent(state, log, ev) {
  if (!state.record || !state.logFile) return;
  let line;
  try {
    line = JSON.stringify(ev);
  } catch (e) {
    line = JSON.stringify({ k: (ev && ev.k) || 'event', t: nowIso(), stringifyError: String(e?.message || e) });
  }
  try {
    fs.appendFileSync(state.logFile, `${line}\n`);
  } catch (e) {
    log.warn('record write failed', e?.message || e);
  }
}

function openLog(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(dir, `session-${stamp}.jsonl`);
}
