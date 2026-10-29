// In-process only: no service, browser, Worker or child process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { Match } from '../server/match/Match.js';
import { PlayerState } from '../server/match/PlayerState.js';
import { MatchSpeedVote } from '../server/match/match/speedVote.js';
import { MatchPause } from '../server/match/match/pause.js';
import { MatchClientCombat } from '../server/match/match/clientCombat.js';
import { createBattleRunner } from '../public/js/battle/runner.js';
import { createStore, initialState } from '../public/js/store.js';
import { installServerPatch } from '../mods/luck/runtime/src/server-patch.mjs';

PlayerState.prototype.privateView = function () { return {}; };
await installServerPatch(fileURLToPath(new URL('../', import.meta.url)), { info() {}, warn() {} }, { record: false });
const source = (path) => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function fixture() {
  let now = 10_000;
  const m = {
    experimental: { luckConsole: true }, phase: 'COMBAT', gameSpeed: 2,
    players: new Map(), spectators: new Map(), fields: [],
    sched: { now: () => now }, _clockNow: MatchPause.prototype._clockNow,
    _fieldElapsed: MatchClientCombat.prototype._fieldElapsed,
    deadline: 30_000, overtimeAt: 40_000, _bossStartAt: 0, pausedMs: 0,
    markPublic() { this.marked = true; }, flush() {}, cancel() {}, log: {},
    _armDeadline(f) { f.armed = true; }, _armRelease(f) { f.released = true; },
  };
  const ps = { playerId: 'own', m, dirty() { this.dirtied = true; } };
  const other = { playerId: 'other', m, dirty() { this.dirtied = true; } };
  m.players.set('own', ps); m.players.set('other', other);
  const send = n => Match.prototype.handle.call(m, 'own', { t: 'g.modSpeed', n });
  return { m, ps, other, send, at(t) { now = t; } };
}

test('Luck is absolute and supersedes even same-speed Pro promises; all seats get an authoritative echo', () => {
  const { m, ps, other, send } = fixture();
  m.speedBoost = true; m.speedBoostPending = true; m.speedBoostOffPending = true;
  m.speedVote = {}; m.cancelSpeedVote = () => { m.speedVote = null; };
  assert.equal(send(4).ok, true); assert.equal(m.gameSpeed, 4);
  assert.deepEqual([m.speedBoost, m.speedBoostPending, m.speedBoostOffPending, m.speedVote], [false, false, false, null]);
  assert.ok(m.marked && ps.dirtied && other.dirtied);
  m.speedBoostPending = true; send(4); assert.equal(m.speedBoostPending, false);
  assert.equal(PlayerState.prototype.privateView.call(ps).modSpeed, 4);
  assert.equal(PlayerState.prototype.privateView.call(other).modSpeed, 4);
});

test('Pro on/off use absolute baseline speeds rather than multiplying/halving Luck', () => {
  for (const speed of [1, 2, 4, 8]) {
    const { m } = fixture(); m.gameSpeed = speed; m.speedBoostPending = true;
    assert.equal(MatchSpeedVote.prototype.applySpeedBoost.call(m), true); assert.equal(m.gameSpeed, 4);
    m.gameSpeed = 8; m.speedBoostOffPending = true;
    assert.equal(MatchSpeedVote.prototype.applySpeedBoost.call(m), true); assert.equal(m.gameSpeed, 2);
  }
});

test('midfight changes preserve field and boss elapsed, HUD remaining game time, deadlines and pacing debt', () => {
  const { m, send, at } = fixture();
  const f = { cc: true, startAt: 0, kind: 'normal', mode: 'client', spec: { timeLimit: 120 } };
  const release = { cc: true, startAt: 0, mode: 'server', result: {} };
  m.fields = [f, release];
  m.runner = { acc: 0.5, last: 9000, remote: true, ready: true };
  m.pacer = { acc: 0.25, last: 9500 };
  const elapsed = m._fieldElapsed(f);
  send(8);
  assert.equal(m._fieldElapsed(f), elapsed);
  assert.equal((m.sched.now() - m._bossStartAt) / 1000 * m.gameSpeed, 20);
  assert.equal((m.deadline - m.sched.now()) * m.gameSpeed, 40_000);
  assert.equal((m.overtimeAt - m.sched.now()) * m.gameSpeed, 60_000);
  assert.equal(m.runner.acc, 2.5); assert.equal(m.pacer.acc, 1.25);
  assert.ok(f.armed && release.released);
  at(11_000); assert.equal(m._fieldElapsed(f), 28);
  send(1); assert.equal(m._fieldElapsed(f), 28);
  assert.equal(m.runner.acc, 10.5);
});

test('paused speed changes preserve frozen origins and rearm only on resume, including result release', () => {
  const { m, send, at } = fixture(); m.paused = true; m._pausedAt = 8000;
  m.fields = [{ cc: true, startAt: 0, mode: 'client', kind: 'normal', deadlineTimer: {} },
    { cc: true, startAt: 0, mode: 'server', result: {}, doneTimer: {} }];
  const f = m.fields[0]; const gt = m._fieldElapsed(f);
  m.runner = { acc: 3, last: 7000 };
  send(4); assert.equal(m._fieldElapsed(f), gt); assert.equal(m.runner.acc, 3);
  assert.equal(f.rearmDeadline, true); assert.equal(m.fields[1].rearmRelease, true);
  assert.equal(f.armed, undefined); assert.equal(m.fields[1].released, undefined);
  at(18_000); MatchPause.prototype._resume.call(m);
  assert.equal(m._fieldElapsed(f), gt); assert.ok(f.armed && m.fields[1].released);
  assert.equal((m.sched.now() - m._bossStartAt) / 1000 * m.gameSpeed, 16);
});

test('presentation pacing reads match effective speed, never last process-global Luck preference', () => {
  const { m, send } = fixture(); send(8);
  assert.equal(Match.prototype.scaled.call({ gameSpeed: 2, soloUntimed: true, timerScale: 1 }, 3000), 3000);
  assert.equal(Match.prototype.scaled.call({ gameSpeed: 4, soloUntimed: true, timerScale: 1 }, 3000), 1500);
  m.experimental = {}; assert.ok(send(4).error); assert.equal(m.gameSpeed, 8);
});

test('browser runner retunes paused and active target clocks without dropping catch-up debt', () => {
  let now = 1000;
  const store = createStore(initialState);
  const r = createBattleRunner({ store, net: { on() { return () => {}; } }, now: () => now,
    doc: { hidden: false, addEventListener() {}, removeEventListener() {} },
    raf() {}, caf() {}, setInterval() {}, clearInterval() {} });
  store.patch('match', { public: { phase: 'COMBAT', paused: false } });
  const e = { t0: 0, speed: 2, battle: { tickCount: 1 }, done: false };
  r._entries.set('clock', e);
  r.retuneSpeed(4); assert.equal((now - e.t0) * e.speed, 2000);
  store.patch('match', { public: { phase: 'COMBAT', paused: true } }); now = 6000;
  r.retuneSpeed(8); assert.equal((1000 - e.t0) * e.speed, 2000);
  store.patch('match', { public: { phase: 'COMBAT', paused: false } });
  assert.equal((now - e.t0) * e.speed, 2000);
  r._entries.clear(); r.dispose();
});

test('overlay requests neither optimistically retune nor re-push on authoritative echo; streamed feed stays streamed', async () => {
  const s = source('mods/luck/runtime/public/overlay.js');
  const block = s.slice(s.indexOf('function applySpeed(n)'), s.indexOf('// ---- auto reverse'));
  const ctx = { store: { get: () => ctx.st }, st: { match: { public: { phase: 'COMBAT' }, private: { modSpeed: 4 }, field: { local: false } } },
    requests: [], tuned: [], feeds: [], local: { speed: 8 }, curSpeed: 2, curPace: 1, serverModded: true,
    net: { request: (_t, data) => { ctx.requests.push(data); return Promise.resolve(); } }, SPEED: 'g.modSpeed',
    speedBtns: new Map(), speedPace: {}, speedBar: {}, showBar: () => true,
    isSpeed: () => true, localStorage: { setItem() {} }, SPEED_KEY: '', errText: String,
    console, __SP_RUNNER__: { retuneSpeed: n => ctx.tuned.push(n) },
    __SP_VIEW__: { raw: { setLocalFeed: o => ctx.feeds.push(o) } },
  };
  vm.createContext(ctx);
  vm.runInContext(block.replace(/function speedFlash\(ok\) \{[\s\S]*?\n\}/, 'function speedFlash() {}'), ctx);
  vm.runInContext('setSpeed(8)', ctx); assert.equal(ctx.tuned.length, 0); assert.equal(ctx.curSpeed, 2);
  vm.runInContext('renderSpeed(); renderSpeed()', ctx);
  assert.equal(ctx.requests.length, 1); assert.equal(ctx.curSpeed, 4);
  assert.equal(ctx.feeds.length, 0);
  ctx.st.match.field.local = true; ctx.st.match.private.modSpeed = 2;
  vm.runInContext('renderSpeed()', ctx); assert.equal(ctx.tuned.at(-1), 2); assert.equal(ctx.feeds.length, 1);
  ctx.net.request = () => Promise.reject(new Error('refused'));
  vm.runInContext('setSpeed(8)', ctx); await Promise.resolve();
  assert.equal(ctx.curSpeed, 2); assert.equal(ctx.tuned.at(-1), 2);
});

test('L10/L11 patch reverse/reapply is exact, nonempty and idempotently matches runtime', () => {
  for (const name of ['L10-speed-authority-server', 'L11-speed-authority-ui']) {
    const patch = JSON.parse(source('mods/luck/patches/' + name + '.patch.json'));
    const runtime = source('mods/luck/runtime/' + patch.file);
    let base = runtime;
    for (const h of [...patch.hunks].reverse()) {
      assert.ok(h.replace.length > 0, h.id);
      assert.equal(base.split(h.replace).length - 1, 1, h.id); base = base.replace(h.replace, h.find);
    }
    for (const h of patch.hunks) {
      assert.equal(base.split(h.find).length - 1, 1, h.id); base = base.replace(h.find, h.replace);
    }
    assert.equal(base, runtime);
  }
});
