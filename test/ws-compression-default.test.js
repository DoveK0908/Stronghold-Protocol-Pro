// 下行流量（工程#06）：对局 WebSocket 的 permessage-deflate 默认开启。
//
// 2026-10-20 实测（docs/DEPLOY.md §1.6）：战斗快照 b.snap 的 JSON 平均 2460 B/帧，10 Hz = 24.0 KB/s；
// 共享上下文的 permessage-deflate 之后 280 B/帧 = 2.7 KB/s（约 8.8 倍）。默认值因此从 off 改成 on，
// 但仍可设 SP_WS_COMPRESSION=off 关掉。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveWsCompression, isCompressibleType } from '../server/wsCompression.js';

const ROOT = new URL('../', import.meta.url);
const source = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');

test('下行：单进程入口在环境变量未设时默认开启压缩', () => {
  const src = source('server/index.js');
  assert.match(src, /resolveWsCompression\(opts\.wsCompression \?\? process\.env\.SP_WS_COMPRESSION \?\? 'on'\)/);
  assert.doesNotMatch(src, /SP_WS_COMPRESSION \?\? 'off'/);
});

test('下行：集群协调器默认也开启压缩，但仍接受显式值', () => {
  const src = source('server/cluster/coordinator.js');
  assert.match(src, /wsCompression: options\.wsCompression \?\? 'on'/);
});

test('下行：off 仍然真的关掉，on 用有界预设，未知值报错', () => {
  assert.equal(resolveWsCompression('off'), false);
  const on = resolveWsCompression('on');
  assert.ok(on && typeof on === 'object');
  assert.equal(on.threshold, 0);
  assert.equal(on.clientNoContextTakeover, true);
  assert.throws(() => resolveWsCompression('yes'), TypeError);
});

test('下行：只有白名单帧进压缩上下文（凭证与未知消息不进）', () => {
  for (const type of ['m.public', 'm.private', 'm.state', 'b.snap', 'b.ev', 'b.start']) {
    assert.equal(isCompressibleType(type), true, type);
  }
  for (const type of ['welcome', 'hello', 'error', 'room.state', '', null, 42]) {
    assert.equal(isCompressibleType(type), false, String(type));
  }
});

test('下行：文档写的是默认开启，且不再把 fx index 当成浏览器下载物', () => {
  const doc = source('docs/DEPLOY.md');
  assert.match(doc, /SP_WS_COMPRESSION=off` 可关|要关就设 `SP_WS_COMPRESSION=off`/);
  assert.match(doc, /2\.7 KB\/s/);
  assert.match(doc, /10\.67 MB.*只由服务器进程读取|只由服务器进程读取/);
});
