// room.card (fork lobby, 2026-10-14): a player's display card — portrait and avatar operators, namecard background, self-reported
// trophies — kept on the session, copied to the player's seat and shown to the room (room.state seats[].card); a real
// operator only, rate-limited changes. It rides along into a local match as display-only data on human seats
// (PlayerState.card, maintainer 2026-10-20: the same face in-match as in the room, so teammates see each other's card);
// it never reaches the cluster's match DTO (server/cluster/lobby.js stampMember) and no rule reads it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobby, CARD_CHANGES, CARD_WINDOW_MS } from '../server/lobby.js';
import { ClusterLobby } from '../server/cluster/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { validateC2S, CARD_LIMITS } from '../shared/protocol.js';
import { ERR, MATCHMAKING_VERSION } from '../shared/constants.js';
import { DATA } from './match/harness.js';
import { MANIFEST_SKINS as SKINS } from './helpers/manifestSkins.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const OPS = [...new Set(Object.values(DATA.chess).map((c) => c.charId).filter(Boolean))].sort();
const [AMIYA, OTHER] = OPS;

class StubMatch {
  constructor(opts) { this.opts = opts; }
  start() {}
  dispose() {}
}

function fixture(t, { LobbyClass = Lobby, extra = {}, getData = () => DATA } = {}) {
  const clock = { time: 50_000 };
  const registry = new SessionRegistry({ now: () => clock.time });
  const lobby = new LobbyClass({ registry, MatchClass: StubMatch, getData, log: quiet, now: () => clock.time, ...extra });
  t.after(() => lobby.shutdown());
  let count = 0;
  const player = () => {
    const s = registry.create(`Card${++count}`);
    s.messages = []; s.connected = true; s.matchmakingVersion = MATCHMAKING_VERSION;
    s.ws = { readyState: 1, bufferedAmount: 0, send(raw, cb) { s.messages.push(JSON.parse(raw)); cb?.(); } };
    lobby.onHello(s, { resumed: false, repeat: false });
    return s;
  };
  const states = (s) => s.messages.filter((m) => m.t === 'room.state');
  const card = (s, msg) => lobby.onMessage(s, { t: 'room.card', ...msg });
  return { clock, registry, lobby, player, states, card };
}

test('room.card wire shape: optional charId / avatar / bg ids ("" clears) and an integer trophy count', () => {
  const ok = (msg) => assert.equal(validateC2S({ t: 'room.card', ...msg }), null, JSON.stringify(msg));
  const bad = (msg, field) => assert.equal(validateC2S({ t: 'room.card', ...msg }), `bad field ${field}`, JSON.stringify(msg));
  ok({});
  ok({ charId: '', avatar: '', bg: '', trophies: 0 });
  ok({ charId: 'char_002_amiya', avatar: 'char_017_huang', bg: 'namecard/skin:01-a_b', trophies: CARD_LIMITS.trophies });
  ok({ bg: 'BG_Default' });
  ok({ avatar: 'char_002_amiya' });
  for (const avatar of ['Char_002_amiya', 'amiya', `char_${'a'.repeat(44)}`, null, 7]) bad({ avatar }, 'avatar');
  bad({ charId: 'Char_002_amiya' }, 'charId');
  bad({ charId: 'amiya' }, 'charId');
  bad({ charId: `char_${'a'.repeat(44)}` }, 'charId');
  bad({ charId: null }, 'charId');
  bad({ bg: '-leading' }, 'bg');
  bad({ bg: 'a b' }, 'bg');
  bad({ bg: 'x'.repeat(49) }, 'bg');
  bad({ bg: 7 }, 'bg');
  for (const trophies of [-1, 1.5, CARD_LIMITS.trophies + 1, '5', null]) bad({ trophies }, 'trophies');
  // 自传头像 (me.avatar) 的那张图：'' 清掉，否则 16 个十六进制字符
  ok({ avatarImg: '' });
  ok({ avatarImg: '0123456789abcdef' });
  for (const avatarImg of ['0123456789ABCDEF', '0123', 7, null]) bad({ avatarImg }, 'avatarImg');
  // 2026-10-24 维护者：「特别是切换到带皮肤的版本的时候，还会显示精二的样子」。`look` 是皮肤 key，而 276 个皮肤里有 20 个
  // 是 camelCase（`char_249_mlyss_ambienceSynesthesia_6`）；旧判据 `[0-9a-z_]` 把它们判成非法，`validateC2S` 于是整条
  // room.card 被拒 —— 浏览器端根本不发，队友永远看不到新立绘。皮肤 key 一律按 isSkinId 放行。
  ok({ look: 'char_249_mlyss_ambienceSynesthesia_6' });
  ok({ avatarLook: 'char_1033_swire2_ambienceSynesthesia_4' });
  ok({ look: 'char_103_angel_wild_1', avatarLook: 'char_1012_skadi2_iteration_2' });
  bad({ look: 'char_249_mlyss_ambience Synesthesia_6' }, 'look');
  bad({ look: 'char_249_mlyss_ambienceSynesthesia_6'.padEnd(65, 'x') }, 'look');
});

// 2026-10-23 维护者：「在准备大厅调整头像连自己都不生效」。自传头像原先只由 session.avatarImg 回填进 room.card，客户端
// 既带不上也清不掉 —— 换成官方头像后队友永远看到旧图。现在 room.card 自己就能说明用哪张。
test('room.card carries the 自传头像: "" clears it, and an id this browser does not own cannot stick', (t) => {
  const MINE = '0123456789abcdef', THEIRS = 'fedcba9876543210';
  const { lobby, player, states, card } = fixture(t, { extra: { avatars: { owns: (id) => id === MINE } } });
  const a = player(), b = player();
  assert.deepEqual(card(a, { avatarImg: MINE }), { ok: true });
  assert.deepEqual(a.card, { avatarImg: MINE });
  assert.deepEqual(lobby.create(a, { mode: 'coop', difficulty: 'NORMAL' }), { ok: true });
  const room = lobby.roomOf(a);
  assert.deepEqual(lobby.join(b, { code: room.code }), { ok: true });
  assert.deepEqual(states(b).at(-1).seats[0].card, { avatarImg: MINE }, 'the room sees the uploaded picture');
  // 换成官方头像：客户端把这张一起带下来，队友那边的旧图必须消失
  assert.deepEqual(card(a, { avatar: AMIYA, avatarImg: '' }), { ok: true });
  assert.deepEqual(a.card, { avatar: AMIYA });
  assert.deepEqual(states(b).at(-1).seats[0].card, { avatar: AMIYA });
  // 别人的 id 不接受（也绝不留在名片上）
  assert.deepEqual(card(a, { avatarImg: THEIRS }), { ok: true });
  assert.equal(a.card.avatarImg, undefined);
  // 消息不提这个字段时保留原值
  assert.deepEqual(card(a, { avatarImg: MINE }), { ok: true });
  assert.deepEqual(card(a, { bg: 'bg_1' }), { ok: true });
  assert.equal(a.card.avatarImg, MINE);
  assert.equal(a.card.bg, 'bg_1');
});

test('a card follows the session into rooms, shows on human seats only and changes are broadcast to the room', (t) => {
  const { lobby, player, states, card } = fixture(t);
  const a = player(), b = player(), watcher = player();
  assert.deepEqual(card(a, { charId: AMIYA, bg: 'bg_1', trophies: 12 }), { ok: true });
  assert.deepEqual(a.card, { charId: AMIYA, bg: 'bg_1', trophies: 12 });
  assert.ok(Object.isFrozen(a.card));
  assert.deepEqual(lobby.create(a, { mode: 'coop', difficulty: 'NORMAL' }), { ok: true });
  const room = lobby.roomOf(a);
  assert.deepEqual(lobby.join(b, { code: room.code }), { ok: true });
  assert.deepEqual(lobby.addBot(a), { ok: true });
  assert.deepEqual(lobby.spectate(watcher, { code: room.code }), { ok: true });
  let seats = states(b).at(-1).seats;
  assert.deepEqual(seats[0].card, { charId: AMIYA, bg: 'bg_1', trophies: 12 }, 'the seat took the session card');
  assert.equal(Object.hasOwn(seats[1], 'card'), false, 'no card, no key');
  assert.equal(Object.hasOwn(seats[2], 'card'), false, 'an AI seat has none');
  assert.ok(states(b).at(-1).spectators.every((s) => !Object.hasOwn(s, 'card')));

  const before = { a: states(a).length, b: states(b).length, w: states(watcher).length };
  assert.deepEqual(card(b, { charId: OTHER }), { ok: true });
  assert.deepEqual(states(a).at(-1).seats[1].card, { charId: OTHER });
  assert.equal(states(a).length, before.a + 1);
  assert.equal(states(watcher).length, before.w + 1, 'the whole room (spectators too) sees the change');
  // the same card again: no broadcast
  assert.deepEqual(card(b, { charId: OTHER }), { ok: true });
  assert.equal(states(a).length, before.a + 1);
  // merge: a field left out keeps its value, '' / 0 clears one, all cleared = no card
  card(a, { bg: 'bg_2' });
  assert.deepEqual(room.seatOf(a.playerId).card, { charId: AMIYA, bg: 'bg_2', trophies: 12 });
  const shown = states(b).length;
  card(a, { avatar: OTHER });
  assert.deepEqual(room.seatOf(a.playerId).card, { charId: AMIYA, avatar: OTHER, bg: 'bg_2', trophies: 12 });
  assert.deepEqual(states(b).at(-1).seats[0].card.avatar, OTHER, 'the avatar is shown to the room');
  assert.equal(states(b).length, shown + 1, 'an avatar change alone is a change');
  card(a, { charId: '', trophies: 0 });
  assert.deepEqual(room.seatOf(a.playerId).card, { avatar: OTHER, bg: 'bg_2' });
  card(a, { avatar: '' });
  assert.deepEqual(room.seatOf(a.playerId).card, { bg: 'bg_2' });
  card(a, { bg: '' });
  assert.equal(a.card, null);
  seats = states(b).at(-1).seats;
  assert.equal(Object.hasOwn(seats[0], 'card'), false);
  // a spectator's card stays on its session (no broadcast) until it takes a player seat
  const quietBefore = states(a).length;
  assert.deepEqual(card(watcher, { charId: AMIYA }), { ok: true });
  assert.equal(states(a).length, quietBefore);
  assert.deepEqual(lobby.removeBot(a, { seat: 2 }), { ok: true });
  assert.deepEqual(lobby.join(watcher, { code: room.code }), { ok: true });
  assert.deepEqual(room.seatOf(watcher.playerId).card, { charId: AMIYA });
});

test('only a real operator of the game data; nothing is stored on a refusal', (t) => {
  const { lobby, player, card } = fixture(t);
  const a = player();
  card(a, { charId: AMIYA });
  for (const charId of ['char_999_nobody', 'char_']) {
    const res = card(a, { charId, bg: 'bg_x' });
    assert.equal(res.error, ERR.BAD_MSG, charId);
    assert.deepEqual(a.card, { charId: AMIYA }, 'the stored card is kept');
    assert.equal(card(a, { avatar: charId, bg: 'bg_x' }).error, ERR.BAD_MSG, `avatar ${charId}`);
    assert.deepEqual(a.card, { charId: AMIYA }, 'the stored card is kept (avatar)');
  }
  const pool = DATA.backups?.diy?.ownedPool || [];
  if (pool.length) assert.deepEqual(card(a, { charId: pool[0] }), { ok: true }, 'a 自选 operator is a real operator');
  assert.deepEqual(lobby.setCard(a, { bg: 'bg_y' }).ok, true, 'handlers may be called without the wire fields');
});

test(`at most ${CARD_CHANGES} changes per ${CARD_WINDOW_MS / 1000} s per session (RATE), repeats are free`, (t) => {
  const { clock, lobby, player, states, card } = fixture(t);
  const a = player(), b = player();
  lobby.create(a, { mode: 'coop', difficulty: 'NORMAL' });
  lobby.join(b, { code: lobby.roomOf(a).code });
  const start = states(b).length;
  for (let i = 1; i <= CARD_CHANGES; i++) assert.deepEqual(card(a, { trophies: i }), { ok: true }, `change ${i}`);
  assert.equal(card(a, { trophies: 99 }).error, ERR.RATE);
  assert.equal(a.card.trophies, CARD_CHANGES, 'the refused change is not stored');
  assert.deepEqual(card(a, { trophies: CARD_CHANGES }), { ok: true }, 'an unchanged card is no change');
  assert.equal(states(b).length, start + CARD_CHANGES, 'one broadcast per accepted change');
  assert.deepEqual(card(b, { trophies: 1 }), { ok: true }, 'the budget is per session');
  clock.time += Math.ceil(CARD_WINDOW_MS / CARD_CHANGES);
  assert.deepEqual(card(a, { trophies: 99 }), { ok: true }, 'the budget refills');
  assert.equal(card(a, { trophies: 100 }).error, ERR.RATE);
});

test('a match gets the display card on human seats only, the cluster DTO never does, and an edit cannot abort a pending start', async (t) => {
  const local = fixture(t);
  const a = local.player(), b = local.player();
  local.card(a, { charId: AMIYA, avatar: OTHER, trophies: 3 });
  local.lobby.create(a, { mode: 'coop', difficulty: 'NORMAL' });
  local.lobby.join(b, { code: local.lobby.roomOf(a).code });
  assert.deepEqual(local.lobby.addBot(a), { ok: true });
  local.lobby.ready(b, { ready: true });
  assert.deepEqual(local.lobby.start(a), { ok: true });
  const room = local.lobby.roomOf(a);
  const seats = new Map(room.match.opts.seats.map((s) => [s.playerId, s]));
  assert.deepEqual(seats.get(a.playerId).card, { charId: AMIYA, avatar: OTHER, trophies: 3 },
    'a human seat carries the display card (the in-match avatar, maintainer 2026-10-20)');
  assert.ok(!Object.hasOwn(seats.get(b.playerId), 'card'), 'a human without a card grows no key');
  const bot = room.match.opts.seats.find((s) => s.isBot);
  assert.ok(bot && !Object.hasOwn(bot, 'card'), 'an AI seat never carries a card');
  assert.deepEqual(local.card(a, { trophies: 4 }), { ok: true }, 'a display edit is fine during a match');
  assert.deepEqual(room.seatOf(a.playerId).card, { charId: AMIYA, avatar: OTHER, trophies: 4 });

  const calls = [];
  const platform = {
    build: 'synthetic-build', protocol: 1,
    prepare(spec, context) { let resolve; const promise = new Promise((r) => { resolve = r; }); calls.push({ spec, context, resolve }); return promise; },
    resume() { return true; }, deliverEnd() { return true; }, release() { return Promise.resolve(true); },
  };
  class ClusterWithPlatform extends ClusterLobby { constructor(opts) { super({ ...opts, platform }); } }
  const cluster = fixture(t, { LobbyClass: ClusterWithPlatform });
  const c = cluster.player(), d = cluster.player();
  cluster.card(c, { charId: AMIYA });
  cluster.lobby.create(c, { mode: 'coop', difficulty: 'NORMAL' });
  cluster.lobby.join(d, { code: cluster.lobby.roomOf(c).code });
  cluster.lobby.ready(d, { ready: true });
  const pending = cluster.lobby.start(c);
  assert.equal(typeof pending.then, 'function');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].spec.seats.every((s) => !Object.hasOwn(s, 'card')), 'the node never sees a card');
  assert.equal(calls[0].context.isCurrent(), true);
  assert.deepEqual(cluster.card(d, { charId: OTHER, bg: 'bg_1' }), { ok: true });
  assert.equal(calls[0].context.isCurrent(), true, 'a display edit leaves the pending start valid');
  assert.deepEqual(cluster.lobby.ready(d, { ready: false }), { ok: true });
  assert.equal(calls[0].context.isCurrent(), false, 'a real seat change still invalidates it');
  calls[0].resolve(null);
  assert.ok((await pending).error);
});

test('look / avatarLook (feedback #9 / #24): 精一 or a skin of that very operator; an operator change drops an orphaned look', (t) => {
  const ok = (msg) => assert.equal(validateC2S({ t: 'room.card', ...msg }), null, JSON.stringify(msg));
  const bad = (msg, field) => assert.equal(validateC2S({ t: 'room.card', ...msg }), `bad field ${field}`, JSON.stringify(msg));
  ok({ look: '' }); ok({ look: 'e1' }); ok({ avatarLook: 'char_103_angel_wild_1' }); ok({ bg: 'skin:char_103_angel_wild_1' });
  bad({ look: 'e2' }, 'look'); bad({ avatarLook: '/assets/x.png' }, 'avatarLook'); bad({ look: 1 }, 'look');
  const withSkin = SKINS.find((s) => OPS.includes(s.charId));
  assert.ok(withSkin, 'an operator of the data with a skin');
  const other = OPS.find((id) => id !== withSkin.charId);
  const f = fixture(t);
  const s = f.player();
  assert.deepEqual(f.card(s, { charId: withSkin.charId, look: withSkin.id, avatar: withSkin.charId, avatarLook: 'e1' }), { ok: true });
  assert.deepEqual({ ...s.card }, { charId: withSkin.charId, look: withSkin.id, avatar: withSkin.charId, avatarLook: 'e1' });
  assert.equal(f.card(s, { charId: other, look: withSkin.id }).error, ERR.BAD_MSG, 'another operator\'s skin');
  assert.equal(f.card(s, { avatarLook: 'char_unknown_skin_1' }).error, ERR.BAD_MSG);
  assert.deepEqual({ ...s.card }, { charId: withSkin.charId, look: withSkin.id, avatar: withSkin.charId, avatarLook: 'e1' }, 'nothing stored on a refusal');
  // a new portrait operator: the skin look no longer fits and is dropped; 'e1' fits every operator and stays
  assert.deepEqual(f.card(s, { charId: other, avatar: other }), { ok: true });
  assert.deepEqual({ ...s.card }, { charId: other, avatar: other, avatarLook: 'e1' });
  // a look without its operator is not kept; '' clears
  assert.deepEqual(f.card(s, { avatar: '', avatarLook: 'e1' }), { ok: true });
  assert.deepEqual({ ...s.card }, { charId: other });
});

// 2026-10-24 维护者：「特别是切换到带皮肤的版本的时候，还会显示精二的样子」。`look` 是皮肤 key，而 276 个皮肤里有 20 个是
// camelCase（`char_249_mlyss_ambienceSynesthesia_6`）。旧判据 `[0-9a-z_]` 把它们判成非法：浏览器端 `validateC2S` 直接拒掉
// 整条 room.card，于是服务端永远收不到 look，队友只能看到精二立绘（自 dip 只读本地 store，所以「自己看自己是对的」）。
test('a camelCase skin key is a legal look: it validates, stores and reaches the room', (t) => {
  const camel = SKINS.find((s) => OPS.includes(s.charId) && /[A-Z]/.test(s.id));
  assert.ok(camel, 'a camelCase skin of an operator in the data');
  assert.equal(validateC2S({ t: 'room.card', charId: camel.charId, look: camel.id }), null);
  const f = fixture(t);
  const s = f.player();
  assert.deepEqual(f.card(s, { charId: camel.charId, look: camel.id }), { ok: true });
  assert.deepEqual({ ...s.card }, { charId: camel.charId, look: camel.id });
  // 上线进房后席位卡也带着它（队友看到的就是这个 look）
  assert.deepEqual(f.lobby.create(s, { mode: 'coop', difficulty: 'NORMAL' }), { ok: true });
  const seat = f.lobby.roomOf(s).seats.find((x) => x && x.playerId === s.playerId);
  assert.equal(seat.card.look, camel.id);
});
