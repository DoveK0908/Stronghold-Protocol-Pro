// 开房默认 (the owner, 2026-10-25: 「我还想给所有的实验性选项加一个个人的小开关，当这个人开房的时候，可以选择是否默认
// 开启这个实验性选项」): every room rule the 实验性选项 panel offers is also a personal default. The panel stays the
// authority inside a room (the host still flips 队友复活 / 禁用共享卡池 / each optional switch there); these defaults only
// decide what a room the player creates starts with, so a host who always plays with 整备区扩容 does not re-open the
// panel every room.
// Kept on this device (`sp.pref.roomDefaults`), not in the synced keys of ui/accountPrefs.js: they describe the rooms
// this browser opens. Stored as an object of booleans; anything else reads as the standard room (all off).
// 扩展同盟人数 / 地图禁用 are not here: both are room-by-room decisions (a seat count, a stage list), not a default a
// host should carry silently — 扩展同盟人数 also changes what the waiting room shows other players.
import { createStore, loadPref, savePref } from '../store.js';
import { EXPERIMENTAL_OPTIONAL, EXPERIMENTAL_OPTIONAL_DEFAULTS } from '../../../shared/experimental.js';

/** The switches a personal default covers: the two base rules first, then every optional one (in panel order). */
export const ROOM_DEFAULT_KEYS = Object.freeze(['revivalEnabled', 'disableSharedPool', ...EXPERIMENTAL_OPTIONAL]);

const STORE_KEY = 'roomDefaults';
const NONE = Object.freeze(Object.fromEntries(ROOM_DEFAULT_KEYS.map((k) => [k, false])));

/** A stored value → every switch as a boolean (anything that is not `true` is off). */
export function sanitizeRoomDefaults(v) {
  const out = { ...NONE };
  if (!v || typeof v !== 'object') return out;
  for (const k of ROOM_DEFAULT_KEYS) out[k] = v[k] === true;
  return out;
}

/** The player's defaults, read from localStorage. */
export function readRoomDefaults() {
  return sanitizeRoomDefaults(loadPref(STORE_KEY, null));
}

/** Whether these defaults are the standard room's (all off) — an ordinary room then carries no `experimental` at all. */
export function roomDefaultsAreDefault(value) {
  const v = sanitizeRoomDefaults(value);
  return ROOM_DEFAULT_KEYS.every((k) => v[k] === false);
}

/**
 * The `experimental` payload a room the player creates starts with: the two base flags always (the server requires
 * both booleans), and each optional switch only when the default turns it on — the same wire shape the panel produces.
 * `undefined` when every switch is off, so an ordinary room sends nothing.
 */
export function roomDefaultsExperimental(value) {
  const v = sanitizeRoomDefaults(value);
  if (roomDefaultsAreDefault(v)) return undefined;
  const out = { revivalEnabled: v.revivalEnabled === true, disableSharedPool: v.disableSharedPool === true };
  for (const k of EXPERIMENTAL_OPTIONAL) {
    if (v[k] !== EXPERIMENTAL_OPTIONAL_DEFAULTS[k]) out[k] = v[k];
  }
  return out;
}

/** The live defaults (settings writes here; the lobby reads it when it creates a room). */
export const roomDefaultsStore = createStore(readRoomDefaults());

/** Turn one default on or off, store it, and tell the subscribers. */
export function setRoomDefault(key, on) {
  if (!ROOM_DEFAULT_KEYS.includes(key)) return;
  const next = { ...roomDefaultsStore.get(), [key]: on === true };
  roomDefaultsStore.set(next);
  savePref(STORE_KEY, next);
}

/** Back to the standard room (the section's 重置). */
export function resetRoomDefaults() {
  const next = { ...NONE };
  roomDefaultsStore.set(next);
  savePref(STORE_KEY, next);
}
