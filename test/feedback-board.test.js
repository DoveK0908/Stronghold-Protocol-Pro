// test/feedback-board.test.js — the lobby's anonymous feedback board (server/feedbackBoard.js, /api/feedback).
//
// What the board must never do: store who posted, let one browser edit another's post, treat a maintainer session as
// forever, or answer a write it could not classify. What it must always do: keep the four columns, survive a restart, and
// refuse the same address more than the minute allows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFeedbackApi, createFeedbackBoard, FeedbackError } from '../server/feedbackBoard.js';
import { FEEDBACK_LIMITS, FEEDBACK_STATUSES } from '../shared/feedback.js';

const quiet = { warn() {}, error() {}, info() {} };

/** A board in memory with a controllable clock. */
function memoryBoard(opts = {}) {
  let clock = 1_700_000_000_000;
  const board = createFeedbackBoard({ file: null, log: quiet, password: 'pw', now: () => clock, ...opts });
  return { board, tick: (ms) => { clock += ms; } };
}

test('a post carries no identity: the board keeps a secret hash, the public payload keeps nothing', () => {
  const { board } = memoryBoard();
  const { post, secret } = board.create({ title: '标题', body: '正文' }, '10.0.0.1');
  assert.equal(post.status, 'open');
  assert.equal(post.title, '标题');
  assert.equal(post.body, '正文');
  assert.deepEqual(post.replies, []);
  assert.match(secret, /^[0-9a-f]{36}$/);
  const stored = board.posts[0];
  assert.match(stored.key, /^[0-9a-f]{64}$/, 'the stored key is a SHA-256 of the secret');
  assert.notEqual(stored.key, secret);
  for (const field of ['ip', 'addr', 'player', 'pid', 'name', 'author', 'token']) assert.equal(field in post, false, field);
  // the address is only ever held as a rate-limit key, never on the post
  assert.equal(JSON.stringify(board.list()).includes('10.0.0.1'), false);
});

test('the board lists the newest post first and counts replies', () => {
  const { board } = memoryBoard();
  const a = board.create({ title: 'a', body: 'a' }, 'ip').post;
  const b = board.create({ title: 'b', body: 'b' }, 'ip').post;
  board.reply(a.id, { body: '一个回复' }, 'ip');
  const listed = board.list();
  assert.deepEqual(listed.posts.map((p) => p.id), [b.id, a.id]);
  assert.equal(listed.posts[1].replies.length, 1);
  assert.equal(listed.posts[1].replies[0].body, '一个回复');
  assert.equal(listed.posts[1].replies[0].maintainer, false);
});

test('only the writer may edit or withdraw: the secret, never the address', () => {
  const { board } = memoryBoard();
  const { post, secret } = board.create({ title: 't', body: 'b' }, 'ip-a');
  assert.throws(() => board.edit(post.id, { title: 'x' }, { secret: 'nope' }), (e) => e instanceof FeedbackError && e.error === 'NOT_YOURS');
  assert.throws(() => board.withdraw(post.id, {}), (e) => e.error === 'NOT_YOURS');
  const edited = board.edit(post.id, { title: '改了', body: '也改了' }, { secret });
  assert.equal(edited.post.title, '改了');
  assert.equal(edited.post.body, '也改了');
  board.withdraw(post.id, { secret });
  assert.equal(board.list().posts.length, 0);
});

test('a maintainer session marks replies and moves a post between the four columns', () => {
  const { board } = memoryBoard();
  const { post } = board.create({ title: 't', body: 'b' }, 'ip');
  assert.equal(board.session('nope').maintainer, false);
  assert.throws(() => board.login('wrong', 'ip'), (e) => e.error === 'BAD_PASSWORD');
  const { token, expiresAt } = board.login('pw', 'ip');
  assert.equal(typeof expiresAt, 'number');
  assert.equal(board.session(token).maintainer, true);
  board.reply(post.id, { body: '收到', token }, 'ip');
  assert.equal(board.list().posts[0].replies[0].maintainer, true);
  for (const status of FEEDBACK_STATUSES) {
    assert.equal(board.setStatus(post.id, status, { token }).post.status, status);
  }
  assert.throws(() => board.setStatus(post.id, 'archived', { token }), (e) => e.error === 'BAD_STATUS');
  assert.throws(() => board.setStatus(post.id, 'done', {}), (e) => e.error === 'NOT_MAINTAINER');
  // …but not edit or withdraw: those belong to the author alone, the maintainer session does not stand in for the secret
  assert.throws(() => board.withdraw(post.id, { token }), (e) => e.error === 'NOT_YOURS');
  assert.throws(() => board.edit(post.id, { title: 'x' }, { token }), (e) => e.error === 'NOT_YOURS');
  assert.equal(board.list().posts.length, 1);
});

test('a maintainer session expires, and a password-less board never mints one', () => {
  const { board, tick } = memoryBoard();
  const { token } = board.login('pw', 'ip');
  tick(FEEDBACK_LIMITS.sessionMs - 1);
  assert.equal(board.session(token).maintainer, true);
  tick(2);
  assert.equal(board.session(token).maintainer, false);
  board.prune();

  const sealed = createFeedbackBoard({ file: null, log: quiet, password: null });
  assert.throws(() => sealed.login('', 'ip'), (e) => e.error === 'BAD_PASSWORD');
});

test('one address writes no more than the minute allows; a refusal keeps its reason', () => {
  const { board, tick } = memoryBoard();
  for (let i = 0; i < FEEDBACK_LIMITS.writesPerMinute; i++) board.create({ title: `t${i}`, body: 'b' }, 'ip-x');
  assert.throws(() => board.create({ title: 'over', body: 'b' }, 'ip-x'), (e) => e.error === 'RATE_LIMIT' && e.status === 429);
  // another address is not affected, and the window rolls over
  assert.equal(board.create({ title: 'other', body: 'b' }, 'ip-y').ok, true);
  tick(FEEDBACK_LIMITS.writeWindowMs);
  assert.equal(board.create({ title: 'again', body: 'b' }, 'ip-x').ok, true);
});

test('text is trimmed, control characters go, and the length limits hold', () => {
  const { board } = memoryBoard();
  assert.equal(board.create({ title: '  t\u0007 ', body: ' b ' }, 'ip').post.title, 't');
  assert.throws(() => board.create({ title: '', body: 'b' }, 'ip'), (e) => e.error === 'EMPTY');
  assert.throws(() => board.create({ title: 5, body: 'b' }, 'ip'), (e) => e.error === 'BAD_TEXT');
  assert.throws(() => board.create({ title: 'x'.repeat(FEEDBACK_LIMITS.title + 1), body: 'b' }, 'ip'), (e) => e.error === 'TOO_LONG');
  assert.equal(board.create({ title: 'x'.repeat(FEEDBACK_LIMITS.title), body: 'b' }, 'ip').ok, true);
});

test('the board survives a restart (state/feedback-board.json), and a broken file only warns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-feedback-'));
  const file = join(dir, 'feedback-board.json');
  try {
    const first = createFeedbackBoard({ file, log: quiet });
    const { post, secret } = first.create({ title: '存住', body: '正文' }, 'ip');
    first.reply(post.id, { body: '回复' }, 'ip');
    first.flush();
    const again = createFeedbackBoard({ file, log: quiet });
    const listed = again.list().posts;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].title, '存住');
    assert.equal(listed[0].replies.length, 1);
    // the same browser still owns its post after the restart
    assert.equal(again.edit(post.id, { title: '还是我' }, { secret }).post.title, '还是我');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the HTTP surface ---------------------------------------------------------------------------

/** A request the API can read (an async iterable with headers), and a response that records what was written. */
function fakeReq(method, { body = '', type = 'application/json' } = {}) {
  const stream = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(stream, { method, headers: { 'content-type': type, 'content-length': String(Buffer.byteLength(body)) } });
  return stream;
}
function fakeRes() {
  const out = { status: 0, headers: null, text: '' };
  return {
    out,
    setHeader: (k, v) => { out.headers = { ...(out.headers || {}), [k]: v }; },
    writeHead: (status, headers) => { out.status = status; out.headers = { ...(out.headers || {}), ...headers }; },
    end: (text) => { out.text = text || ''; },
    json() { return JSON.parse(out.text); },
  };
}

test('the one route reads the board and takes every write as a JSON action', async () => {
  const { board } = memoryBoard();
  const api = createFeedbackApi({ board, log: quiet });
  assert.equal(api.handles('/api/feedback'), true);
  assert.equal(api.handles('/api/feedback/'), false);
  assert.equal(api.handles('/api/nope'), false);

  const get = fakeRes();
  await api.handle(fakeReq('GET'), get, '/api/feedback', '', 'ip');
  assert.equal(get.out.status, 200);
  assert.deepEqual(get.json().posts, []);
  assert.equal(get.json().limits.writesPerMinute, FEEDBACK_LIMITS.writesPerMinute);

  const create = fakeRes();
  await api.handle(fakeReq('POST', { body: JSON.stringify({ action: 'create', title: 't', body: 'b' }) }), create, '/api/feedback', '', 'ip');
  assert.equal(create.out.status, 200);
  const created = create.json();
  assert.ok(created.secret);
  assert.equal(created.post.title, 't');

  const bad = fakeRes();
  await api.handle(fakeReq('POST', { body: JSON.stringify({ action: 'nope' }) }), bad, '/api/feedback', '', 'ip');
  assert.equal(bad.out.status, 400);
  assert.equal(bad.json().error, 'BAD_ACTION');

  const form = fakeRes();
  await api.handle(fakeReq('POST', { body: 'action=create', type: 'application/x-www-form-urlencoded' }), form, '/api/feedback', '', 'ip');
  assert.equal(form.out.status, 415, 'a cross-site form post is refused before it is read');

  const junk = fakeRes();
  await api.handle(fakeReq('POST', { body: '{' }), junk, '/api/feedback', '', 'ip');
  assert.equal(junk.out.status, 400);
  assert.equal(junk.json().error, 'BAD_JSON');

  const big = fakeRes();
  await api.handle(fakeReq('POST', { body: 'x'.repeat(FEEDBACK_LIMITS.bodyBytes + 10) }), big, '/api/feedback', '', 'ip');
  assert.equal(big.out.status, 413);

  const put = fakeRes();
  await api.handle(fakeReq('PUT'), put, '/api/feedback', '', 'ip');
  assert.equal(put.out.status, 405);
  assert.equal(put.out.headers.Allow, 'GET, HEAD, POST');

  const login = fakeRes();
  await api.handle(fakeReq('POST', { body: JSON.stringify({ action: 'login', password: 'pw' }) }), login, '/api/feedback', '', 'ip');
  assert.equal(login.out.status, 200);
  const token = login.json().token;
  assert.equal(login.json().password, undefined);
  const status = fakeRes();
  await api.handle(fakeReq('POST', { body: JSON.stringify({ action: 'status', id: created.post.id, status: 'planned', token }) }), status, '/api/feedback', '', 'ip');
  assert.equal(status.json().post.status, 'planned');
  const session = fakeRes();
  await api.handle(fakeReq('POST', { body: JSON.stringify({ action: 'session', token }) }), session, '/api/feedback', '', 'ip');
  assert.equal(session.json().maintainer, true);
});
