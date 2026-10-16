// 项目 6 (房间音效, 2026-10-16): the room's cues — 准备 (ready), 玩家加入 (joinRoom) and 退出 (disconnect). The 开始
// (start) cue is not here: the room screen is gone by the time a match begins, so public/js/main.js plays it on the first
// snapshot of a fresh match. The transition logic is a pure function so it can be tested without a browser; the hook only
// remembers the previous snapshot and hands each *new* cue to the audio manager (the first snapshot is always silent).
import { useEffect, useRef } from '../../vendor/hooks.module.js';

/**
 * 项目 6 的总开关（维护者 2026-10-16：「先去掉这些音效，保留这个项目」）⇒ 实现完整留着，但默认不发声。想听回来把这个
 * 常量改成 true 即可：房间的三个音由 useRoomCues 播，`开始` 那个音由 public/js/main.js 的 m.public 处理器播，两处都看它。
 */
export const ROOM_CUES_ENABLED = false;

/**
 * The people a room's state shows: every occupied, connected human and spectator seat — spectators count as players
 * joining and leaving the room (they are never counted for ready / start).
 * @param {any} room room.state
 * @returns {Map<string, boolean>} playerId → ready (spectators always false)
 */
export function roomPeople(room) {
  const out = new Map();
  const seats = Array.isArray(room?.seats) ? room.seats : [];
  const spectators = Array.isArray(room?.spectators) ? room.spectators : [];
  for (const s of seats) {
    if (!s || s.playerId == null || s.connected === false || s.bot || s.isBot) continue;
    out.set(String(s.playerId), s.ready === true);
  }
  for (const s of spectators) {
    if (!s || s.playerId == null || s.connected === false) continue;
    out.set(String(s.playerId), false);
  }
  return out;
}

/** The snapshot the cue logic compares: who is in the room, and who of them is ready. */
export function roomSnapshot(room) {
  return { people: roomPeople(room) };
}

/**
 * The cues a room transitioned into: 'joinRoom' for a player that appeared, 'disconnect' for one that left (or went
 * offline), 'ready' for a player that turned ready. Each cue appears at most once per transition (a four-player ready
 * burst plays one 准备 sound), in that fixed order; a null `prev` is silent.
 * @param {{ people: Map<string, boolean> } | null} prev
 * @param {{ people: Map<string, boolean> }} next
 * @returns {string[]} cue names for audio.sfx (audio.js sfx.ui)
 */
export function roomCues(prev, next) {
  if (!prev || !next) return [];
  let join = false, leave = false, ready = false;
  for (const [id, r] of next.people) {
    if (!prev.people.has(id)) join = true;
    else if (r && !prev.people.get(id)) ready = true;
  }
  for (const id of prev.people.keys()) if (!next.people.has(id)) leave = true;
  const out = [];
  if (join) out.push('joinRoom');
  if (leave) out.push('disconnect');
  if (ready) out.push('ready');
  return out;
}

/**
 * Play the room's cues as its state changes (ignores the first snapshot). Never throws: a missing audio manager or an
 * unknown sound name is the manager's own business (audio.js sfx() ignores unknown names).
 * @param {any} room room.state @param {{ sfx: (name: string) => void } | null} [audio] the audio manager
 */
export function useRoomCues(room, audio) {
  const prev = useRef(null);
  const snap = roomSnapshot(room);
  const key = [...snap.people].map(([id, r]) => `${id}:${r ? 1 : 0}`).join(',');
  useEffect(() => {
    const last = prev.current;
    prev.current = snap;
    if (!last || !audio || !ROOM_CUES_ENABLED) return;
    for (const cue of roomCues(last, snap)) { try { audio.sfx(cue); } catch { /* audio never breaks the room */ } }
    // `key` is the snapshot's identity: the effect re-runs when the people or their ready flags change
  }, [key]);
}
