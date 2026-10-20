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
//   prepUnlimited           无限休整期 (玩法#05): the prep has no countdown; a co-op room enters combat only once every
//                           living player is ready (off by default: the official timed prep stays the default)
// The strategy draft's 本局信息 dialog and the briefing share the official enemy column (ui/matchEnemies.js, GitHub #484),
// so there is no room switch for it any more.
export const EXPERIMENTAL_OPTIONAL = Object.freeze(['luckConsole', 'bossHitSoftCap', 'prepUnlimited']);
export const EXPERIMENTAL_OPTIONAL_DEFAULTS = Object.freeze({ luckConsole: false, bossHitSoftCap: false, prepUnlimited: false });
const OPTIONAL_TAGS = Object.freeze({ luckConsole: 'luck', bossHitSoftCap: 'cap', prepUnlimited: 'prep' });

/** The switch's value as the game reads it: the stored boolean, or the option's own default when absent. */
export function optionalValue(value, key) {
  const stored = Object.getOwnPropertyDescriptor(value ?? {}, key)?.value;
  return typeof stored === 'boolean' ? stored : EXPERIMENTAL_OPTIONAL_DEFAULTS[key] === true;
}
const optionalOn = (value, key) => optionalValue(value, key);

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
  // two rules + optional capacity + optional duck lord + the optional switches + the stage list
  if (keys.length < 2 || keys.length > 5 + EXPERIMENTAL_OPTIONAL.length) return false;
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
    return key === 'playerCapacity' ? isPlayerCapacity(descriptor.value)
      : key === 'bannedStages' ? Array.isArray(descriptor.value) && descriptor.value.length <= MAX_BANNED_STAGES
        && descriptor.value.every((id) => typeof id === 'string' && STAGE_ID.test(id))
      : key === 'disableDuckLord' && typeof descriptor.value === 'boolean';
  });
}

/** @param {{ revivalEnabled: boolean, disableSharedPool: boolean, playerCapacity?: number, disableDuckLord?: boolean, luckConsole?: boolean, bossHitSoftCap?: boolean, prepUnlimited?: boolean, bannedStages?: string[] }} [value] */
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
  && bannedStages(a).join(',') === bannedStages(b).join(',');
