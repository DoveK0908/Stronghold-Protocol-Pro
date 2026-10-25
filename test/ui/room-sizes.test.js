import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 维护者 2026-10-20：「查看服务器状况的按钮大小还是不对」「添加精英干员，这个大小要和上面的添加 AI 队友一样大」。
// The geometry itself is checked in the headless probes (_build/probe-room-sizes.mjs); these assertions pin the
// rules that make it hold, because both bugs were selector mistakes that a browser-only check caught.
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('the service pill inside the Tooltip anchor gets the same 36px row as the other top-bar controls', () => {
  const css = read('public/css/screens/lobby.css');
  assert.match(css, /\.rs-top__left \{ --rs-ctl-h: \.36rem; \}/);
  // the pill is wrapped in .tt-anchor, so a child combinator never matched it (that was the "还是不对")
  assert.match(css, /\.rs-top \.latency-status \.server-load-button,/, 'matches through the Tooltip anchor, not only as a direct child');
  assert.match(css, /\.rs-top \.latency-status \.tt-anchor \{ display: inline-flex; height: var\(--rs-ctl-h\); \}/);
  const block = css.match(/\.rs-top \.latency-status > \.connection-status,\n([^}]*)\}/);
  assert.ok(block, 'the shared rule for 已连接 / 服务 / 延迟 exists');
  assert.match(block[0], /height: var\(--rs-ctl-h\)/, 'all three take the same height');
  assert.match(block[0], /min-height: 0/, 'and it wins over .rs-tools .server-load-button min-height');
  assert.match(block[0], /padding-block: 0/);
});

test('添加精英干员 is the same block as 添加 AI 队友', () => {
  // the fork's own room rules live in screens/lobby.css (screens/room.css is the official room since 0.3.2)
  const css = read('public/css/screens/lobby.css');
  assert.match(css, /\.rseat__adds > \*, \.rseat__adds \.rseat__addbot \{ width: 100%; \}/, 'the elite wrapper stretches like the AI button');
  const room = read('public/js/screens/room.js');
  assert.match(room, /<div class="rseat__adds">\n\s*<button type="button" class="rseat__addbot" disabled=\$\{busy === 'add'\}/);
  assert.match(room, /<\$\{EliteRecruit\} room=\$\{room\} busy=\$\{busy\} onAdd=\$\{onAddElite\} \/>/, 'and sits in the same column');
  assert.match(room, /<button type="button" class="rseat__addbot" aria-haspopup="menu"/, 'the elite button reuses the AI button class');
});

// 维护者 2026-10-21：「准备大厅的延迟显示有问题，一直等待新测量」——房间顶栏的 PingPill 没传 ms，
// 于是永远停在「-- ms / 等待新测量」。大厅（lobby.js）与标题页（title.js）都传了 `conn.ping`。
test('the room top bar feeds the measured latency into PingPill', () => {
  const room = read('public/js/screens/room.js');
  assert.match(room, /<\$\{PingPill\} ms=\$\{conn\.ping\} online=\$\{online\}/, 'room.js passes conn.ping like lobby.js does');
});
