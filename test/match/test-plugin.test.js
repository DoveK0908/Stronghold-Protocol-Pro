// Native room opt-in tools: virtual scheduling and FakeBattle only; no HTTP, browser or Worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, legalTileFor } from './harness.js';
import { ERR, PHASE } from '../../shared/constants.js';
import { OK } from '../../server/match/match/common.js';
import { EXPERIMENTAL_DEFAULTS } from '../../shared/experimental.js';
import { validateC2S, cultivationCharIds, loadoutOptions, MODULE_NONE } from '../../shared/protocol.js';
import { CULTIVATE_DEFAULT } from '../../shared/potential.js';
import { DiyStock } from '../../server/match/player/diy.js';
import { isTestPluginCommand, parseTestPluginArgs, TEST_PLUGIN_COMMANDS, TEST_PLUGIN_RATE_COUNT, TEST_PLUGIN_RATE_WINDOW_MS } from '../../shared/testPlugin.js';
import { wireOptions } from '../../server/match/host/proxy.js';
import { MATCH_FIELDS, PLAYER_FIELDS, snapshotMatch, restoreMatch } from '../../server/match/snapshot.js';
import { createRngFromState } from '../../server/sim/rng.js';

const enabled = { ...EXPERIMENTAL_DEFAULTS, luckConsole: true };
const request = (cmd, args) => ({ t: 'g.testPlugin', cmd, ...(args === undefined ? {} : { args }) });
const send = (h, cmd, args, id = 'p_0') => h.m.handle(id, request(cmd, args));
function prep(opts = {}) {
  return makeMatch({ mode: 'solo', fake: true, experimental: enabled, ...opts }).start().toPrep();
}
function slotsFor(ps) {
  const { chess, item } = ps.gd.shopSlots(ps.shop.level);
  const cid = ps.gd.visibleChess[0];
  const iid = Object.values(ps.gd.shopItemsByTier).flat()[0];
  return [...Array.from({ length: chess }, () => ({ kind: 'chess', id: cid })),
    ...Array.from({ length: item }, () => ({ kind: 'item', id: iid }))];
}

test('strict catalogue, bounds, extra fields and large payloads fail before IPC', () => {
  assert.deepEqual(TEST_PLUGIN_COMMANDS, ['funds', 'lp', 'chess', 'item', 'shop', 'shopSlots', 'pick', 'shopLevel', 'filter', 'map', 'bond', 'strategy', 'level', 'deployCap', 'refreshFree', 'bounty', 'wave', 'ops', 'op', 'enemies', 'boss', 'diyRefresh', 'round']);
  for (const cmd of ['speed', 'phase', 'hp', 'teamLp', 'token', 'auto', 'unit', 'diy', 'choice']) {
    assert.equal(parseTestPluginArgs(cmd, {}).error, ERR.BAD_MSG);
    assert.notEqual(validateC2S(request(cmd, {})), null);
  }
  for (const value of [1, 99999]) assert.equal(validateC2S(request('lp', { value })), null);
  for (const value of [0, -1, 100000, 1.5, Infinity, '1', null]) assert.notEqual(validateC2S(request('lp', { value })), null);
  for (const amount of [0, 99999]) assert.equal(validateC2S(request('funds', { amount })), null);
  for (const amount of [-1, 100000, 0.1]) assert.notEqual(validateC2S(request('funds', { amount })), null);
  assert.equal(validateC2S(request('level')), null);
  for (const slot of [0, 11]) assert.equal(validateC2S(request('pick', { slot, id: 'chess_1' })), null);
  for (const slot of [-1, 12, 1.5, '0']) assert.notEqual(validateC2S(request('pick', { slot, id: 'chess_1' })), null);
  for (const level of [1, 6]) assert.equal(validateC2S(request('shopLevel', { level })), null);
  for (const level of [0, 7, 2.5]) assert.notEqual(validateC2S(request('shopLevel', { level })), null);
  assert.equal(validateC2S(request('filter', { bonds: ['bond_a', 'bond_b'], mode: 'all' })), null);
  assert.equal(validateC2S(request('filter', { bonds: [] })), null);
  for (const bonds of [['bond_a', 'bad bond'], Array.from({ length: 13 }, (_, i) => `b${i}`), ['__proto__'], [1], 'bond_a']) {
    assert.notEqual(validateC2S(request('filter', { bonds })), null, JSON.stringify(bonds));
  }
  assert.deepEqual(parseTestPluginArgs('filter', { bonds: ['bond_a', 'bond_a'] }), { args: { bonds: ['bond_a'], mode: 'any' } });
  assert.notEqual(validateC2S(request('filter', { bonds: ['bond_a'], mode: 'some' })), null);
  assert.equal(validateC2S(request('map', { id: 'stage_1' })), null);
  assert.notEqual(validateC2S(request('map', { id: "stage'1" })), null);
  for (const value of [1, 12]) assert.equal(validateC2S(request('deployCap', { value })), null);
  for (const value of [0, 13, 1.5, '1', null]) assert.notEqual(validateC2S(request('deployCap', { value })), null);
  for (const count of [0, 99]) assert.equal(validateC2S(request('refreshFree', { count })), null);
  for (const count of [-1, 100, 0.5, '0', null]) assert.notEqual(validateC2S(request('refreshFree', { count })), null);
  assert.equal(validateC2S(request('bounty', { id: 'enemy_1000_gopro_2' })), null);
  for (const id of ['', 'bad id', "a'b", '__proto__', null]) assert.notEqual(validateC2S(request('bounty', { id })), null);
  assert.equal(validateC2S(request('wave', { id: 'wave_1' })), null);
  for (const id of ['', 'bad wave', "a'b", '__proto__', null]) assert.notEqual(validateC2S(request('wave', { id })), null);
  assert.equal(validateC2S(request('ops', { id: 'char_a', potential: 6 })), null);
  assert.equal(validateC2S(request('ops', { id: 'char_a', cultivate: 0 })), null);
  for (const args of [
    { id: 'char_a' }, { potential: 6 }, { id: '', potential: 6 }, { id: '__proto__', cultivate: 1 },
    { id: 'char_a', potential: 0 }, { id: 'char_a', potential: 7 }, { id: 'char_a', potential: 2.5 },
    { id: 'char_a', cultivate: -1 }, { id: 'char_a', cultivate: 4 }, { id: 'char_a', potential: 6, extra: 1 },
  ]) assert.notEqual(validateC2S(request('ops', args)), null, JSON.stringify(args));
  // `op`: every field optional but at least one must change; 潜能 1..6 and 练度 0..3 (shared/potential.js), which the
  // contract's 0..POTENTIAL_MAX / cultivate 60 examples contradict — the native tables decide.
  assert.equal(validateC2S(request('op', { id: 'chess_1', potential: 1 })), null);
  assert.equal(validateC2S(request('op', { id: 'chess_1', cultivate: 3 })), null);
  assert.equal(validateC2S(request('op', {
    id: 'chess_1', potential: 6, cultivate: 0, skillIndex: 1, moduleId: 'uniequip_2_x',
    bonds: ['bond_a'], traits: ['g_1'], stats: { atk: 999, def: 0, maxHp: 1, res: 2, aspd: 3, cost: 4 },
  })), null);
  assert.equal(validateC2S(request('op', { id: 'chess_1', moduleId: null })), null, 'null clears the module');
  assert.equal(validateC2S(request('op', { id: 'chess_1', bonds: [] })), null, 'an empty list clears the bonds');
  assert.equal(validateC2S(request('op', { id: 'chess_1', traits: [] })), null);
  for (const args of [
    { id: 'chess_1' }, { potential: 6 }, { id: '', potential: 6 }, { id: '__proto__', potential: 6 },
    { id: 'chess_1', potential: 0 }, { id: 'chess_1', potential: 7 }, { id: 'chess_1', potential: 2.5 },
    { id: 'chess_1', cultivate: -1 }, { id: 'chess_1', cultivate: 4 },
    { id: 'chess_1', skillIndex: -1 }, { id: 'chess_1', skillIndex: 9 }, { id: 'chess_1', skillIndex: 0.5 },
    { id: 'chess_1', moduleId: 'bad module' }, { id: 'chess_1', moduleId: 1 },
    { id: 'chess_1', bonds: ['bad bond'] }, { id: 'chess_1', bonds: 'bond_a' },
    { id: 'chess_1', traits: Array.from({ length: 9 }, (_, i) => `g${i}`) },
    { id: 'chess_1', stats: {} }, { id: 'chess_1', stats: { hp: 1 } }, { id: 'chess_1', stats: { atk: -1 } },
    { id: 'chess_1', stats: { atk: 100000 } }, { id: 'chess_1', stats: { atk: 1.5 } }, { id: 'chess_1', stats: { atk: 1, extra: 2 } },
    { id: 'chess_1', potential: 6, extra: 1 },
  ]) assert.notEqual(validateC2S(request('op', args)), null, JSON.stringify(args));
  // `shopSlots` takes one entry per shelf slot; `null` empties it.
  assert.equal(validateC2S(request('shopSlots', { slots: [{ kind: 'chess', id: 'chess_1' }, null] })), null);
  assert.equal(validateC2S(request('shopSlots', { slots: [null] })), null);
  for (const slots of [undefined, [], 'x', [{ kind: 'unit', id: 'chess_1' }], [{ kind: 'chess', id: 'bad id' }],
    [{ kind: 'chess', id: 'chess_1', extra: 1 }], Array(13).fill(null)]) {
    assert.notEqual(validateC2S(request('shopSlots', { slots })), null, JSON.stringify(slots));
  }
  // `enemies` and `boss`: bounded ids / counts, mode is a closed set.
  assert.equal(validateC2S(request('enemies', { mode: 'replace', list: [{ id: 'enemy_1', count: 1 }] })), null);
  assert.equal(validateC2S(request('enemies', { mode: 'append', list: [{ id: 'enemy_1', count: 20 }] })), null);
  for (const args of [
    {}, { mode: 'append' }, { mode: 'merge', list: [{ id: 'enemy_1', count: 1 }] },
    { mode: 'replace', list: [] }, { mode: 'replace', list: Array(13).fill({ id: 'enemy_1', count: 1 }) },
    { mode: 'replace', list: [{ id: 'enemy_1', count: 0 }] }, { mode: 'replace', list: [{ id: 'enemy_1', count: 21 }] },
    { mode: 'replace', list: [{ id: 'bad id', count: 1 }] }, { mode: 'replace', list: [{ id: 'enemy_1' }] },
    { mode: 'replace', list: [{ id: 'enemy_1', count: 1, extra: 1 }] },
  ]) assert.notEqual(validateC2S(request('enemies', args)), null, JSON.stringify(args));
  assert.equal(validateC2S(request('boss', { id: 'boss_1' })), null);
  for (const id of ['', 'bad boss', "a'b", '__proto__', null]) assert.notEqual(validateC2S(request('boss', { id })), null);
  // the clock tool is gone in v2
  assert.notEqual(validateC2S(request('timers', { on: false })), null);
  assert.equal(isTestPluginCommand('timers'), false);
  assert.equal(validateC2S(request('diyRefresh')), null);
  for (const args of [{ all: true }, { slot: 0 }]) assert.notEqual(validateC2S(request('diyRefresh', args)), null);
  for (const body of [
    { ...request('lp', { value: 20 }), actor: 'p_1' },
    request('lp', { value: 20, playerId: 'p_1' }),
    request('strategy', { id: 'band_bldsk', resetLp: true }),
    request('chess', { id: 'x'.repeat(100000) }),
    request('shop', { slots: Array(100000).fill({ kind: 'chess', id: 'x' }) }),
    request('shop', { slots: [{ kind: 'chess', id: 'x', extra: true }] }),
    request('level', { speed: 2 }),
    request('pick', { slot: 0, id: 'chess_1', playerId: 'p_1' }),
    request('map', { id: 'stage_1', speed: 32 }),
    request('shopLevel', { level: 2, free: true }),
    request('deployCap', { value: 3, playerId: 'p_1' }),
    request('refreshFree', { count: 2, free: true }),
    request('bounty', { id: 'enemy_1000_gopro_2', count: 5 }),
    request('wave', { id: 'wave_1', target: 'p_1' }),
  ]) assert.notEqual(validateC2S(body), null);
});

test('default-off and test-host authorization remain independent and lazy', () => {
  const h = prep({ experimental: undefined });
  assert.equal(send(h, 'funds', { amount: 555 }).error, ERR.TEST_FORBIDDEN);
  assert.equal(Object.hasOwn(h.m, '_testPlugin'), false);
  assert.equal(Object.hasOwn(h.ps('p_0').privateView(), 'testPlugin'), false);
  const normal = prep();
  assert.equal(normal.m.test, false);
  assert.equal(Object.hasOwn(normal.m, '_testPlugin'), false);
  assert.equal(normal.m.handle('p_0', { t: 'g.test', cmd: 'funds', args: { amount: 555 } }).error, ERR.TEST_FORBIDDEN);
  const local = prep({ mode: 'coop', humans: 2, test: true, experimental: undefined });
  assert.equal(local.m.handle('p_1', { t: 'g.test', cmd: 'funds', args: { amount: 555 } }).error, ERR.NOT_HOST);
  assert.equal(local.m.handle('p_0', { t: 'g.test', cmd: 'funds', args: { amount: 555 } }).ok, true);
  assert.equal(send(local, 'funds', { amount: 777 }).error, ERR.TEST_FORBIDDEN);
});

test('guest uses only own living seat; receipts, queues and two matches stay isolated', () => {
  const a = prep({ mode: 'coop', humans: 2, hostId: 'p_0' });
  const b = prep({ mode: 'coop', humans: 2 });
  const otherFunds = a.ps('p_0').funds;
  assert.equal(send(a, 'funds', { amount: 654 }, 'p_1').ok, true);
  assert.equal(a.ps('p_1').funds, 654);
  assert.equal(a.ps('p_0').funds, otherFunds);
  assert.equal(b.m.testPluginView(b.ps('p_1')).actions, 0);
  assert.equal(Object.hasOwn(b.m, '_testPlugin'), false);
  assert.deepEqual(a.ps('p_1').privateView().testPlugin, { actions: 1, last: { cmd: 'funds', ok: true }, lp: a.ps('p_1').lp, filter: null, diy: [], ops: {}, bossRaid: null });
  assert.equal(a.ps('p_0').privateView().testPlugin.actions, 0);
  assert.equal(JSON.stringify(a.m.publicView()).includes('testPlugin'), false);
  assert.equal(a.m.handle('p_1', { ...request('funds', { amount: 888 }), actor: 'p_0' }).error, ERR.BAD_MSG);
  assert.equal(a.ps('p_0').funds, otherFunds);
  assert.equal(a.ps('p_1').funds, 654);
  assert.equal(a.m.test, false);
  assert.equal(a.m._testFunds, b.m._testFunds, 'no per-instance or global helper patch');
});

test('bots, left, spectators, dead, zero LP, pending death and ended seats cannot mutate', () => {
  const h = prep({ mode: 'coop', humans: 2, bots: 1, spectators: ['watcher'] });
  assert.equal(send(h, 'funds', { amount: 999 }, 'ai_0').error, ERR.NOT_IN_ROOM);
  assert.equal(send(h, 'funds', { amount: 999 }, 'watcher').error, ERR.SPECTATOR);
  const ps = h.ps('p_0');
  for (const [key, value, error] of [['left', true, ERR.NOT_IN_ROOM], ['alive', false, ERR.ELIMINATED], ['lp', 0, ERR.ELIMINATED], ['pendingDeath', true, ERR.ELIMINATED]]) {
    const old = ps[key]; ps[key] = value;
    const funds = ps.funds;
    assert.equal(send(h, 'funds', { amount: 999 }).error, error, key);
    assert.equal(send(h, 'lp', { value: 100 }).error, error, key);
    assert.equal(ps.funds, funds);
    ps[key] = old;
  }
  h.m.ended = true;
  assert.equal(send(h, 'lp', { value: 100 }).error, ERR.WRONG_PHASE);
  assert.equal(Object.hasOwn(h.m, '_testPlugin'), false);
});

test('LP is bounded living-seat only and refuses shared LP, boss phases and live fields', () => {
  const h = prep(); const ps = h.ps('p_0');
  assert.equal(send(h, 'lp', { value: 99999 }).ok, true);
  assert.equal(ps.lp, 99999);
  assert.equal(send(h, 'lp', { value: 1 }).ok, true);
  assert.equal(ps.lp, 1);
  h.m.teamLp = 10;
  assert.equal(send(h, 'lp', { value: 100 }).error, ERR.WRONG_PHASE);
  assert.equal(h.m.teamLp, 10);
  h.m.teamLp = null;
  for (const phase of [PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE, PHASE.COMBAT, PHASE.UNITE]) {
    h.m.phase = phase;
    assert.equal(send(h, 'lp', { value: 100 }).error, ERR.WRONG_PHASE);
  }
  h.m.phase = PHASE.PREP;
  h.m.fields = [{ live: true, players: ['p_0'], fieldId: 'live' }];
  assert.equal(send(h, 'lp', { value: 100 }).error, ERR.WRONG_PHASE);
  assert.equal(ps.lp, 1);
});

test('rate is eight attempts per seat per command per 10s, not shared between matches', () => {
  const h = prep({ mode: 'coop', humans: 2 });
  const b = prep();
  assert.equal(TEST_PLUGIN_RATE_COUNT, 8);
  assert.equal(TEST_PLUGIN_RATE_WINDOW_MS, 10000);
  for (let i = 0; i < TEST_PLUGIN_RATE_COUNT; i++) assert.equal(send(h, 'funds', { amount: i }).ok, true);
  assert.equal(send(h, 'funds', { amount: 99 }).error, ERR.RATE);
  assert.equal(send(h, 'funds', { amount: 99 }, 'p_1').ok, true);
  assert.equal(send(h, 'lp', { value: 100 }).ok, true);
  assert.equal(send(b, 'funds', { amount: 99 }).ok, true);
  h.sched.advance(TEST_PLUGIN_RATE_WINDOW_MS);
  assert.equal(send(h, 'funds', { amount: 100 }).ok, true);
  const fresh = prep();
  for (let i = 0; i < TEST_PLUGIN_RATE_COUNT; i++) assert.equal(send(fresh, 'funds', { amount: -1 }).error, ERR.BAD_TARGET);
  assert.equal(send(fresh, 'funds', { amount: 100 }).error, ERR.RATE, 'refused attempts also count');
});

test('unsupported speed and oversized payloads do not change native speed flags or retain raw args', () => {
  const lines = [];
  const h = prep({ log: { info: (line) => lines.push(line) } });
  const before = [h.m.gameSpeed, h.m.timerScale, h.m.speedBoost, h.m.speedBoostPending, h.m.experimental.speedVote, h.m.test, h.m.testTimers];
  const large = 'SECRET_SENTINEL_' + 'x'.repeat(100000);
  assert.equal(send(h, 'speed', { value: 32 }).error, ERR.BAD_MSG);
  assert.equal(send(h, 'chess', { id: large }).error, ERR.BAD_TARGET);
  assert.deepEqual([h.m.gameSpeed, h.m.timerScale, h.m.speedBoost, h.m.speedBoostPending, h.m.experimental.speedVote, h.m.test, h.m.testTimers], before);
  const stored = JSON.stringify([...h.m._testPlugin].map(([id, state]) => [id, { ...state, rate: [...state.rate] }]));
  assert.equal(stored.includes('SECRET_SENTINEL_'), false);
  assert.equal(lines.join('').includes('SECRET_SENTINEL_'), false);
  assert.deepEqual(h.m.testPluginView(h.ps('p_0')).last, { cmd: 'chess', ok: false, code: ERR.BAD_TARGET });
});

test('native chess/item grants and bond layers/count run without local test mode', () => {
  const h = prep(); const ps = h.ps('p_0');
  const slots = slotsFor(ps);
  assert.equal(send(h, 'chess', { id: slots[0].id }).ok, true);
  assert.ok(ps.allChess().some((p) => p.id === slots[0].id));
  const iid = slots.find((s) => s.kind === 'item').id;
  assert.equal(send(h, 'item', { id: iid }).ok, true);
  assert.ok([...ps.hand, ...ps.temp].some((p) => p?.id === iid));
  const id = ps.gd.bondIds.find((v) => !ps.gd.modeInactiveBonds.has(v));
  const layers = (ps.layers[id] || 0) + 2;
  assert.equal(send(h, 'bond', { id, layers, count: 6 }).ok, true);
  assert.equal(ps.layers[id], layers);
  assert.equal(ps.bondCountBonus[id], 6);
  assert.equal(send(h, 'bond', { id, layers: layers - 1, count: 1 }).error, ERR.BAD_TARGET);
  assert.equal(ps.layers[id], layers);
  assert.equal(ps.bondCountBonus[id], 6);
});

test('shop requires exact native slots, stays private, blocks upgrades and consumes once on next native roll', () => {
  const h = prep({ mode: 'coop', humans: 2 }); const ps = h.ps('p_0');
  const slots = slotsFor(ps);
  assert.equal(send(h, 'shop', { slots: slots.slice(1) }).error, ERR.BAD_TARGET);
  const wrong = slots.map((s) => ({ ...s })); wrong[0].kind = 'item';
  assert.equal(send(h, 'shop', { slots: wrong }).error, ERR.BAD_TARGET);
  assert.equal(send(h, 'funds', { amount: 1000 }).ok, true);
  assert.equal(send(h, 'shop', { slots }).ok, true);
  assert.deepEqual(ps.privateView().testPlugin.shopNext, slots);
  assert.equal(Object.hasOwn(h.ps('p_1').privateView().testPlugin, 'shopNext'), false);
  assert.equal(JSON.stringify(h.m.publicView()).includes('shopNext'), false);
  assert.equal(send(h, 'level').error, ERR.WRONG_PHASE);
  const rng = h.m.rngShop.state();
  assert.equal(h.m.handle('p_0', { t: 'g.refresh' }).ok, true);
  assert.deepEqual(ps.shop.slots.map(({ kind, id }) => ({ kind, id })), slots);
  assert.equal(h.m.rngShop.state(), rng);
  assert.equal(ps._testShopNext, null);
  assert.equal(Object.hasOwn(ps.privateView().testPlugin, 'shopNext'), false);
});

test('level uses native paid upgrade gates; strategy keeps LP; round uses native quiet transition', () => {
  const h = prep(); const ps = h.ps('p_0');
  assert.equal(send(h, 'funds', { amount: 0 }).ok, true);
  assert.equal(send(h, 'level').error, ERR.NO_FUNDS);
  assert.equal(send(h, 'funds', { amount: 1000 }).ok, true);
  const level = ps.shop.level; const funds = ps.funds; const price = ps.shop.upgradePrice;
  assert.equal(send(h, 'level').ok, true);
  assert.equal(ps.shop.level, level + 1);
  assert.equal(ps.funds, funds - price);
  ps.ready = true;
  assert.equal(send(h, 'level').error, ERR.WRONG_PHASE);
  ps.ready = false;
  assert.equal(send(h, 'lp', { value: 1234 }).ok, true);
  const id = ps.gd.bandIds().find((v) => v !== ps.bandId);
  assert.equal(send(h, 'strategy', { id }).ok, true);
  assert.equal(ps.bandId, id);
  assert.equal(ps.lp, 1234);
  assert.equal(send(h, 'round', { round: 2 }).ok, true);
  assert.equal(h.m.round, 2);
});

test('round refuses pending rescue of any teammate', () => {
  const h = prep({ mode: 'coop', humans: 2 });
  h.ps('p_1').pendingDeath = true;
  const round = h.m.round;
  assert.equal(send(h, 'round', { round: round + 1 }).error, ERR.WRONG_PHASE);
  assert.equal(h.m.round, round);
  assert.equal(h.ps('p_1').alive, true);
});

test('pick places a card in an unsold native slot without buying, and honours side/phase gates', () => {
  const h = prep(); const ps = h.ps('p_0');
  const layout = ps.shop.layout;
  assert.ok(layout.chess >= 1);
  const funds = ps.funds;
  const cid = ps.shop.slots[0]?.id || ps.gd.visibleChess[0];
  assert.equal(send(h, 'pick', { slot: 0, id: cid }).ok, true);
  assert.equal(ps.shop.slots[0].id, cid);
  assert.equal(ps.shop.slots[0].kind, 'chess');
  assert.equal(ps.shop.slots[0].basePrice, ps.gd.chessPrice(cid));
  assert.equal(ps.shop.slots[0].sold, false);
  assert.equal(ps.funds, funds, 'no purchase');
  assert.equal(send(h, 'pick', { slot: 0, id: cid }).ok, true, 'unsold slots can be replaced');
  ps.shop.slots[0].sold = true;
  assert.equal(send(h, 'pick', { slot: 0, id: cid }).error, ERR.SOLD_OUT);
  ps.shop.slots[0].sold = false;
  assert.equal(send(h, 'pick', { slot: layout.chess + layout.item, id: cid }).error, ERR.BAD_TARGET);
  if (layout.item > 0) assert.equal(send(h, 'pick', { slot: layout.chess, id: cid }).error, ERR.BAD_TARGET, 'a chess id cannot fill an item slot');
  ps.ready = true;
  assert.equal(send(h, 'pick', { slot: 0, id: cid }).error, ERR.WRONG_PHASE);
  ps.ready = false;
  h.m.phase = PHASE.COMBAT;
  assert.equal(send(h, 'pick', { slot: 0, id: cid }).error, ERR.WRONG_PHASE);
});

test('shopLevel sets the level free, resizes the native layout and refuses a queued shop', () => {
  const h = prep(); const ps = h.ps('p_0');
  const funds = ps.funds; const max = ps.gd.maxShopLevel; const target = Math.min(ps.shop.level + 1, max);
  assert.equal(send(h, 'shopLevel', { level: target }).ok, true);
  assert.equal(ps.shop.level, target);
  assert.equal(ps.funds, funds, 'setting a level charges nothing');
  assert.deepEqual(ps.shop.layout, ps.gd.shopSlots(target));
  assert.equal(ps.shop.slots.length, ps.shop.layout.chess + ps.shop.layout.item);
  assert.equal(ps.shop.upgradePrice, ps.gd.upgradeBase(target) ?? 0);
  assert.equal(send(h, 'shopLevel', { level: max + 1 }).error, ERR.BAD_TARGET);
  if (ps.shop.level > 1) {
    assert.equal(send(h, 'shopLevel', { level: 1 }).ok, true);
    assert.deepEqual(ps.shop.layout, ps.gd.shopSlots(1));
    assert.equal(ps.shop.slots.length, ps.shop.layout.chess + ps.shop.layout.item);
  }
  const slots = slotsFor(ps);
  assert.equal(send(h, 'shop', { slots }).ok, true);
  const level = ps.shop.level;
  assert.equal(send(h, 'shopLevel', { level: level + 1 }).error, ERR.WRONG_PHASE);
  assert.equal(ps.shop.level, level);
});

test('filter narrows own random chess rolls, intersects on all, clears empty and stays private', () => {
  const h = prep({ mode: 'coop', humans: 2 }); const ps = h.ps('p_0');
  const bond = ps.gd.bondIds.find((b) => ps.gd.visibleChess.some((c) => (ps.gd.chess(c).bonds || []).includes(b)));
  assert.ok(bond);
  assert.equal(send(h, 'funds', { amount: 999 }).ok, true);
  assert.equal(send(h, 'filter', { bonds: [bond] }).ok, true);
  assert.deepEqual(ps.privateView().testPlugin.filter, { bonds: [bond], mode: 'any' });
  assert.equal(Object.hasOwn(h.ps('p_1').privateView().testPlugin, 'filter'), true);
  assert.equal(h.ps('p_1').privateView().testPlugin.filter, null);
  assert.equal(JSON.stringify(h.m.publicView()).includes('_testShopFilter'), false);
  for (let i = 0; i < 3; i++) {
    assert.equal(h.m.handle('p_0', { t: 'g.refresh' }).ok, true);
    for (const slot of ps.shop.slots) {
      if (!slot) continue;
      if (slot.kind === 'chess') assert.ok((ps.gd.chess(slot.id).bonds || []).includes(bond), slot.id);
      else assert.ok(ps.gd.item(slot.id));
    }
  }
  const pair = ps.gd.visibleChess.map((c) => ps.gd.chess(c).bonds || []).find((bs) => bs.length >= 2);
  assert.ok(pair, 'data has a chess with two bonds');
  assert.equal(send(h, 'filter', { bonds: pair.slice(0, 2), mode: 'all' }).ok, true);
  assert.equal(h.m.handle('p_0', { t: 'g.refresh' }).ok, true);
  assert.ok(ps.shop.slots.some((s) => s && s.kind === 'chess'), 'an intersection exists, so a slot is filled');
  for (const slot of ps.shop.slots) {
    if (!slot || slot.kind !== 'chess') continue;
    const bs = ps.gd.chess(slot.id).bonds || [];
    assert.ok(pair.slice(0, 2).every((b) => bs.includes(b)), slot.id);
  }
  assert.equal(send(h, 'filter', { bonds: [] }).ok, true);
  assert.equal(ps._testShopFilter, null);
  assert.equal(ps.privateView().testPlugin.filter, null);
});

test('map changes the room stage for every seat and refuses unknown or boss-final stages', () => {
  const h = prep({ mode: 'coop', humans: 2 });
  const other = Object.keys(h.m.gd.raw.stages).find((id) => id !== h.m.stageId);
  assert.ok(other, 'data has more than one stage');
  assert.equal(send(h, 'map', { id: 'no_such_stage' }).error, ERR.BAD_TARGET);
  assert.equal(send(h, 'map', { id: other }).ok, true);
  assert.equal(h.m.stageId, other);
  assert.equal(h.m.publicView().stageId, other);
  assert.equal(h.m.stage, h.m.gd.stage(other));
  const boss = prep();
  boss.m.round = boss.m.gd.bossRound;
  const alt = Object.keys(boss.m.gd.raw.stages).find((id) => id !== boss.m.stageId);
  assert.equal(send(boss, 'map', { id: alt }).error, ERR.WRONG_PHASE);
  assert.notEqual(boss.m.stageId, alt);
});

test('deployCap raises only the own seat floor, never lowers it and moves no piece', () => {
  const h = prep({ mode: 'coop', humans: 2 });
  const ps = h.ps('p_0'); const other = h.ps('p_1');
  const deployed = ps.deployCount; const otherFloor = other.deployCapMin;
  assert.equal(send(h, 'deployCap', { value: 3 }).ok, true);
  assert.equal(ps.deployCapMin, 3);
  assert.equal(ps.deployCap, Math.max(1, ps.gd.deployCap + ps.deployCapBonus, 3));
  assert.equal(other.deployCapMin, otherFloor, 'the teammate keeps its own floor');
  assert.equal(ps.deployCount, deployed, 'no piece is placed or removed');
  assert.equal(send(h, 'deployCap', { value: 1 }).ok, true, 'a lower value is accepted but ignored');
  assert.equal(ps.deployCapMin, 3);
  assert.equal(send(h, 'deployCap', { value: 13 }).error, ERR.BAD_TARGET);
  assert.equal(send(h, 'deployCap', { value: 0 }).error, ERR.BAD_TARGET);
  assert.equal(ps.deployCapMin, 3);
});

test('refreshFree sets the own counter and the native refresh spends the free one first', () => {
  const h = prep(); const ps = h.ps('p_0');
  assert.equal(send(h, 'refreshFree', { count: 2 }).ok, true);
  assert.equal(ps.shop.freeRefreshes, 2);
  const funds = ps.funds;
  assert.equal(ps.refresh().ok, true, 'native refresh accepts the free one');
  assert.equal(ps.shop.freeRefreshes, 1);
  assert.equal(ps.funds, funds, 'a free refresh costs nothing');
  assert.equal(send(h, 'refreshFree', { count: 0 }).ok, true);
  assert.equal(ps.shop.freeRefreshes, 0);
  ps.funds = ps.gd.refreshPrice + 5;
  const before = ps.funds;
  assert.equal(ps.refresh().ok, true);
  assert.equal(ps.funds, before - ps.gd.refreshPrice, 'paid refreshes keep the native price');
  assert.equal(send(h, 'refreshFree', { count: 100 }).error, ERR.BAD_TARGET);
  assert.equal(send(h, 'refreshFree', { count: -1 }).error, ERR.BAD_TARGET);
});

test('bounty adds an own-seat native bounty on a live enemy and refuses the rest', () => {
  const h = prep({ mode: 'coop', humans: 2 });
  const ps = h.ps('p_0'); const other = h.ps('p_1');
  const live = Object.keys(ps.gd.raw.enemies).filter((id) => !ps.gd.inactiveEnemies.has(id));
  assert.ok(live.length > 0, 'data has a live enemy');
  const count = ps.bounties.length; const otherCount = other.bounties.length;
  assert.equal(send(h, 'bounty', { id: live[0] }).ok, true);
  assert.equal(ps.bounties.length, count + 1);
  const added = ps.bounties.at(-1);
  assert.equal(added.card.enemyKey, live[0]);
  assert.equal(added.card.payout, 'kill');
  assert.equal(added.card.coin, 0);
  assert.equal(added.roundsLeft, added.card.rounds);
  assert.equal(other.bounties.length, otherCount, 'the teammate gets no bounty');
  assert.equal(send(h, 'bounty', { id: 'no_such_enemy' }).error, ERR.BAD_TARGET);
  assert.equal(ps.bounties.length, count + 1);
  ps.gd.inactiveEnemies.add(live[0]);
  assert.equal(send(h, 'bounty', { id: live[0] }).error, ERR.BAD_TARGET, 'an inactive enemy is not bounty-able');
  ps.gd.inactiveEnemies.delete(live[0]);
  assert.equal(ps.bounties.length, count + 1);
});

test('wave swaps the round enemy template in place and keeps the drawn pick', () => {
  const h = prep(); const ps = h.ps('p_0'); const m = h.m;
  const cur = m.wave;
  assert.ok(cur && cur.templateId, 'the prep round already holds a wave');
  const normal = Object.entries(ps.gd.raw.waves).filter(([, t]) => t && t.kind === 'normal' && !t.bossId).map(([id]) => id);
  assert.ok(normal.length > 0, 'data has normal wave templates');
  const target = normal.find((id) => id !== cur.templateId);
  assert.ok(target, 'data has a second normal template');
  const expected = m.isSolo && !/_s$/.test(target) && ps.gd.wave(`${target}_s`) ? `${target}_s` : target;
  assert.equal(send(h, 'wave', { id: target }).ok, true);
  assert.equal(m.wave.templateId, expected);
  assert.notEqual(m.wave, cur, 'a rebuilt wave replaces the old one');
  assert.equal(m.wave.pick, cur.pick, 'the round pick is reused, so no extra random draw');
  assert.ok(Array.isArray(m.wave.spawns) && Array.isArray(m.wave.routes));
  assert.equal(send(h, 'wave', { id: 'no_such_wave' }).error, ERR.BAD_TARGET);
  assert.equal(m.wave.templateId, expected, 'a refused id leaves the swapped wave in place');
  const boss = Object.entries(ps.gd.raw.waves).find(([, t]) => t && t.bossId);
  if (boss) assert.equal(send(h, 'wave', { id: boss[0] }).error, ERR.BAD_TARGET, 'a boss template is not a normal wave');
  const kept = m.wave;
  m.wave = null; // the boss / hidden rounds compose their field through buildBossWave instead
  assert.equal(send(h, 'wave', { id: target }).error, ERR.WRONG_PHASE);
  m.wave = kept;
});

test('ops sets 潜能/练度 for one operator without charging funds or touching the teammate', () => {
  const h = prep({ mode: 'coop', humans: 2 }); const ps = h.ps('p_0'); const other = h.ps('p_1');
  const ids = [...cultivationCharIds(ps.gd.raw.chess, ps.gd.raw.backups)];
  assert.ok(ids.length > 0, 'data has a cultivation-capable operator');
  const id = ids[0];
  const funds = ps.funds;
  assert.equal(send(h, 'ops', { id, potential: 6 }).ok, true);
  assert.deepEqual(ps.ops[id], { potential: 6, cultivate: CULTIVATE_DEFAULT });
  assert.equal(ps.funds, funds, 'raising potential never charges');
  assert.equal(other.ops[id], undefined, 'the teammate keeps its own 潜能 table');
  assert.equal(send(h, 'ops', { id, cultivate: 0 }).ok, true);
  assert.deepEqual(ps.ops[id], { potential: 6, cultivate: 0 }, 'the untouched field is kept');
  assert.equal(send(h, 'ops', { id: 'no_such_char', potential: 6 }).error, ERR.BAD_TARGET);
  assert.deepEqual(ps.ops[id], { potential: 6, cultivate: 0 });
});

test('shopSlots rewrites the current shelf slot by slot, allows empty slots and never charges', () => {
  const h = prep({ mode: 'coop', humans: 2 }); const ps = h.ps('p_0'); const other = h.ps('p_1');
  const layout = ps.shop.layout;
  const cid = ps.gd.visibleChess[0];
  const iid = Object.values(ps.gd.shopItemsByTier).flat()[0];
  const slots = [
    ...Array.from({ length: layout.chess }, (_, i) => (i === 0 ? { kind: 'chess', id: cid } : null)),
    ...Array.from({ length: layout.item }, () => ({ kind: 'item', id: iid })),
  ];
  const funds = ps.funds;
  assert.equal(send(h, 'shopSlots', { slots: slots.slice(1) }).error, ERR.BAD_TARGET, 'one entry per shelf slot');
  const wrong = slots.slice(); wrong[0] = { kind: 'item', id: iid };
  assert.equal(send(h, 'shopSlots', { slots: wrong }).error, ERR.BAD_TARGET, 'the slot position decides the kind');
  assert.equal(send(h, 'shopSlots', { slots: slots.map(() => ({ kind: 'chess', id: 'no_such_chess' })) }).error, ERR.BAD_TARGET);
  assert.equal(send(h, 'shopSlots', { slots }).ok, true);
  assert.equal(ps.shop.slots[0].id, cid);
  assert.equal(ps.shop.slots[0].kind, 'chess');
  assert.equal(ps.shop.slots[0].basePrice, ps.gd.chessPrice(cid));
  assert.equal(ps.shop.slots[0].frozen, false);
  assert.equal(ps.shop.slots[0].sold, false);
  assert.equal(ps.shop.slots[1], null, 'null empties the slot');
  if (layout.item > 0) assert.equal(ps.shop.slots[layout.chess].kind, 'item');
  assert.equal(ps.funds, funds, 'rewriting the shelf charges nothing');
  assert.deepEqual(ps.shop.layout, { chess: layout.chess, item: layout.item });
  assert.equal(ps.privateView().testPlugin.actions, 1);
  assert.equal(other.privateView().testPlugin.actions, 0, 'the teammate is not charged an action');
  ps.ready = true;
  assert.equal(send(h, 'shopSlots', { slots }).error, ERR.WRONG_PHASE);
  ps.ready = false;
  h.m.phase = PHASE.COMBAT;
  assert.equal(send(h, 'shopSlots', { slots }).error, ERR.WRONG_PHASE);
  h.m.phase = PHASE.PREP;
  // a queued next-roll shelf is untouched: this command writes the shelf players see now
  const full = slotsFor(ps);
  assert.equal(send(h, 'shop', { slots: full }).ok, true);
  assert.deepEqual(ps._testShopNext, full);
  assert.equal(send(h, 'shopSlots', { slots }).ok, true);
  assert.deepEqual(ps._testShopNext, full, 'the queue is not consumed');
  assert.equal(Object.hasOwn(other.privateView().testPlugin, 'shopNext'), false);
});

test('op overrides one own piece by chessId, merges fields and reaches the battle input', () => {
  const h = prep({ mode: 'coop', humans: 2 }); const ps = h.ps('p_0'); const other = h.ps('p_1');
  const cid = ps.gd.visibleChess.find((id) => {
    const r = ps.gd.chess(id);
    return r && Array.isArray(r.skills) && r.skills.length > 1;
  });
  assert.ok(cid, 'data has an operator with two skills');
  const rec = ps.gd.chess(cid);
  assert.equal(send(h, 'op', { id: cid, potential: 1 }).error, ERR.BAD_TARGET, 'the seat must hold the piece');
  assert.equal(send(h, 'chess', { id: cid }).ok, true);
  const piece = ps.allChess().find((p) => p.id === cid);
  assert.ok(piece);
  const funds = ps.funds;
  assert.equal(send(h, 'op', { id: cid, potential: 1, cultivate: 0 }).ok, true);
  assert.deepEqual(ps._testOps[cid], { potential: 1, cultivate: 0 });
  assert.equal(ps.funds, funds, 'an override charges nothing');
  if (rec.charId) assert.deepEqual(ps.ops[rec.charId], { potential: 1, cultivate: 0 }, 'the native charId-level 潜能/练度 follows');
  assert.equal(other._testOps, undefined, 'the teammate keeps its own override table');
  // the native 干员调配 set (loadoutOptions): the record's skills, and the elite's modules + MODULE_NONE
  const golden = rec.goldenId ? ps.gd.chess(rec.goldenId) : null;
  assert.ok(golden, 'a visible operator has an elite record');
  const opt = loadoutOptions(rec, golden);
  assert.ok(opt.skills.length > 0);
  const skillIndex = opt.skills[opt.skills.length - 1];
  const moduleId = opt.modules.find((id) => id !== MODULE_NONE);
  assert.ok(moduleId, 'the elite offers a module');
  const bond = ps.gd.bondIds[0];
  const garrison = rec.garrisonIds[0];
  assert.ok(garrison, 'the record has a 特质');
  assert.equal(send(h, 'op', { id: cid, skillIndex, moduleId, bonds: [bond], traits: [garrison], stats: { atk: 10, def: 20 } }).ok, true);
  assert.equal(ps._testOps[cid].moduleId, moduleId);
  assert.deepEqual(ps._testOps[cid], { potential: 1, cultivate: 0, skillIndex, moduleId, bonds: [bond], traits: [garrison], stats: { atk: 10, def: 20 } });
  assert.equal(send(h, 'op', { id: cid, stats: { atk: 30 } }).ok, true);
  assert.deepEqual(ps._testOps[cid].stats, { atk: 30, def: 20 }, 'stats merge key by key');
  assert.deepEqual(ps.garrisonIdsFor(piece), [garrison], 'the trait override drives the prep effect pass');
  assert.equal(send(h, 'op', { id: cid, traits: [] }).ok, true);
  assert.deepEqual(ps.garrisonIdsFor(piece), [], 'an empty traits list clears them');
  assert.equal(send(h, 'op', { id: cid, bonds: [] }).ok, true);
  // the refusals run in their own match so the per-command rate window stays out of the way
  const bad = prep();
  assert.equal(send(bad, 'op', { id: 'no_such_chess', potential: 1 }).error, ERR.BAD_TARGET);
  assert.equal(send(bad, 'chess', { id: cid }).ok, true);
  assert.equal(send(bad, 'op', { id: cid, skillIndex: 8 }).error, ERR.BAD_TARGET, 'a skill the loadout does not offer');
  assert.equal(send(bad, 'op', { id: cid, moduleId: 'no_such_module' }).error, ERR.BAD_TARGET);
  assert.equal(send(bad, 'op', { id: cid, bonds: ['no_such_bond'] }).error, ERR.BAD_TARGET);
  assert.equal(send(bad, 'op', { id: cid, traits: ['no_such_garrison'] }).error, ERR.BAD_TARGET);
  const [row, col] = legalTileFor(h.m, ps, cid);
  assert.deepEqual(h.m.handle('p_0', { t: 'g.move', uid: piece.uid, to: { area: 'board', row, col } }), OK);
  const u = ps.battleInput({ side: 'L' }).units.find((x) => x.chessId === cid);
  assert.ok(u, 'the overridden piece is in the battle input');
  assert.deepEqual(u.testStats, { atk: 30, def: 20 });
  assert.deepEqual(u.testTraits, [], 'an empty list is passed on as itself');
  assert.deepEqual(u.testBonds, []);
  assert.equal(u.skillIndex, skillIndex);
  assert.equal(u.moduleId, moduleId, 'the chosen module reaches the battle input');
  assert.equal(u.potential, 1);
  assert.equal(u.cultivate, 0);
  // moduleId semantics: 'none' removes the module (the elite exists), null restores the loadout default
  assert.equal(send(h, 'op', { id: cid, moduleId: MODULE_NONE }).ok, true);
  assert.equal(ps._testOps[cid].moduleId, MODULE_NONE, 'none removes the module');
  assert.equal(send(h, 'op', { id: cid, moduleId: null }).ok, true);
  assert.equal(ps._testOps[cid].moduleId, null, 'null restores the default module');
});

test('enemies rewrites or appends the current round wave with this round scale and no random draw', () => {
  const h = prep(); const m = h.m;
  const live = Object.keys(m.gd.raw.enemies).filter((id) => !m.gd.inactiveEnemies.has(id));
  assert.ok(live.length >= 2, 'data has two live enemies');
  const cur = m.wave;
  assert.ok(cur && Array.isArray(cur.spawns), 'the prep round already holds a wave');
  const templateId = cur.templateId;
  const rng = m.rngWaves.state();
  assert.equal(send(h, 'enemies', { mode: 'replace', list: [{ id: live[0], count: 2 }, { id: live[1], count: 1 }] }).ok, true);
  assert.equal(m.wave, cur, 'the wave object is rewritten in place');
  assert.equal(m.wave.templateId, templateId, 'the drawn template id stays');
  assert.equal(m.wave.spawns.length, 2);
  const [a, b] = m.wave.spawns;
  assert.equal(a.enemyKey, live[0]); assert.equal(a.count, 2); assert.equal(a.interval, 1);
  assert.equal(b.enemyKey, live[1]); assert.equal(b.count, 1); assert.equal(b.interval, 0);
  assert.ok(b.time > a.time, 'each item starts after the previous one');
  assert.equal(a.routeIndex, 0);
  assert.equal(a.actionIndex, 0);
  assert.equal(b.actionIndex, 1);
  assert.ok(a.mods && typeof a.mods.hpMul === 'number', 'this round scale rides the spawn');
  assert.ok(a.preview && typeof a.preview.gate === 'string', 'the client preview is filled');
  assert.equal(m.rngWaves.state(), rng, 'no random draw');
  const before = m.wave.spawns.length; const last = Math.max(...m.wave.spawns.map((s) => s.time));
  assert.equal(send(h, 'enemies', { mode: 'append', list: [{ id: live[0], count: 1 }] }).ok, true);
  assert.equal(m.wave.spawns.length, before + 1);
  assert.ok(m.wave.spawns.at(-1).time >= last + 2, 'an append starts two seconds after the last existing spawn');
  assert.equal(m.wave.spawns.at(-1).actionIndex, 2);
  assert.equal(send(h, 'enemies', { mode: 'replace', list: [{ id: 'no_such_enemy', count: 1 }] }).error, ERR.BAD_TARGET);
  m.gd.inactiveEnemies.add(live[0]);
  assert.equal(send(h, 'enemies', { mode: 'replace', list: [{ id: live[0], count: 1 }] }).error, ERR.BAD_TARGET);
  m.gd.inactiveEnemies.delete(live[0]);
  const kept = m.wave;
  m.wave = null;
  assert.equal(send(h, 'enemies', { mode: 'replace', list: [{ id: live[0], count: 1 }] }).error, ERR.WRONG_PHASE);
  m.wave = kept;
  const round = m.round;
  m.round = m.gd.bossRound;
  assert.equal(send(h, 'enemies', { mode: 'replace', list: [{ id: live[0], count: 1 }] }).error, ERR.WRONG_PHASE, 'a boss round is planned separately');
  m.round = round;
  m.phase = PHASE.COMBAT;
  assert.equal(send(h, 'enemies', { mode: 'replace', list: [{ id: live[0], count: 1 }] }).error, ERR.WRONG_PHASE);
  m.phase = PHASE.PREP;
});

test('boss starts a raid on the chosen leader and a victory returns to the round before it', () => {
  const h = prep(); const m = h.m;
  const bosses = Object.entries(m.gd.raw.bosses);
  const normal = bosses.find(([, b]) => b && b.hidden !== true);
  assert.ok(normal && m.gd.bossRound > 1, 'data has a normal leader and a boss round');
  assert.equal(send(h, 'boss', { id: 'no_such_boss' }).error, ERR.BAD_TARGET);
  assert.equal(send(h, 'boss', { id: normal[0] }).ok, true);
  const bossRound = m.gd.bossRound;
  assert.deepEqual(m._testBossRaid, { bossId: normal[0], hidden: false, round: bossRound, returnRound: Math.max(1, bossRound - 1) });
  assert.equal(m.bossId, normal[0]);
  assert.equal(m.round, bossRound, 'the raid jumps to the leader round');
  // the victory branch of bossRounds._finishFinal hands the match back instead of finishing it
  m.phase = PHASE.FINAL_ASSAULT;
  m.fields = [];
  m.bossPool = { hp: 0 };
  m._finalEnding = null;
  m._finishFinal(false, () => null);
  assert.equal(m._testBossRaid, null);
  assert.equal(m.bossId, null);
  assert.equal(m.round, Math.max(1, bossRound - 1), 'back to the round before the raid');
  assert.equal(m.ended, false, 'the match is not finished');
  assert.notEqual(m.phase, PHASE.RESULT);
  // a mode with a separate hidden core fields the chosen hidden leader there
  const hiddenBoss = bosses.find(([, b]) => b && b.hidden === true);
  const hiddenRound = m.gd.hiddenRound;
  if (hiddenBoss && hiddenRound) {
    assert.equal(send(h, 'boss', { id: hiddenBoss[0] }).ok, true);
    assert.deepEqual(m._testBossRaid, { bossId: hiddenBoss[0], hidden: true, round: hiddenRound,
      returnRound: Math.max(1, Math.min(hiddenRound - 1, m.gd.bossRound - 1)) });
    assert.equal(m.hiddenBossId, hiddenBoss[0]);
    assert.equal(m.round, hiddenRound);
  }
});

test('checkpoint saves the per-chessId override table and the raid mark', () => {
  const h = prep(); const ps = h.ps('p_0');
  const cid = ps.gd.visibleChess[0];
  assert.equal(send(h, 'chess', { id: cid }).ok, true);
  assert.equal(send(h, 'op', { id: cid, potential: 1, traits: [] }).ok, true);
  assert.ok(PLAYER_FIELDS.saved.includes('_testOps'));
  // the raid mark is taken in the boss round's own PREP, so its checkpoint must bring it back (snapshot.test.js
  // covers the full round trip and the shape check)
  assert.ok(MATCH_FIELDS.saved.includes('_testBossRaid'));
  assert.equal(MATCH_FIELDS.transient.includes('_testBossRaid'), false);
  const raid = { bossId: 'boss_1', hidden: false, round: 3, returnRound: 2 };
  h.m._testBossRaid = { ...raid };
  const doc = JSON.parse(JSON.stringify(snapshotMatch(h.m)));
  assert.equal(Object.hasOwn(doc.match, '_testBossRaid'), true);
  const r = makeMatch({ mode: doc.mode, difficulty: doc.difficulty, seats: doc.seats, seed: doc.seed, fake: true, experimental: doc.experimental });
  assert.equal(restoreMatch(r.m, doc, { createRngFromState }), true);
  assert.deepEqual(r.ps('p_0')._testOps[cid], { potential: 1, traits: [] });
  assert.deepEqual(r.m._testBossRaid, raid);
  assert.equal(r.ps('p_0').privateView().testPlugin.ops[cid].potential, 1);
  assert.deepEqual(r.ps('p_0').privateView().testPlugin.bossRaid, raid);
});

test('diyRefresh refills only the requesting seat 自选 stock', () => {
  const h = prep({ mode: 'coop', humans: 2 }); const ps = h.ps('p_0'); const other = h.ps('p_1');
  assert.equal(send(h, 'diyRefresh').error, ERR.BAD_TARGET, 'a vanilla seat has no 自选 stock');
  const stock = (rows) => {
    const s = new DiyStock();
    for (const [id, e] of rows) s.entries.set(id, { ...e });
    return s;
  };
  ps.diyStock = stock([['diy_a', { cap: 3, left: 0, tier: 1, shopLevel: 1 }], ['diy_b', { cap: 1, left: 1, tier: 1, shopLevel: 1 }]]);
  other.diyStock = stock([['diy_c', { cap: 2, left: 0, tier: 1, shopLevel: 1 }]]);
  assert.equal(send(h, 'diyRefresh').ok, true);
  assert.equal(ps.diyStock.entries.get('diy_a').left, 3);
  assert.equal(ps.diyStock.entries.get('diy_b').left, 1);
  assert.equal(other.diyStock.entries.get('diy_c').left, 0, 'the teammate keeps its own stock');
  assert.deepEqual(ps.privateView().testPlugin.diy, [{ id: 'diy_a', left: 3, cap: 3 }, { id: 'diy_b', left: 1, cap: 1 }]);
  assert.deepEqual(other.privateView().testPlugin.diy, [{ id: 'diy_c', left: 0, cap: 2 }]);
});

test('checkpoint saves validated next-shop queue but drops receipts/rate/actions and never replays commands', () => {
  const h = prep(); const ps = h.ps('p_0');
  const slots = slotsFor(ps);
  assert.equal(send(h, 'funds', { amount: 1234 }).ok, true);
  assert.equal(send(h, 'shop', { slots }).ok, true);
  const bid = ps.gd.bondIds[0];
  assert.equal(send(h, 'filter', { bonds: [bid] }).ok, true);
  assert.ok(MATCH_FIELDS.transient.includes('_testPlugin'));
  assert.ok(PLAYER_FIELDS.saved.includes('_testShopNext'));
  assert.ok(PLAYER_FIELDS.saved.includes('_testShopFilter'));
  const doc = JSON.parse(JSON.stringify(snapshotMatch(h.m)));
  assert.ok(doc);
  assert.equal(Object.hasOwn(doc.match, '_testPlugin'), false);
  const r = makeMatch({ mode: doc.mode, difficulty: doc.difficulty, seats: doc.seats, seed: doc.seed, fake: true, experimental: doc.experimental });
  assert.equal(restoreMatch(r.m, doc, { createRngFromState }), true);
  assert.equal(Object.hasOwn(r.m, '_testPlugin'), false);
  assert.deepEqual(r.ps('p_0')._testShopNext, slots);
  assert.deepEqual(r.ps('p_0')._testShopFilter, { bonds: [bid], mode: 'any' });
  assert.deepEqual(r.ps('p_0').privateView().testPlugin.filter, { bonds: [bid], mode: 'any' });
  assert.equal(r.ps('p_0').funds, 1234);
  assert.equal(r.ps('p_0').privateView().testPlugin.actions, 0);
  assert.equal(r.ps('p_0').privateView().testPlugin.last, null);
  assert.equal(r.m.handle('p_0', { t: 'g.refresh' }).ok, true);
  assert.equal(r.ps('p_0')._testShopNext, null);
  assert.deepEqual(r.ps('p_0').shop.slots.map(({ kind, id }) => ({ kind, id })), slots);
});

test('worker options forward only explicitly true luckConsole as fresh JSON-safe data', () => {
  const base = { roomCode: 'ROOM', seed: 9, seats: [] };
  const cyclic = {}; cyclic.self = cyclic;
  for (const experimental of [undefined, {}, { luckConsole: false }, { luckConsole: 1 }]) {
    assert.deepEqual(wireOptions({ ...base, experimental }), base);
  }
  const source = { luckConsole: true, speedVote: false, callback() {}, cyclic };
  const out = wireOptions({ ...base, experimental: source });
  assert.deepEqual(out, { ...base, experimental: enabled });
  assert.notEqual(out.experimental, source);
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
  assert.equal(Object.hasOwn(out, 'test'), false);
  const workerMatch = prep({ experimental: JSON.parse(JSON.stringify(out.experimental)) });
  assert.equal(send(workerMatch, 'funds', { amount: 4321 }).ok, true, 'worker constructor accepts forwarded gate');
  assert.equal(workerMatch.m.test, false);
  assert.deepEqual(wireOptions({ ...base, test: true, hostId: 'p_0', experimental: source }), { ...base, test: true, hostId: 'p_0', experimental: enabled });
});
