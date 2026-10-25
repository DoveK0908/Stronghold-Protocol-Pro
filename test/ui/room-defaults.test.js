// 开房默认 (the owner, 2026-10-25): every 实验性选项 switch also has a personal default, and a room the player creates
// starts with it. The rules the panel edits inside a room are unchanged; these defaults only decide the opening shape,
// and an all-off set must keep sending no rules at all (an ordinary room's wire shape).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROOM_DEFAULT_KEYS, sanitizeRoomDefaults, roomDefaultsAreDefault, roomDefaultsExperimental,
  readRoomDefaults, setRoomDefault, resetRoomDefaults, roomDefaultsStore,
} from '../../public/js/ui/roomDefaults.js';
import { EXPERIMENTAL_OPTIONAL, EXPERIMENTAL_OPTIONAL_DEFAULTS } from '../../shared/experimental.js';

/** A localStorage stand-in the store helper can write to (store.js only needs getItem/setItem). */
function fakeStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  return map;
}

beforeEach(() => { fakeStorage(); resetRoomDefaults(); });

test('the keys: the two base rules first, then every optional switch', () => {
  assert.deepEqual([...ROOM_DEFAULT_KEYS], ['revivalEnabled', 'disableSharedPool', ...EXPERIMENTAL_OPTIONAL]);
  assert.ok(ROOM_DEFAULT_KEYS.includes('benchExpand'), '整备区扩容 is one of them');
});

test('sanitize: anything that is not true is off, and a broken value reads as the standard room', () => {
  const none = sanitizeRoomDefaults(null);
  for (const k of ROOM_DEFAULT_KEYS) assert.equal(none[k], false);
  assert.deepEqual(sanitizeRoomDefaults('nonsense'), none);
  assert.deepEqual(sanitizeRoomDefaults({ benchExpand: 'yes' }), none);
  const one = sanitizeRoomDefaults({ benchExpand: true });
  assert.equal(one.benchExpand, true);
  assert.equal(one.luckConsole, false);
});

test('an all-off set is the standard room and sends nothing', () => {
  assert.equal(roomDefaultsAreDefault({}), true);
  assert.equal(roomDefaultsExperimental({}), undefined, 'the room.create call carries no experimental field');
  assert.equal(roomDefaultsExperimental(null), undefined);
});

test('an enabled default becomes the room payload, in the panel wire shape', () => {
  const rules = roomDefaultsExperimental({ benchExpand: true, prepUnlimited: true });
  assert.deepEqual(rules, { revivalEnabled: false, disableSharedPool: false, benchExpand: true, prepUnlimited: true });
  assert.equal(roomDefaultsAreDefault({ benchExpand: true }), false);
  // every optional switch rides only when it differs from its own default (all of them default to off today)
  for (const key of EXPERIMENTAL_OPTIONAL) assert.equal(EXPERIMENTAL_OPTIONAL_DEFAULTS[key], false, key);
});

test('setting a default stores it on this device and the store notifies', () => {
  const seen = [];
  const off = roomDefaultsStore.subscribe((s) => seen.push({ ...s }));
  setRoomDefault('benchExpand', true);
  assert.equal(readRoomDefaults().benchExpand, true, 'read back from sp.pref.roomDefaults');
  assert.equal(roomDefaultsStore.get().benchExpand, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].benchExpand, true);
  off();
  setRoomDefault('notAKey', true);
  assert.equal(roomDefaultsStore.get().notAKey, undefined, 'an unknown key is ignored');
  resetRoomDefaults();
  assert.equal(roomDefaultsAreDefault(readRoomDefaults()), true);
});
