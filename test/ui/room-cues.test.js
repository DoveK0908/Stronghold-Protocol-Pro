// 项目 6 房间音效 (2026-10-16): the pure transition logic behind the room's 准备 / 开始 / 玩家加入 / 退出 cues
// (public/js/ui/roomCues.js). The hook that plays them is a one-liner over this function.
import test from 'node:test';
import assert from 'node:assert/strict';
import { roomCues, roomPeople, roomSnapshot } from '../../public/js/ui/roomCues.js';

const seat = (id, o = {}) => ({ playerId: id, name: `P${id}`, seat: 0, ready: false, connected: true, ...o });
const snap = (seats, o = {}) => roomSnapshot({ seats, ...o });

test('房间音效: the first snapshot is silent, a join and a leave are one cue each', () => {
  const a = snap([seat('p1')]);
  assert.deepEqual(roomCues(null, a), []);
  const b = snap([seat('p1'), seat('p2')]);
  assert.deepEqual(roomCues(a, b), ['joinRoom']);
  assert.deepEqual(roomCues(b, snap([seat('p2')])), ['disconnect']);
});

test('房间音效: 准备 sounds on a false → true flip, once per transition, never repeated', () => {
  const a = snap([seat('p1'), seat('p2')]);
  const b = snap([seat('p1', { ready: true }), seat('p2', { ready: true })]);
  assert.deepEqual(roomCues(a, b), ['ready']);                      // a burst of readies is one sound
  assert.deepEqual(roomCues(b, b), []);                             // still ready: nothing
  assert.deepEqual(roomCues(b, snap([seat('p1', { ready: true }), seat('p2')])), []); // un-ready is silent
});

test('房间音效: join / leave / ready keep their fixed order (the 开始 cue lives in screens/game.js)', () => {
  const a = snap([seat('p1', { ready: true }), seat('p2'), seat('p4')]);
  const b = snap([seat('p1', { ready: true }), seat('p2', { ready: true }), seat('p3')], { inMatch: true });
  assert.deepEqual(roomCues(a, b), ['joinRoom', 'disconnect', 'ready']);
  // the same room again: nothing re-fires (no repeated 准备)
  assert.deepEqual(roomCues(b, snap([seat('p1', { ready: true }), seat('p2', { ready: true }), seat('p3')], { inMatch: true })), []);
});

test('房间音效: empty seats, bots, offline players stay out; spectators join and leave like players', () => {
  const empty = snap([]);
  const room = {
    seats: [null, seat('p1', { bot: true }), seat('p2', { connected: false }), seat('p3')],
    spectators: [{ playerId: 's1', name: 'S', connected: true }, { playerId: 's2', name: 'S2', connected: false }],
  };
  const withPeople = snap(room.seats, { spectators: room.spectators });
  assert.deepEqual([...roomPeople(room).keys()], ['p3', 's1']);      // only a connected human + a connected spectator
  assert.deepEqual(roomCues(empty, withPeople), ['joinRoom']);
  assert.deepEqual(roomCues(withPeople, snap([seat('p3')], { spectators: [{ playerId: 's1', connected: false }] })),
    ['disconnect']);                                                 // the spectator went offline
  assert.deepEqual(roomCues(withPeople, withPeople), []);
});

test('房间音效: a disconnected player looks like a leave and a reconnect like a join', () => {
  const on = snap([seat('p1', { ready: true })]);
  const off = snap([seat('p1', { ready: true, connected: false })]);
  assert.deepEqual(roomCues(on, off), ['disconnect']);
  assert.deepEqual(roomCues(off, on), ['joinRoom']);
});
