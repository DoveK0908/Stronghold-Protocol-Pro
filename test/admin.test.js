// Native HTTP tests use streams/fake responses only: no listeners, browsers or real player data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createAdminApi, ADMIN_LIMITS } from '../server/admin.js';
import { createTagRegistry, ownerKey } from '../server/tags.js';
import { createAvatarStore } from '../server/avatars.js';
import { createNamecardStore } from '../server/namecards.js';
import { createFeedbackBoard, defaultPassword } from '../server/feedbackBoard.js';
import { createOwnerFile } from '../server/ownerFile.js';
import { Lobby } from '../server/lobby.js';
import { createRequestHandler } from '../server/http/routes.js';
const quiet = { warn() {}, error() {}, info() {} };
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sp-admin-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let clock = 1700000000000, key = 'fixture-owner', enabled = true, generation = Symbol('fixture-owner');
  const sessions = [{ uid: 'fixture-user', playerId: 'p_fixture', name: '博士', tag: '1234', connected: true,
    token: 'reconnect-secret', addr: 'private-address', roomCode: null, card: null }];
  const registry = { all: () => sessions.values() };
  const tags = createTagRegistry({ file: null, now: () => clock });
  tags.claim('博士', '1234', sessions[0].uid);
  const avatars = createAvatarStore({ dir: join(dir, 'avatars'), indexFile: null, log: quiet });
  const namecards = createNamecardStore({ dir: join(dir, 'namecards'), indexFile: null, log: quiet });
  const board = createFeedbackBoard({ file: null, password: null, log: quiet });
  const cleared = [];
  const api = createAdminApi({ ownerFile: { refresh: async () => enabled, active: () => enabled, generation: () => generation,
    verify: given => enabled && given === key },
    tags, avatars, namecards, registry, board, now: () => clock,
    lobby: { adminClearMedia: (kind, id) => cleared.push([kind, id]) }, ...options });
  t.after(() => api.close());
  let cookie = '', csrf = '';
  async function request({ method = 'GET', query = '', body, headers = {}, ip = 'fixture-ip', raw, path = '/api/admin', viaRoute = false } = {}) {
    const req = Readable.from([Buffer.from(raw ?? (body ? JSON.stringify(body) : ''))]);
    req.method = method; req.url = path + (query ? `?${query}` : '');
    req.headers = { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json', cookie,
      'x-sp-csrf': csrf, ...headers };
    req.socket = { remoteAddress: '127.0.0.1' };
    const res = { headers: {}, status: 0, setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
      writeHead(status, headers) { this.status = status; for (const [key, value] of Object.entries(headers)) this.setHeader(key, value); },
      end(raw) { this.body = JSON.parse(raw); this.finish?.(); } };
    if (viaRoute) {
      const done = new Promise(resolve => { res.finish = resolve; });
      createRequestHandler({ admin: api, serveStatic: () => assert.fail('admin fell through to static'), health: {}, log: quiet })(req, res);
      await done;
    } else await api.handle(req, res, path, query, ip);
    return res;
  }
  async function login() {
    const res = await request({ method: 'POST', body: { action: 'login', key } });
    assert.equal(res.status, 200);
    cookie = res.headers['set-cookie'].split(';')[0]; csrf = res.body.csrf;
    return res;
  }
  const write = (action, items, extra = {}) => request({ method: 'POST', body: { action, confirm: 'CONFIRM', items, ...extra } });
  return { api, request, login, write, tags, avatars, namecards, board, sessions, registry, cleared, dir,
    tick(ms) { clock += ms; }, rotate() { key = 'fixture-rotated'; generation = Symbol('fixture-rotated'); },
    disable() { enabled = false; generation = Symbol('fixture-disabled'); } };
}

test('claim UI snapshots permit current writes and reject stale owner/time without deleting a replacement', async t => {
  const f = fixture(t); await f.login();
  const claim = f.tags.adminList()[0];
  const snapshot = { name: claim.name, tag: claim.tag, expectedOwner: claim.owner, expectedAt: claim.at };
  f.tick(1);
  f.tags.adminReassign(claim.name, claim.tag, ownerKey('replacement-user'));
  const stale = await f.write('claims.release', [snapshot]);
  assert.equal(stale.body.results[0].error, 'CONFLICT');
  assert.equal(f.tags.owner(claim.name, claim.tag), ownerKey('replacement-user'));
  const current = f.tags.adminList()[0];
  const fresh = await f.write('claims.release', [{ name: current.name, tag: current.tag, expectedOwner: current.owner, expectedAt: current.at }]);
  assert.equal(fresh.body.results[0].ok, true);
});

test('a reset reports partial media removal and retains claims/profiles if a later deletion fails', async t => {
  const owner = ownerKey('fixture-user'), removed = [];
  const f = fixture(t, {
    avatars: { adminList: () => [{ id: '1111111111111111', owners: [owner] }], adminDelete: id => { removed.push(id); return { ok: true }; } },
    namecards: { adminList: () => [{ id: '2222222222222222', owners: [owner] }], adminDelete: () => ({ ok: false, error: 'DELETE_FAILED' }) },
  });
  f.sessions[0].loadout = { fixture: true };
  await f.login();
  const result = (await f.write('players.reset', [{ owner }])).body.results[0];
  assert.equal(result.ok, false); assert.equal(result.partial, true);
  assert.deepEqual(result.removed, ['avatars']); assert.equal(result.error, 'DELETE_FAILED');
  assert.deepEqual(removed, ['1111111111111111']);
  assert.equal(f.tags.owner('博士', '1234'), owner);
  assert.deepEqual(f.sessions[0].loadout, { fixture: true });
});

test('fail closed: every resource, arbitrary action and missing owner config need independent owner auth', async t => {
  const f = fixture(t);
  for (const resource of ['session', 'players', 'claims', 'avatars', 'namecards', 'feedback', 'audit']) {
    const res = await f.request({ query: `resource=${resource}` });
    assert.equal(res.status, 401); assert.equal(res.headers['cache-control'], 'no-store');
  }
  assert.equal((await f.request({ method: 'POST', body: { action: 'login', key: 'gate-password' } })).status, 401);
  assert.equal((await f.write('claims.release', [{ name: '博士', tag: '1234' }])).status, 401);
  f.disable();
  assert.equal((await f.request({ method: 'POST', body: { action: 'login', key: 'fixture-owner' } })).status, 401);
});

test('session cookie is HttpOnly strict, not JSON; CSRF, cross-origin and logout are enforced', async t => {
  const f = fixture(t), login = await f.login();
  assert.match(login.headers['set-cookie'], /HttpOnly; SameSite=Strict; Path=\/api\/admin; Max-Age=600/);
  assert.equal('token' in login.body, false);
  const requests = [
    { headers: { origin: 'https://evil.test' } },
    { headers: { origin: 'https://localhost:3000' } },
    { headers: { origin: 'null' } },
    { headers: { origin: undefined } },
    { headers: { 'sec-fetch-site': 'cross-site' } },
    { headers: { 'x-sp-csrf': 'wrong' } },
  ];
  for (const options of requests) assert.equal((await f.request({ method: 'POST', body: { action: 'logout' }, ...options })).status, 403);
  assert.equal((await f.request({ headers: { origin: 'https://evil.test' } })).status, 403);
  const session = await f.request(); assert.equal(session.body.csrf, login.body.csrf);
  assert.equal((await f.request({ method: 'POST', body: { action: 'logout' } })).status, 200);
  assert.equal((await f.request()).status, 401);
});

test('absolute expiry and dynamic owner rotation/removal revoke already minted sessions', async t => {
  for (const action of ['rotate', 'disable', 'expire']) {
    const f = fixture(t); await f.login();
    if (action === 'expire') f.tick(ADMIN_LIMITS.sessionMs); else f[action]();
    assert.equal((await f.request()).status, 401, action);
    assert.equal((await f.write('claims.release', [{ name: '博士', tag: '1234' }])).status, 401);
  }
});

test('strict schema, bounded JSON, pagination, search, batches and rate limits', async t => {
  const f = fixture(t); await f.login();
  for (const body of [[], null, { action: 'claims.release', confirm: 'no', items: [] },
    { action: 'claims.release', confirm: 'CONFIRM', items: Array(51).fill({}) },
    { action: 'claims.release', confirm: 'CONFIRM', items: [], path: '/etc/passwd' }]) {
    const res = await f.request({ method: 'POST', raw: JSON.stringify(body) }); assert.equal(res.status, 400);
  }
  assert.equal((await f.request({ method: 'POST', raw: '{' })).body.error, 'BAD_JSON');
  assert.equal((await f.request({ method: 'POST', raw: 'x'.repeat(65537) })).status, 413);
  assert.equal((await f.request({ method: 'POST', body: {}, headers: { 'content-length': '65537' } })).status, 413);
  assert.equal((await f.request({ method: 'POST', body: {}, headers: { 'content-type': 'text/plain' } })).status, 415);
  for (const query of ['resource=claims&limit=101', 'resource=claims&limit=0', 'resource=claims&offset=-1', 'resource=claims&file=x', 'resource=files']) {
    assert.equal((await f.request({ query })).status, 400, query);
  }
  const list = await f.request({ query: 'resource=claims&q=博士&limit=1&offset=0' });
  assert.equal(list.body.items.length, 1); assert.equal(list.body.total, 1);
  const guesses = fixture(t);
  for (let i = 0; i < 5; i++) assert.equal((await guesses.request({ method: 'POST', body: { action: 'login', key: 'wrong' } })).status, 401);
  assert.equal((await guesses.request({ method: 'POST', body: { action: 'login', key: 'wrong' } })).status, 429);
  const limited = fixture(t); await limited.login();
  for (let i = 0; i < 119; i++) assert.equal((await limited.request()).status, 200);
  assert.equal((await limited.request()).status, 429);
});

test('players aggregate persisted claims/uploads and online whitelist without uid, credentials or addresses', async t => {
  const f = fixture(t); f.tags.claim('离线', '1234', 'offline-user');
  const id = f.avatars.put(PNG, ownerKey('offline-user')).id;
  await f.login();
  const res = await f.request({ query: 'resource=players' });
  assert.equal(res.body.total, 2);
  assert.equal(res.body.items.find(p => p.owner === ownerKey('offline-user')).avatar, id);
  const raw = JSON.stringify(res.body);
  for (const secret of ['fixture-user', 'offline-user', 'reconnect-secret', 'private-address', f.dir]) assert.equal(raw.includes(secret), false);
  assert.equal((await f.request({ query: 'resource=avatars' })).body.items[0].path, undefined);
});

test('claims release/reassign keep name+four-digit pair exclusivity and item-level errors', async t => {
  const f = fixture(t); await f.login();
  f.tags.claim('另一位', '1234', 'other');
  const owner = ownerKey('other');
  const out = await f.write('claims.reassign', [{ name: '博士', tag: '1234', targetOwner: owner },
    { name: '无效', tag: '123', targetOwner: owner }, { name: '无效', tag: '5555', targetOwner: '0'.repeat(32) }]);
  assert.deepEqual(out.body.results.map(r => r.ok), [true, false, false]);
  assert.equal(f.tags.owner('博士', '1234'), owner);
  assert.equal(f.tags.owner('另一位', '1234'), null);
  assert.equal(f.tags.claim('不同名字', '1234', 'third').ok, true);
  const released = await f.write('claims.release', [{ name: '博士', tag: '1234' }, { name: '博士', tag: '1234' }]);
  assert.deepEqual(released.body.results.map(r => r.ok), [true, false]);
  const audit = await f.request({ query: 'resource=audit' });
  assert.deepEqual(Object.keys(audit.body.items[0]).sort(), ['action', 'at', 'count', 'succeeded']);
});

test('media deletion is indexed, safe, persistent and revokes all shared lookups', async t => {
  const f = fixture(t); await f.login();
  const store = createAvatarStore({ dir: join(f.dir, 'persisted'), indexFile: join(f.dir, 'index.json'), log: quiet });
  const one = ownerKey('one'), two = ownerKey('two');
  const id = store.put(PNG, one).id; store.put(PNG, two); store.flush();
  const file = store.get(id).path;
  assert.equal(store.adminDelete('../../outside').error, 'BAD_ID');
  assert.equal(existsSync(file), true);
  assert.equal(store.adminDelete(id).ok, true); store.flush();
  assert.equal(store.idOf(one), null); assert.equal(store.idOf(two), null); assert.equal(existsSync(file), false);
  assert.equal(createAvatarStore({ dir: join(f.dir, 'persisted'), indexFile: join(f.dir, 'index.json'), log: quiet }).size, 0);
  const avatar = f.avatars.put(PNG, one).id, namecard = f.namecards.put(PNG, two).id;
  const otherImage = Buffer.concat([PNG, Buffer.from('other')]);
  const retained = f.avatars.put(otherImage, two).id;
  const result = await f.write('avatars.delete', [{ id: '../../outside' }, { id: avatar }, { id: avatar }]);
  assert.deepEqual(result.body.results.map(r => r.ok), [false, true, false]);
  assert.ok(f.avatars.get(retained)); assert.ok(f.namecards.get(namecard));
  assert.deepEqual(f.cleared, [['avatars', avatar]]);
});

test('feedback owner moderation reuses board status/reply/delete without deanonymization or author regression', async t => {
  const f = fixture(t), post = f.board.create({ title: '匿名', body: '内容' }, 'fixture-address');
  assert.throws(() => f.board.login('09081314', 'fixture-address'), e => e.error === 'BAD_PASSWORD');
  await f.login();
  assert.equal((await f.write('feedback.status', [{ id: post.post.id, status: 'planned' }])).body.results[0].ok, true);
  assert.equal((await f.write('feedback.reply', [{ id: post.post.id, body: '官方回复' }])).body.results[0].post.replies[0].maintainer, true);
  const listed = await f.request({ query: 'resource=feedback' });
  assert.equal(JSON.stringify(listed.body).includes(post.secret), false);
  assert.equal('key' in listed.body.items[0], false);
  assert.equal(f.board.edit(post.post.id, { title: '作者仍可改' }, { secret: post.secret }).ok, true);
  assert.equal((await f.write('feedback.delete', [{ id: post.post.id }, { id: post.post.id }])).body.results[1].error, 'NOT_FOUND');
  const old = process.env.SP_FEEDBACK_PASSWORD;
  try { delete process.env.SP_FEEDBACK_PASSWORD; assert.equal(defaultPassword(), null); }
  finally { if (old === undefined) delete process.env.SP_FEEDBACK_PASSWORD; else process.env.SP_FEEDBACK_PASSWORD = old; }
});

test('players reset refuses in-room/shared media and clears only supported roomless server data', async t => {
  const f = fixture(t); await f.login(); const owner = ownerKey('fixture-user');
  f.sessions[0].roomCode = 'ABCD';
  assert.equal((await f.write('players.reset', [{ owner }])).body.results[0].error, 'PLAYER_IN_ROOM');
  f.sessions[0].roomCode = null;
  const id = f.avatars.put(PNG, owner).id; f.avatars.put(PNG, ownerKey('other'));
  assert.equal((await f.write('players.reset', [{ owner }])).body.results[0].error, 'SHARED_MEDIA');
  await f.write('avatars.delete', [{ id }]);
  f.sessions[0].loadout = { fixture: true };
  assert.equal((await f.write('players.reset', [{ owner }])).body.results[0].ok, true);
  assert.equal(f.tags.size, 0); assert.equal(f.sessions[0].loadout, null);
  assert.equal(f.sessions[0].token, 'reconnect-secret');
});

test('native router dispatches admin before static/method fallback without listening', async t => {
  const f = fixture(t); await f.login();
  assert.equal((await f.request({ viaRoute: true, query: 'resource=claims' })).status, 200);
  assert.equal((await f.request({ viaRoute: true, method: 'POST', body: { action: 'logout' } })).status, 200);
  assert.equal((await f.request({ viaRoute: true, path: '/api/admin/not-a-file' })).status, 404);
});

test('real ownerFile fixture replacement revokes the cookie before the next authorized read', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-admin-owner-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'owner.json');
  const save = key => writeFileSync(file, JSON.stringify({ names: [], keySha256: createHash('sha256').update(key).digest('hex') }));
  save('fixture-owner');
  const ownerFile = createOwnerFile({ file, pollMs: 60000, log: quiet }); t.after(() => ownerFile.close());
  const f = fixture(t, { ownerFile }); await f.login();
  rmSync(file); save('a-longer-fixture-rotated-key');
  assert.equal((await f.request()).status, 401);
});

test('an observed owner-file A-to-B-to-A rotation cannot revive a cookie without intervening admin requests', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-admin-epoch-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'owner.json');
  const save = (key, names = []) => writeFileSync(file, JSON.stringify({ names, keySha256: createHash('sha256').update(key).digest('hex') }));
  save('fixture-owner');
  const ownerFile = createOwnerFile({ file, pollMs: 60000, log: quiet }); t.after(() => ownerFile.close());
  const f = fixture(t, { ownerFile }); await f.login();
  save('other-fixture-key', ['epoch']); await ownerFile.refresh();
  save('fixture-owner'); await ownerFile.refresh();
  assert.equal(ownerFile.verify('fixture-owner'), true);
  assert.equal((await f.request()).status, 401);
});

test('explicit reverse-proxy origin pins scheme/host and makes the cookie Secure', async t => {
  const f = fixture(t, { origin: 'https://admin.example.test' });
  assert.equal((await f.request({ method: 'POST', body: { action: 'login', key: 'fixture-owner' } })).status, 403);
  const res = await f.request({ method: 'POST', body: { action: 'login', key: 'fixture-owner' }, headers: { origin: 'https://admin.example.test' } });
  assert.equal(res.status, 200); assert.match(res.headers['set-cookie'], /; Secure$/);
  assert.throws(() => createAdminApi({ origin: 'https://example.test/path' }), /Invalid SP_ADMIN_ORIGIN/);
});

test('failed media filesystem deletion retains the index and owner lookups', t => {
  const f = fixture(t), owner = ownerKey('fixture-user'), id = f.avatars.put(PNG, owner).id;
  const path = f.avatars.get(id).path;
  rmSync(path); mkdirSync(path); writeFileSync(join(path, 'block'), 'fixture');
  assert.equal(f.avatars.adminDelete(id).error, 'DELETE_FAILED');
  assert.equal(f.avatars.idOf(owner), id); assert.ok(f.avatars.get(id));
});

test('in-room reassignment and malformed item schemas cannot mutate any claim', async t => {
  const f = fixture(t); await f.login(); f.tags.claim('其他', '5678', 'other');
  f.sessions[0].roomCode = 'ABCD';
  const before = f.tags.adminList();
  assert.equal((await f.write('claims.release', [{ name: '博士', tag: '1234' }])).body.results[0].error, 'PLAYER_IN_ROOM');
  const res = await f.write('claims.reassign', [{ name: '博士', tag: '1234', targetOwner: ownerKey('other') }, null,
    { name: '博士', tag: '1234', targetOwner: ownerKey('other'), path: 'not-allowed' }]);
  assert.deepEqual(res.body.results.map(r => r.error), ['PLAYER_IN_ROOM', 'BAD_SCHEMA', 'BAD_SCHEMA']);
  assert.deepEqual(f.tags.adminList(), before);
});

test('lobby media revocation clears every live session and seat and not unrelated card fields', () => {
  const id = '0123456789abcdef';
  const sessions = [0, 1].map(n => ({ playerId: `p${n}`, avatarImg: id, namecard: id,
    card: { avatarImg: id, bg: `custom:${id}`, charId: 'preserved' } }));
  const seats = sessions.map(s => ({ playerId: s.playerId, card: s.card }));
  let broadcasts = 0;
  const room = { seatOf: playerId => seats.find(s => s.playerId === playerId) };
  const lobby = { registry: { all: () => sessions.values() }, roomOf: () => room, broadcastState: () => broadcasts++ };
  Lobby.prototype.adminClearMedia.call(lobby, 'avatars', id);
  Lobby.prototype.adminClearMedia.call(lobby, 'namecards', id);
  for (const session of sessions) {
    assert.equal(session.avatarImg, ''); assert.equal(session.namecard, '');
    assert.deepEqual(session.card, { charId: 'preserved' });
  }
  assert.equal(broadcasts, 4);
  assert.equal(seats[0].card, sessions[0].card);
});
