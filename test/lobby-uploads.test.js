// 自传头像 / 名片底图的「重认领」：刷新后用 localStorage 里的 id 重新认领。若那张图已经从服务器上删掉
// （维护者 2026-10-22 手工删过 state/avatars 里的文件），认领必须安静地清空、回到默认，而不是回 BAD_MSG
// 「无效的请求」—— 否则每次进服务器都会弹一次错误提示。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { createAvatarStore } from '../server/avatars.js';
import { createNamecardStore } from '../server/namecards.js';
import { MATCHMAKING_VERSION } from '../shared/constants.js';
import { validateC2S } from '../shared/protocol.js';
import { DATA } from './match/harness.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

class StubMatch {
  constructor(opts) { this.opts = opts; }
  start() {}
  dispose() {}
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sp-uploads-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clock = { time: 50_000 };
  const registry = new SessionRegistry({ now: () => clock.time });
  const avatars = createAvatarStore({ dir: join(dir, 'avatars'), indexFile: join(dir, 'avatars.json'), log: quiet, now: () => clock.time });
  const namecards = createNamecardStore({ dir: join(dir, 'namecards'), indexFile: join(dir, 'namecards.json'), log: quiet, now: () => clock.time });
  const lobby = new Lobby({ registry, MatchClass: StubMatch, getData: () => DATA, log: quiet, now: () => clock.time, avatars, namecards });
  t.after(() => lobby.shutdown());
  let count = 0;
  const player = () => {
    const s = registry.create(`Up${++count}`);
    s.messages = []; s.connected = true; s.matchmakingVersion = MATCHMAKING_VERSION;
    s.ws = { readyState: 1, bufferedAmount: 0, send(raw, cb) { s.messages.push(JSON.parse(raw)); cb?.(); } };
    lobby.onHello(s, { resumed: false, repeat: false });
    return s;
  };
  return { lobby, player, avatars, namecards };
}

test('re-claiming a deleted avatar clears it instead of answering 无效的请求', (t) => {
  const { lobby, player } = fixture(t);
  const s = player();
  s.card = Object.freeze({ ...(s.card || {}), avatarImg: '0123456789abcdef' });
  const res = lobby.onMessage(s, { t: 'me.avatar', id: '0123456789abcdef' });
  assert.equal(res.ok, true);
  assert.equal(s.avatarImg, '');
  const reply = s.messages.filter((m) => m.t === 'me.avatar').at(-1);
  assert.equal(reply.id, '');
});

test('re-claiming a deleted name card clears the custom background instead of erroring', (t) => {
  const { lobby, player } = fixture(t);
  const s = player();
  s.card = Object.freeze({ ...(s.card || {}), bg: 'custom:fedcba9876543210' });
  const res = lobby.onMessage(s, { t: 'me.namecard', id: 'fedcba9876543210' });
  assert.equal(res.ok, true);
  assert.equal(s.namecard, '');
  const reply = s.messages.filter((m) => m.t === 'me.namecard').at(-1);
  assert.equal(reply.id, '');
});

test('the protocol still rejects a garbage id before it reaches the claim branch', () => {
  assert.match(String(validateC2S({ t: 'me.avatar', id: 'not-an-id' })), /id/);
  assert.match(String(validateC2S({ t: 'me.namecard', id: 'not-an-id' })), /id/);
  assert.equal(validateC2S({ t: 'me.avatar', id: '0123456789abcdef' }), null);
});
