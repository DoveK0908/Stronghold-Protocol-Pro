// server/tags.js: the 名字#四位 claims (界面#09) and how a hello uses them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLAIM_TTL_MS, isTag, ownerKey, pairKey, createTagRegistry } from '../server/tags.js';
import { Network, SessionRegistry } from '../server/net.js';

function tmpFile(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sp-tags-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'name-tags.json');
}

test('isTag / ownerKey / pairKey', () => {
  assert.equal(isTag('1234'), true);
  assert.equal(isTag('123'), false);
  assert.equal(isTag(1234), false);
  assert.notEqual(ownerKey('abc'), ownerKey('abd'));
  assert.equal(ownerKey('abc').length, 32);
  assert.equal(pairKey('博士', '1234'), '博士#1234');
});

test('claim: first come wins for one pair, names and digits may repeat on their own', () => {
  const reg = createTagRegistry({ file: null });
  assert.deepEqual(reg.claim('博士', '1234', 'uid-a'), { ok: true });
  assert.deepEqual(reg.claim('博士', '1234', 'uid-b'), { ok: false, reason: 'taken' });
  // the same digits under another name, and another pair for the same name, are free
  assert.deepEqual(reg.claim('凯尔希', '1234', 'uid-b'), { ok: true });
  assert.deepEqual(reg.claim('博士', '5678', 'uid-b'), { ok: true });
  // the owner itself may re-claim its pair (a reload)
  assert.deepEqual(reg.claim('博士', '1234', 'uid-a'), { ok: true });
  assert.equal(reg.size, 3);
});

test('release: only the owner gives a pair up', () => {
  const reg = createTagRegistry({ file: null });
  reg.claim('博士', '1234', 'uid-a');
  assert.equal(reg.release('博士', '1234', 'uid-b'), false);
  assert.equal(reg.owner('博士', '1234'), ownerKey('uid-a'));
  assert.equal(reg.release('博士', '1234', 'uid-a'), true);
  assert.equal(reg.owner('博士', '1234'), null);
  assert.deepEqual(reg.claim('博士', '1234', 'uid-b'), { ok: true });
});

test('pick: a free tag for the name, skips what is taken', () => {
  const reg = createTagRegistry({ file: null });
  for (let n = 1000; n < 1010; n++) reg.claim('博士', String(n), `uid-${n}`);
  const tag = reg.pick('博士', () => 0.5); // 5500: free
  assert.equal(tag, '5500');
  // a random source that only ever hits taken tags falls back to a scan
  const fallback = reg.pick('博士', () => 0);
  assert.equal(fallback, '1010');
  // another name has its own space
  assert.equal(reg.pick('凯尔希', () => 0), '1000');
});

test('claims persist to the file and survive a restart; a stale one expires', (t) => {
  const file = tmpFile(t);
  const a = createTagRegistry({ file, now: () => 1_000 });
  a.claim('博士', '1234', 'uid-a');
  a.flush();
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(saved), ['博士#1234']);
  assert.equal(saved['博士#1234'].u, ownerKey('uid-a'));
  assert.equal(saved['博士#1234'].u.includes('uid-a'), false, 'the uid itself is never written');

  const b = createTagRegistry({ file, now: () => 1_000 });
  assert.deepEqual(b.claim('博士', '1234', 'uid-b'), { ok: false, reason: 'taken' });
  assert.deepEqual(b.claim('博士', '1234', 'uid-a'), { ok: true });

  const later = createTagRegistry({ file, now: () => 1_000 + CLAIM_TTL_MS + 1 });
  assert.deepEqual(later.claim('博士', '1234', 'uid-b'), { ok: true }, 'an unused claim is up for grabs again');
});

test('hello: a client with a uid claims 名字#四位; another browser is refused with NAME_TAKEN', (t) => {
  const file = tmpFile(t);
  const tags = createTagRegistry({ file, now: () => 5_000 });
  const server = new Network({ registry: new SessionRegistry(), handler: { onMessage() {} }, tags });
  t.after(() => { clearInterval(server.heartbeatTimer); clearInterval(server.sweepTimer); });
  const frames = [];
  const hello = (msg) => {
    const conn = { session: null, ip: '?', key: null, ws: { readyState: 1, bufferedAmount: 0,
      send(raw) { frames.push(JSON.parse(raw)); }, close() {} } };
    server.onHelloMsg(conn, msg, 5_000);
    return frames.at(-1);
  };
  const first = hello({ t: 'hello', rid: 1, name: '博士', uid: 'uid-a', tag: '1234' });
  assert.equal(first.t, 'welcome');
  assert.equal(first.tag, '1234');
  const other = hello({ t: 'hello', rid: 2, name: '博士', uid: 'uid-b', tag: '1234' });
  assert.equal(other.t, 'error');
  assert.equal(other.code, 'NAME_TAKEN');
  // the same browser may take another pair; the old one is released
  const renamed = hello({ t: 'hello', rid: 3, name: '博士', uid: 'uid-a', tag: '5678' });
  assert.equal(renamed.t, 'welcome');
  assert.equal(renamed.tag, '5678');
  assert.equal(tags.owner('博士', '1234'), null);
  assert.equal(tags.owner('博士', '5678'), ownerKey('uid-a'));
  // a client without a uid keeps the pre-界面#09 behaviour: no digits at all
  const legacy = hello({ t: 'hello', rid: 4, name: '凯尔希' });
  assert.equal(legacy.t, 'welcome');
  assert.equal(legacy.tag, null);
  assert.equal(tags.size, 1);
});

test('a hello naming no tag gets a free one for its name', (t) => {
  const tags = createTagRegistry({ file: null });
  tags.claim('博士', '1000', 'uid-x');
  const server = new Network({ registry: new SessionRegistry(), handler: { onMessage() {} }, tags });
  t.after(() => { clearInterval(server.heartbeatTimer); clearInterval(server.sweepTimer); });
  const frames = [];
  const conn = { session: null, ip: '?', key: null, ws: { readyState: 1, bufferedAmount: 0, send(raw) { frames.push(JSON.parse(raw)); }, close() {} } };
  server.onHelloMsg(conn, { t: 'hello', rid: 1, name: '博士', uid: 'uid-y' }, 5_000);
  const welcome = frames.at(-1);
  assert.equal(welcome.t, 'welcome');
  assert.match(welcome.tag, /^\d{4}$/);
  assert.notEqual(welcome.tag, '1000');
  assert.equal(tags.owner('博士', welcome.tag), ownerKey('uid-y'));
});
