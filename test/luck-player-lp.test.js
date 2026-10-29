// Explicit in-process backend checks only: no listener, browser, Worker or child process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Match } from '../server/match/Match.js';
import { PlayerState } from '../server/match/PlayerState.js';
import { C2S, validateC2S } from '../shared/protocol.js';
import { ERR, PHASE } from '../shared/constants.js';
import { installServerPatch, TESTLP_TYPE, FEATURE_KEYS } from '../mods/luck/runtime/src/server-patch.mjs';

// Keep the private-view base minimal; the real installed Luck wrapper still builds its snapshot.
PlayerState.prototype.privateView = function () { return {}; };
const root = fileURLToPath(new URL('../', import.meta.url));
const quiet = { info() {}, warn() {} };
await installServerPatch(root, quiet, { record: false });

function fixture() {
  const m = {
    experimental: { luckConsole: true }, phase: PHASE.PREP, teamLp: null,
    players: new Map(), spectators: new Map(), battlePrefix: 'lp-fixture',
    gd: {}, round: 1, dirtyCount: 0, flushCount: 0,
    publicCount: 0,
    markPublic() { this.publicCount++; },
    flush() { this.flushCount++; },
  };
  const ps = {
    playerId: 'own', m, alive: true, pendingDeath: false, revived: false, lp: 20,
    funds: 123, board: new Map([['unit', { hp: 456 }]]),
    dirty() { m.dirtyCount++; },
  };
  const other = { playerId: 'other', alive: true, lp: 33 };
  m.players.set('own', ps);
  m.players.set('other', other);
  const send = (msg, id = 'own') => Match.prototype.handle.call(m, id, { t: TESTLP_TYPE, ...msg });
  return { m, ps, other, send };
}

test('LP intent is registered with strict positive bounds', () => {
  assert.ok(FEATURE_KEYS.includes('testLp'));
  for (const lp of [1, 20, 99999]) assert.equal(C2S[TESTLP_TYPE].lp(lp), true);
  for (const lp of [undefined, null, '20', true, 0, -1, 1.5, 100000, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.equal(C2S[TESTLP_TYPE].lp(lp), false);
    assert.equal(validateC2S({ t: TESTLP_TYPE, lp }), 'bad field lp');
  }
});

test('LP sets only the actor current life, including lowering; dirty/flush publishes it', () => {
  const { m, ps, other, send } = fixture();
  for (const lp of [99999, 1, 17]) assert.deepEqual(send({ lp }), { ok: true, lp });
  assert.equal(ps.lp, 17);
  assert.equal(other.lp, 33);
  assert.equal(ps.funds, 123);
  assert.equal(ps.board.get('unit').hp, 456);
  assert.equal(ps.alive, true);
  assert.equal(ps.revived, false);
  assert.equal(m.dirtyCount, 3);
  assert.equal(m.publicCount, 3);
  assert.equal(m.flushCount, 3);
});

test('direct routing also rejects invalid LP without mutating or publishing', () => {
  for (const lp of [undefined, null, '20', true, 0, -1, 1.5, 100000, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    const { m, ps, send } = fixture();
    assert.equal(send({ lp }).error, ERR.BAD_TARGET);
    assert.equal(ps.lp, 20);
    assert.equal(m.dirtyCount, 0);
    assert.equal(m.flushCount, 0);
  }
});

test('experimental flag and existing seat authority remain mandatory', () => {
  const cases = [
    [({ m }) => { m.experimental = {}; }, ERR.BAD_TARGET],
    [({ ps }) => { ps.isBot = true; }, 'NOT_IN_ROOM'],
    [({ ps }) => { ps.left = true; }, 'NOT_IN_ROOM'],
    [({ ps }) => { ps.spectator = true; }, 'SPECTATOR'],
    [({ m }) => { m.disposed = true; }, 'WRONG_PHASE'],
    [({ m }) => { m.ended = true; }, 'WRONG_PHASE'],
  ];
  for (const [change, error] of cases) {
    const f = fixture(); change(f);
    assert.equal(f.send({ lp: 10 }).error, error);
    assert.equal(f.ps.lp, 20);
    assert.equal(f.m.flushCount, 0);
  }
  assert.equal(fixture().send({ lp: 10 }, 'unknown').error, 'NOT_IN_ROOM');
});

test('dead, pending rescue and zero-LP awaiting settlement are never revived', () => {
  for (const flags of [
    { alive: false, lp: 0 },
    { alive: false, pendingDeath: true, lp: 0 },
    { alive: true, pendingDeath: true },
    { alive: true, lp: 0 },
    { alive: false, revived: true, lp: 0 },
  ]) {
    const f = fixture(); Object.assign(f.ps, flags);
    const before = { lp: f.ps.lp, alive: f.ps.alive, pendingDeath: f.ps.pendingDeath, revived: f.ps.revived };
    assert.equal(f.send({ lp: 10 }).error, ERR.BAD_TARGET);
    assert.deepEqual({ lp: f.ps.lp, alive: f.ps.alive, pendingDeath: f.ps.pendingDeath, revived: f.ps.revived }, before);
    assert.equal(f.m.flushCount, 0);
  }
  const f = fixture(); f.ps.revived = true;
  assert.equal(f.send({ lp: 10 }).ok, true, 'already rescued living player may adjust LP without resetting rescue usage');
  assert.equal(f.ps.revived, true);
});

test('shared team LP and invalid personal phases are refused', () => {
  for (const phase of [PHASE.LOBBY, PHASE.RESULT, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE]) {
    const f = fixture(); f.m.phase = phase;
    assert.equal(f.send({ lp: 10 }).error, ERR.WRONG_PHASE);
    assert.equal(f.ps.lp, 20);
  }
  for (const teamLp of [0, 90]) {
    const f = fixture(); f.m.teamLp = teamLp;
    assert.equal(f.send({ lp: 10 }).error, ERR.WRONG_PHASE);
    assert.equal(f.m.teamLp, teamLp);
    assert.equal(f.ps.lp, 20);
  }
});

test('testLp master switch rejects further writes without undoing current LP', () => {
  const f = fixture();
  assert.equal(f.send({ lp: 12 }).ok, true);
  const enable = features => Match.prototype.handle.call(f.m, 'own', { t: 'g.modEnable', features });
  assert.equal(enable({ testLp: false }).ok, true);
  assert.equal(f.send({ lp: 13 }).error, ERR.BAD_TARGET);
  assert.equal(f.ps.lp, 12);
  assert.equal(enable({ testLp: true }).ok, true);
  assert.equal(f.send({ lp: 13 }).ok, true);
});

test('backend overlay hunks exactly match the shipped runtime and reverse/reapply cleanly', () => {
  const patch = JSON.parse(fs.readFileSync(new URL('../mods/luck/patches/L8-player-lp-server.patch.json', import.meta.url), 'utf8'));
  const runtime = fs.readFileSync(new URL('../mods/luck/runtime/src/server-patch.mjs', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  let base = runtime;
  for (const h of [...patch.hunks].reverse()) {
    assert.equal(base.split(h.replace).length - 1, 1, h.id);
    base = base.replace(h.replace, h.find);
  }
  for (const h of patch.hunks) {
    assert.equal(base.split(h.find).length - 1, 1, h.id);
    base = base.replace(h.find, h.replace);
  }
  assert.equal(base, runtime);
});

test('private Luck snapshot reads this seat actual current LP, not a process-global last write', () => {
  const f = fixture();
  assert.equal(f.send({ lp: 25 }).ok, true);
  const view = () => PlayerState.prototype.privateView.call(f.ps);
  assert.equal(view().modSandbox.test.lp, 25);
  f.ps.lp = 19; // ordinary authoritative leak/settlement update
  assert.equal(view().modSandbox.test.lp, 19);
  f.ps.lp = 0; f.ps.alive = false; f.ps.pendingDeath = true;
  assert.equal(view().modSandbox.test.lp, 0);
});
