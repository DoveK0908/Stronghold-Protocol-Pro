// 动态位图（名片/头像）的 HTTP 上传通道：一次性 ticket + POST。
// 这里的 store 用内存假实现——真 store 的落盘、索引、驱逐由 avatar-store.test.js 与 namecard-store.test.js 守着。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUploadTickets, createAnimatedUpload, UPLOAD_PREFIX } from '../server/uploads.js';

const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'binary');

function fakeReq(method, body, query = '', headers = {}) {
  const chunks = body == null ? [] : [body];
  return {
    method,
    headers: { 'content-type': 'image/gif', ...headers },
    async *[Symbol.asyncIterator]() { for (const c of chunks) yield c; },
  };
}
function fakeRes() {
  const res = {
    code: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    writeHead(code, h) { this.code = code; Object.assign(this.headers, h || {}); },
    end(buf) { this.body = buf; },
  };
  return res;
}

function setup(over = {}) {
  const saved = [];
  const store = {
    maxBytes: over.maxBytes || 4096,
    put(buf) { saved.push(buf); return { ok: true, id: 'a'.repeat(16) }; },
  };
  let clock = 1000;
  const tickets = createUploadTickets({ now: () => clock, ttlMs: 5000 });
  const uploads = createAnimatedUpload({ tickets, namecards: store, avatars: store, log: { warn() {} } });
  return { tickets, uploads, saved, tick: (ms) => { clock += ms; } };
}

test('ticket → POST 上传成功，落到 store', async () => {
  const { tickets, uploads, saved } = setup();
  const t = tickets.issue('owner-1').ticket;
  const req = fakeReq('POST', GIF);
  const res = fakeRes();
  const handled = await uploads.handle(req, res, `${UPLOAD_PREFIX}namecard`, `ticket=${t}`);
  assert.equal(handled, true);
  assert.equal(res.code, 201, JSON.stringify(res.headers));
  assert.deepEqual(JSON.parse(res.body), { id: 'a'.repeat(16) });
  assert.equal(saved.length, 1);
});

test('ticket 只能换一次：重放被拒', async () => {
  const { tickets, uploads } = setup();
  const t = tickets.issue('owner-1').ticket;
  assert.equal((await uploads.handle(fakeReq('POST', GIF), fakeRes(), `${UPLOAD_PREFIX}namecard`, `ticket=${t}`)), true);
  const res = fakeRes();
  await uploads.handle(fakeReq('POST', GIF), res, `${UPLOAD_PREFIX}namecard`, `ticket=${t}`);
  assert.equal(res.code, 403);
});

test('没有 ticket / 野 ticket 一律 403', async () => {
  const { uploads } = setup();
  for (const q of ['', 'ticket=deadbeef']) {
    const res = fakeRes();
    await uploads.handle(fakeReq('POST', GIF), res, `${UPLOAD_PREFIX}avatar`, q);
    assert.equal(res.code, 403);
  }
});

test('ticket 过期后 403', async () => {
  const { tickets, uploads, tick } = setup();
  const t = tickets.issue('owner-1').ticket;
  tick(6000);
  const res = fakeRes();
  await uploads.handle(fakeReq('POST', GIF), res, `${UPLOAD_PREFIX}namecard`, `ticket=${t}`);
  assert.equal(res.code, 403);
});

test('非图片 content-type 415，超长 413', async () => {
  const { tickets, uploads } = setup({ maxBytes: 8 });
  const t1 = tickets.issue('owner-1').ticket;
  const res1 = fakeRes();
  await uploads.handle(fakeReq('POST', GIF, '', { 'content-type': 'text/plain' }), res1, `${UPLOAD_PREFIX}namecard`, `ticket=${t1}`);
  assert.equal(res1.code, 415);

  const t2 = tickets.issue('owner-1').ticket;
  const res2 = fakeRes();
  await uploads.handle(fakeReq('POST', Buffer.alloc(64)), res2, `${UPLOAD_PREFIX}namecard`, `ticket=${t2}`);
  assert.equal(res2.code, 413);
});

test('GET /upload/* 405，不认识的路径不接管', async () => {
  const { uploads } = setup();
  const res = fakeRes();
  await uploads.handle(fakeReq('GET', null), res, `${UPLOAD_PREFIX}namecard`, '');
  assert.equal(res.code, 405);
  assert.equal(uploads.handles('/upload/namecard'), true);
  assert.equal(uploads.handles('/upload/nope'), false);
  assert.equal(uploads.handles('/api/status'), false);
});
