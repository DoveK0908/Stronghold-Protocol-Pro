// Room-owned experimental rules are snapshotted at launch, never player votes.
import { MAX_SEATS } from './constants.js';
import { isPlayerCapacity, roomCapacity } from './playerCapacity.js';

export const EXPERIMENTAL_DEFAULTS = Object.freeze({ revivalEnabled: false, disableSharedPool: false });

// Optional rules with their own defaults: a room that never mentions one keeps the ordinary two-flag wire shape
// (legacy DTOs, matchmaking offers and stored rooms are unaffected). Mostly presentation/runtime switches, plus one
// combat rule the owner asked to keep explicit:
//   luckConsole             the Luck test console stays dormant unless the room asked for it (off by default)
//   bossHitSoftCap          限伤 caps a boss hit at BOSS_HIT_LIMIT − 1 (299999) instead of cancelling it (项目 5,
//                           off by default: the official rule stays the default)
//   bossQuota               防治倒转区: per-player boss pool quota and completion ranking (off by default)
//   stateCarry              联防状态继承: enemy HP/phase and withdrawn allies' remaining redeployment time carry
//                           within one round's normal/unite/relay battles; waiting freezes timers (off by default).
//                           Allied HP/SP/skills still follow the official reset rules; never carries into bosses.
//   prepUnlimited           无限休整期 (玩法#04): the prep counts down to zero without forcing readiness; combat starts
//                           once every living player is ready (off by default: the official timed prep stays the default)
//   benchExpand             整备区扩容: the hand keeps 13 pieces instead of 10 — the three dead ground-forbidden cells
//                           left of the 临时整备区 (row 8, cols 0..2) become 整备区 slots (owner's request, 2026-10-25;
//                           off by default: the official ten-slot bench stays the default)
//   shopLeft                牌库剩余张数: the shop card's 「剩余 N 张」 badge (m.private.shop.slots[].left). On by default —
//                           the badge has shipped since 0.3.1, so the switch only lets a room hide it
//   speedVote               二倍速: the in-match 二倍速 vote button in the top bar (server/match/match/speedVote.js). On by
//                           default, same reason: the vote shipped before the switch existed (owner's request, 2026-10-26)
//   goldPreview             查看下回合资金: m.private.nextGold — the income the next round start credits, plus what carries
//                           over right now (off by default: it is new information the official HUD never shows). A
//                           prediction only: an onIncome handler (老鲤 withholds R1–R2) can still rewrite the real credit,
//                           and battle rewards arriving later in this prep add to the carried part.
// The strategy draft's 本局信息 dialog and the briefing share the official enemy column (ui/matchEnemies.js, GitHub #484),
// so there is no room switch for it any more.
export const EXPERIMENTAL_OPTIONAL = Object.freeze([
  'luckConsole', 'bossHitSoftCap', 'prepUnlimited', 'benchExpand', 'shopLeft', 'speedVote', 'goldPreview', 'bossQuota', 'stateCarry',
]);
// Numeric optional rules: same wire rule as the switches (only a value that differs from the rule's own default rides
// the wire), but the value is a bounded integer instead of a boolean.
//   bossHpPercent          首领血量: scales the shared leader pool of the 最终攻势 / 隐秘核心 (finalAssault.bossPoolHp)
//                          — 100 is the official HP. Room-owned like the rest: both the server pool and every client
//                          field's `boss.poolMax` come from the one SharedBossPool, so the scouted / client-run fields
//                          read the same number. Owner's request, 2026-10-28.
export const EXPERIMENTAL_NUMERIC = Object.freeze({
  bossHpPercent: Object.freeze({ def: 100, min: 25, step: 5 }),
});
const NUMERIC_KEYS = Object.freeze(Object.keys(EXPERIMENTAL_NUMERIC));
export const EXPERIMENTAL_OPTIONAL_DEFAULTS = Object.freeze({
  luckConsole: false, bossHitSoftCap: false, prepUnlimited: false, benchExpand: false,
  shopLeft: true, speedVote: true, goldPreview: false, bossQuota: false, stateCarry: false,
});
const OPTIONAL_TAGS = Object.freeze({
  luckConsole: 'luck', bossHitSoftCap: 'cap', prepUnlimited: 'prep', benchExpand: 'bench',
  shopLeft: 'shop', speedVote: 'speed', goldPreview: 'gold', bossQuota: 'quota', stateCarry: 'carry',
});

/** The switch's value as the game reads it: the stored boolean, or the option's own default when absent. */
export function optionalValue(value, key) {
  const stored = Object.getOwnPropertyDescriptor(value ?? {}, key)?.value;
  return typeof stored === 'boolean' ? stored : EXPERIMENTAL_OPTIONAL_DEFAULTS[key] === true;
}
const optionalOn = (value, key) => optionalValue(value, key);

/** A numeric rule's integer as the game reads it: the stored in-range integer, or the rule's own default. */
export function numericValue(value, key) {
  const spec = EXPERIMENTAL_NUMERIC[key];
  const stored = Object.getOwnPropertyDescriptor(value ?? {}, key)?.value;
  return isNumericOption(key, stored) ? stored : spec.def;
}
/** The wire rule of a numeric option: a whole number inside the rule's range and on its step, nothing else. */
const isNumericOption = (key, v) => {
  const spec = EXPERIMENTAL_NUMERIC[key];
  return !!spec && typeof v === 'number' && Number.isSafeInteger(v)
    && v >= spec.min && v % spec.step === 0;
};

/** 地图禁用 (玩法#03): the stage ids a room never draws, sorted and de-duplicated; nothing else rides the wire. */
export const MAX_BANNED_STAGES = 16;
const STAGE_ID = /^[A-Za-z0-9_]{1,64}$/;
export function bannedStages(value) {
  const raw = value && Array.isArray(value.bannedStages) ? value.bannedStages : [];
  return [...new Set(raw.filter((id) => typeof id === 'string' && STAGE_ID.test(id)))].sort().slice(0, MAX_BANNED_STAGES);
}

export function isExperimental(value) {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(value);
  // two rules + optional capacity + optional duck lord + the optional switches + the numeric rules + the stage list
  if (keys.length < 2 || keys.length > 5 + EXPERIMENTAL_OPTIONAL.length + NUMERIC_KEYS.length) return false;
  for (const key of Object.keys(EXPERIMENTAL_DEFAULTS)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true || typeof descriptor.value !== 'boolean') return false;
  }
  return keys.every(key => {
    if (Object.hasOwn(EXPERIMENTAL_DEFAULTS, key)) return true;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true) return false;
    // Reflect.ownKeys also yields symbols; the optional switches are named by strings only.
    if (typeof key === 'string' && EXPERIMENTAL_OPTIONAL.includes(key)) return typeof descriptor.value === 'boolean';
    if (typeof key === 'string' && NUMERIC_KEYS.includes(key)) return isNumericOption(key, descriptor.value);
    return key === 'playerCapacity' ? isPlayerCapacity(descriptor.value)
      : key === 'bannedStages' ? Array.isArray(descriptor.value) && descriptor.value.length <= MAX_BANNED_STAGES
        && descriptor.value.every((id) => typeof id === 'string' && STAGE_ID.test(id))
      : key === 'disableDuckLord' && typeof descriptor.value === 'boolean';
  });
}

/** @param {{ revivalEnabled: boolean, disableSharedPool: boolean, playerCapacity?: number, disableDuckLord?: boolean, luckConsole?: boolean, bossHitSoftCap?: boolean, prepUnlimited?: boolean, benchExpand?: boolean, shopLeft?: boolean, speedVote?: boolean, goldPreview?: boolean, bossQuota?: boolean, stateCarry?: boolean, bannedStages?: string[] }} [value] */
export function experimentalOptions(value = EXPERIMENTAL_DEFAULTS) {
  if (!isExperimental(value)) throw new TypeError('invalid experimental options');
  const capacity = roomCapacity('coop', value);
  const banned = bannedStages(value);
  return Object.freeze({ revivalEnabled: value.revivalEnabled, disableSharedPool: value.disableSharedPool,
    ...(capacity === MAX_SEATS ? {} : { playerCapacity: capacity }),
    // Optional and false by default: ordinary rooms and legacy DTOs keep their two-flag shape.
    ...(capacity > MAX_SEATS && value.disableDuckLord === true ? { disableDuckLord: true } : {}),
    // Only switches that differ from their own default ride the wire: an ordinary room keeps its two-flag shape.
    ...EXPERIMENTAL_OPTIONAL.reduce((out, key) => {
      const next = optionalValue(value, key);
      if (next !== EXPERIMENTAL_OPTIONAL_DEFAULTS[key]) out[key] = next;
      return out;
    }, {}),
    ...NUMERIC_KEYS.reduce((out, key) => {
      const next = numericValue(value, key);
      if (next !== EXPERIMENTAL_NUMERIC[key].def) out[key] = next;
      return out;
    }, {}),
    ...(banned.length ? { bannedStages: Object.freeze(banned) } : {}) });
}

const duckLordDisabled = value => roomCapacity('coop', value) > MAX_SEATS && value.disableDuckLord === true;
export const experimentalKey = value => {
  let key = `${value.revivalEnabled ? 1 : 0}${value.disableSharedPool ? 1 : 0}`;
  const capacity = roomCapacity('coop', value);
  if (capacity !== MAX_SEATS) key += `:${capacity}`;
  if (duckLordDisabled(value)) key += ':duck';
  for (const name of EXPERIMENTAL_OPTIONAL) {
    const on = optionalValue(value, name);
    if (on !== EXPERIMENTAL_OPTIONAL_DEFAULTS[name]) key += `:${on ? '' : 'no'}${OPTIONAL_TAGS[name]}`;
  }
  for (const name of NUMERIC_KEYS) {
    const n = numericValue(value, name);
    if (n !== EXPERIMENTAL_NUMERIC[name].def) key += `:${name}=${n}`;
  }
  const banned = bannedStages(value);
  if (banned.length) key += `:ban=${banned.join(',')}`;
  return key;
};
export const sameExperimental = (a, b) => !!a && !!b
  && a.revivalEnabled === b.revivalEnabled && a.disableSharedPool === b.disableSharedPool
  && roomCapacity('coop', a) === roomCapacity('coop', b)
  && duckLordDisabled(a) === duckLordDisabled(b)
  // A switch this comparison forgets is silently dropped by room.setExperimental (server/lobby.js:1185), so
  // compare the optional ones explicitly rather than by object identity.
  && EXPERIMENTAL_OPTIONAL.every(key => optionalOn(a, key) === optionalOn(b, key))
  && NUMERIC_KEYS.every(key => numericValue(a, key) === numericValue(b, key))
  && bannedStages(a).join(',') === bannedStages(b).join(',');
