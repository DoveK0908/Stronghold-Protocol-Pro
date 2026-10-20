// test/lobby-seat-move.test.js — 界面#15: a seated human moves to an empty seat before the match
// (room.moveSeat {seat}); expanded rooms of 8–20 seats group four at a time, so the seat is the group.
// Covers the protocol, the happy path (host and guest, room.state follows, un-readying everyone else),
// and the refusals (not seated, taken seat, outside capacity, after the match started, solo rooms).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { getData } from '../server/data.js';
import { ERR, MATCHMAKING_VERSION } from '../shared/constants.js';
import { PLAYER_CAPACITY_VERSION } from '../shared/playerCapacity.js';
import { validateC2S } from '../shared/protocol.js';

const DATA = getData({ log: { warn() {}, error() {}, info() {} } });
const CAP8 = { revivalEnabled: false, disableSharedPool: false, playerCapacity: 8 };

class RecordingMatch {
  constructor(opts) { this.opts = opts; }
  start() {}
  dispose() {}
  onLeave() {}
  onDisconnect() {}
  onReconnect() {}
  end() { this.opts.onEnd({}); }
}

function fixture(t) {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, MatchClass: RecordingMatch, getData: () => DATA, seedFn: () => 17 });
  t.after(() => lobby.shutdown());
  let count = 0;
  const player = () => {
    const s = registry.create(`Seat${++count}`); s.connected = true; s.messages = [];
    s.matchmakingVersion = MATCHMAKING_VERSION; s.playerCapacityVersion = PLAYER_CAPACITY_VERSION;
    s.ws = { readyState: 1, bufferedAmount: 0, send(raw, cb) { s.messages.push(JSON.parse(raw)); cb?.(); } };
    return s;
  };
  const lastState = (s) => s.messages.filter((m) => m.t === 'room.state').at(-1);
  return { lobby, player, lastState };
}

const move = (f, s, seat) => f.lobby.onMessage(s, { t: 'room.moveSeat', seat });

test('protocol: room.moveSeat takes a seat inside the capacity', () => {
  assert.equal(validateC2S({ t: 'room.moveSeat', seat: 0 }), null);
  assert.equal(validateC2S({ t: 'room.moveSeat', seat: 19 }), null);
  for (const msg of [{ seat: -1 }, { seat: 20 }, { seat: 1.5 }, { seat: '1' }, {}]) {
    assert.notEqual(validateC2S({ t: 'room.moveSeat', ...msg }), null, JSON.stringify(msg));
  }
});

test('a guest moves to an empty seat: room.state follows, their ready flag and the others reset', (t) => {
  const f = fixture(t), host = f.player(), guest = f.player(), other = f.player();
  assert.deepEqual(f.lobby.create(host, { mode: 'coop', difficulty: 'NORMAL', experimental: CAP8 }), { ok: true });
  const room = f.lobby.roomOf(host);
  assert.deepEqual(f.lobby.join(guest, { code: room.code }), { ok: true });
  assert.deepEqual(f.lobby.join(other, { code: room.code }), { ok: true });
  guest.ready = true; room.seats[1].ready = true;
  other.ready = true; room.seats[2].ready = true;
  assert.deepEqual(move(f, guest, 5), { ok: true });
  let st = f.lastState(host);
  assert.equal(st.seats[5].playerId, guest.playerId);
  assert.equal(st.seats[5].seat, 5);
  assert.equal(st.seats[1], null);
  assert.equal(st.seats[5].ready, false, 'the mover has to ready up again');
  assert.equal(st.seats[2].ready, false, 'every other human is un-readied');
  assert.equal(room.seats[1], null, 'the old seat is free');
});

test('the host may move too, and moving to the seat you are in is a no-op', (t) => {
  const f = fixture(t), host = f.player();
  f.lobby.create(host, { mode: 'coop', difficulty: 'NORMAL', experimental: CAP8 });
  const room = f.lobby.roomOf(host);
  const before = JSON.stringify(room.toState());
  assert.deepEqual(move(f, host, 0), { ok: true });
  assert.equal(JSON.stringify(room.toState()), before, 'same seat changes nothing, not even a broadcast');
  assert.deepEqual(move(f, host, 6), { ok: true });
  assert.equal(room.seats[6].playerId, host.playerId);
  assert.equal(room.hostId, host.playerId, 'the host id is a player, not a seat');
});

test('refusals: not seated, a taken seat, outside the capacity, a solo room, after the match started', (t) => {
  const f = fixture(t), host = f.player(), guest = f.player(), outsider = f.player();
  f.lobby.create(host, { mode: 'coop', difficulty: 'NORMAL', experimental: CAP8 });
  const room = f.lobby.roomOf(host);
  f.lobby.join(guest, { code: room.code });
  assert.equal(move(f, outsider, 3).error, ERR.NOT_IN_ROOM);
  assert.deepEqual(move(f, guest, 0), { error: ERR.BAD_TARGET, detail: 'seat is taken' });
  assert.equal(move(f, guest, 8).error, ERR.BAD_TARGET, 'outside the room capacity');
  assert.equal(move(f, guest, -1).error, ERR.BAD_TARGET);

  const solo = f.player();
  f.lobby.create(solo, { mode: 'solo', difficulty: 'NORMAL' });
  assert.equal(move(f, solo, 0).error, ERR.BAD_TARGET, 'a solo room has one seat');

  room.match = {}; // the room is in a match (starting one needs a ready table and content, not this test's point)
  assert.equal(move(f, guest, 3).error, ERR.ROOM_STARTED);
});
