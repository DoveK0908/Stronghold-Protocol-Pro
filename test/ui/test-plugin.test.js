// In-process input/visibility contracts only: no browser, server, timers or sockets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  testPluginAvailable, testPluginInput, slotKindAt, slotEntries, withSlot, queueArgs, queuedSlots,
  enemiesArgs, opArgs, clampShopLevel, bossJump, roundMax, itemOf, chessOf, MODULE_NONE,
} from '../../public/js/ui/testPluginModel.js';
import { parseTestPluginArgs } from '../../shared/testPlugin.js';

const pub = { experimental: { luckConsole: true }, phase: 'PREP', players: [{ playerId: 'p' }] };
const mine = { playerId: 'p', alive: true, lp: 10, testPlugin: { actions: 0, last: null } };

const slot = (kind, id, sold = false) => ({ kind, id, price: 3, basePrice: 3, sold, frozen: false });

test('plugin requires enabled own living human view, not a scouted or spectator view', () => {
  assert.equal(testPluginAvailable(pub, mine, 'p'), true);
  for (const state of [null, { ...pub, experimental: {} }, { ...pub, phase: 'RESULT' }, { ...pub, ended: true }, { ...pub, players: [] }, { ...pub, players: [{ playerId: 'p', isBot: true }] }, { ...pub, players: [{ playerId: 'p', left: true }] }]) {
    assert.equal(testPluginAvailable(state, mine, 'p'), false);
  }
  for (const own of [null, { ...mine, playerId: 'other' }, { ...mine, alive: false }, { ...mine, lp: 0 }, { ...mine, pendingDeath: true }, { ...mine, testPlugin: undefined }]) {
    assert.equal(testPluginAvailable(pub, own, 'p'), false);
  }
});

test('numeric input rejects empty, fractional, overflow and exponent values without sending', () => {
  for (const amount of ['', ' ', '-1', '1.5', '1e3', 'Infinity', '100000']) assert.ok(testPluginInput('funds', { amount }).error);
  assert.deepEqual(testPluginInput('funds', { amount: ' 0 ' }), { args: { amount: 0 } });
  assert.ok(testPluginInput('lp', { amount: '0' }).error);
  assert.deepEqual(testPluginInput('lp', { amount: '99999' }), { args: { value: 99999 } });
  assert.deepEqual(testPluginInput('round', { round: '2' }), { args: { round: 2 } });
  assert.deepEqual(testPluginInput('level', {}), { args: {} });
  // the countdown freeze is gone: no clock command is accepted any more
  assert.ok(testPluginInput('timers', { timerMode: 'hold' }).error);
});

test('bounded native content inputs preserve optional count and never reset LP', () => {
  assert.deepEqual(testPluginInput('bond', { id: 'bond_a', layers: '2', count: '' }), { args: { id: 'bond_a', layers: 2 } });
  assert.deepEqual(testPluginInput('bond', { id: 'bond_a', layers: '2', count: '0' }), { args: { id: 'bond_a', layers: 2, count: 0 } });
  assert.deepEqual(testPluginInput('strategy', { id: 'band_a', resetLp: true }), { args: { id: 'band_a' } });
  assert.ok(testPluginInput('chess', { id: '__proto__' }).error);
  assert.ok(testPluginInput('item', { id: 'a'.repeat(65) }).error);
  assert.ok(testPluginInput('speed', { amount: '4' }).error);
});

test('next-round queue input strictly preserves order and kind, supports native colon IDs', () => {
  assert.deepEqual(testPluginInput('shop', { shop: 'chess:char:a, item:equipment_b' }), { args: { slots: [{ kind: 'chess', id: 'char:a' }, { kind: 'item', id: 'equipment_b' }] } });
  for (const shop of ['', 'chess', 'token:a', 'chess:a,', 'chess:__proto__']) assert.ok(testPluginInput('shop', { shop }).error);
});

test('batch-2 inputs parse to the shared bounded shapes', () => {
  assert.deepEqual(testPluginInput('pick', { slot: '0', id: 'char:a' }), { args: { slot: 0, id: 'char:a' } });
  assert.ok(testPluginInput('pick', { slot: '', id: 'char_a' }).error);
  assert.ok(testPluginInput('pick', { slot: '12', id: 'char_a' }).error);
  assert.deepEqual(testPluginInput('shopLevel', { level: '3' }), { args: { level: 3 } });
  assert.ok(testPluginInput('shopLevel', { level: '0' }).error);
  // 调度中心 stops at level 6 now
  assert.deepEqual(testPluginInput('shopLevel', { level: '6' }), { args: { level: 6 } });
  assert.ok(testPluginInput('shopLevel', { level: '7' }).error);
  assert.deepEqual(testPluginInput('filter', { bonds: 'bond_a, bond_b', mode: 'all' }), { args: { bonds: ['bond_a', 'bond_b'], mode: 'all' } });
  assert.deepEqual(testPluginInput('filter', { bonds: '', mode: 'any' }), { args: { bonds: [], mode: 'any' } });
  assert.deepEqual(testPluginInput('filter', { bonds: 'bond_a', mode: 'bogus' }), { args: { bonds: ['bond_a'], mode: 'any' } });
  assert.ok(testPluginInput('filter', { bonds: 'bad bond' }).error);
  assert.deepEqual(testPluginInput('map', { id: 'stage_1' }), { args: { id: 'stage_1' } });
  assert.ok(testPluginInput('map', { id: '' }).error);
});

test('batch-3 inputs parse to the shared bounded shapes', () => {
  assert.deepEqual(testPluginInput('deployCap', { cap: '3' }), { args: { value: 3 } });
  assert.deepEqual(testPluginInput('deployCap', { cap: ' 12 ' }), { args: { value: 12 } });
  for (const cap of ['', '0', '13', '1.5']) assert.ok(testPluginInput('deployCap', { cap }).error, cap);
  assert.deepEqual(testPluginInput('refreshFree', { count: '0' }), { args: { count: 0 } });
  assert.deepEqual(testPluginInput('refreshFree', { count: '99' }), { args: { count: 99 } });
  for (const count of ['', '-1', '100', '0.5']) assert.ok(testPluginInput('refreshFree', { count }).error, count);
  assert.deepEqual(testPluginInput('bounty', { id: 'enemy_1000_gopro_2' }), { args: { id: 'enemy_1000_gopro_2' } });
  assert.ok(testPluginInput('bounty', { id: '' }).error);
  assert.ok(testPluginInput('bounty', { id: "enemy'1" }).error);
  assert.deepEqual(testPluginInput('wave', { id: 'wave_1' }), { args: { id: 'wave_1' } });
  assert.deepEqual(testPluginInput('wave', { id: ' wave_1 ' }), { args: { id: 'wave_1' } });
  for (const id of ['', 'bad wave', "wave'1"]) assert.ok(testPluginInput('wave', { id }).error, id);
});

test('legacy 潜能 / 练度 input stays bounded and needs at least one field', () => {
  assert.deepEqual(testPluginInput('ops', { id: 'char_a', potential: '6' }), { args: { id: 'char_a', potential: 6 } });
  assert.deepEqual(testPluginInput('ops', { id: 'char_a', cultivation: '0' }), { args: { id: 'char_a', cultivate: 0 } });
  assert.deepEqual(testPluginInput('ops', { id: 'char_a', potential: '3', cultivation: '2' }), { args: { id: 'char_a', potential: 3, cultivate: 2 } });
  assert.ok(testPluginInput('ops', { id: 'char_a' }).error, 'at least one of 潜能/练度 is required');
  assert.ok(testPluginInput('ops', { id: '', potential: '6' }).error);
  assert.ok(testPluginInput('ops', { id: 'char_a', potential: '7' }).error);
  assert.deepEqual(testPluginInput('diyRefresh', {}), { args: {} });
});

test('current shelves are addressable slot by slot, nulls clear a slot', () => {
  const layout = { chess: 2, item: 1 };
  assert.equal(slotKindAt(layout, 0), 'chess');
  assert.equal(slotKindAt(layout, 1), 'chess');
  assert.equal(slotKindAt(layout, 2), 'item');
  assert.deepEqual(parseTestPluginArgs('shopSlots', { slots: [{ kind: 'chess', id: 'c1' }, null, { kind: 'item', id: 'i1' }] }), {
    args: { slots: [{ kind: 'chess', id: 'c1' }, null, { kind: 'item', id: 'i1' }] },
  });
  assert.ok(parseTestPluginArgs('shopSlots', { slots: [] }).error);
  assert.ok(parseTestPluginArgs('shopSlots', { slots: [{ kind: 'token', id: 'c1' }] }).error);
  assert.ok(parseTestPluginArgs('shopSlots', { slots: [{ kind: 'chess', id: 'bad id' }] }).error);
  const seat = { shop: { layout, slots: [slot('chess', 'c1'), slot('item', 'i1', true)] } };
  assert.deepEqual(slotEntries(seat), [{ kind: 'chess', id: 'c1' }, { kind: 'item', id: 'i1' }]);
  assert.deepEqual(withSlot(seat, 1, { kind: 'item', id: 'i2' }).slots, [{ kind: 'chess', id: 'c1' }, { kind: 'item', id: 'i2' }]);
  assert.deepEqual(withSlot(seat, 0, null).slots, [null, { kind: 'item', id: 'i1' }]);
  assert.equal(withSlot(seat, 0, null).slots.length, 2);
  // the next-round queue drops the empty slots it cannot carry
  assert.deepEqual(queueArgs([{ kind: 'chess', id: 'c1' }, null]), { slots: [{ kind: 'chess', id: 'c1' }] });
  assert.equal(queuedSlots({ testPlugin: { shopNext: [] } }), null);
  assert.deepEqual(queuedSlots({ testPlugin: { shopNext: [{ kind: 'item', id: 'i1' }] } }), [{ kind: 'item', id: 'i1' }]);
});

test('operator edit only carries the fields the player changed', () => {
  const chess = { chessId: 'c1', charId: 'ch1', name: 'A', bonds: ['b1'], garrisonIds: ['g1'], stats: { atk: 100, def: 50, maxHp: 900, res: 10, aspd: 100, cost: 12 }, skills: [{ index: 0, isDefault: true }] };
  const base = { id: 'c1', potential: 6, cultivate: 3, skillIndex: 0, moduleId: null, bonds: ['b1'], traits: ['g1'], stats: { atk: 100, def: 50, maxHp: 900, res: 10, aspd: 100, cost: 12 } };
  assert.deepEqual(opArgs(chess, base), { id: 'c1', args: {} });
  const changed = { ...base, potential: 1, cultivate: 0, stats: { ...base.stats, atk: 777 } };
  assert.deepEqual(opArgs(chess, changed).args, { potential: 1, cultivate: 0, stats: { atk: 777 } });
  const bonds = opArgs(chess, { ...base, bonds: [] }).args;
  assert.deepEqual(bonds.bonds, [], 'clearing bonds is an explicit empty list');
  assert.deepEqual(opArgs(chess, { ...base, traits: ['g2', 'g3'] }).args, { traits: ['g2', 'g3'] });
  assert.deepEqual(opArgs(chess, { ...base, moduleId: 'm1' }).args, { moduleId: 'm1' });
  // 'none' fights without a module; null means "keep the default" and survives compaction when it is the change
  assert.deepEqual(opArgs(chess, { ...base, moduleId: MODULE_NONE }).args, { moduleId: 'none' });
  assert.deepEqual(opArgs(chess, { ...base, moduleId: 'm1' }).args.moduleId, 'm1');
  assert.deepEqual(opArgs(chess, { ...base, moduleId: null }).args, {});
  assert.deepEqual(opArgs(chess, { ...base, skillIndex: 1 }).args, { skillIndex: 1 });
  // the shared parser bounds what the window can send
  assert.ok(parseTestPluginArgs('op', { id: 'c1' }).error);
  assert.ok(parseTestPluginArgs('op', { id: 'c1', potential: 0 }).error);
  assert.ok(parseTestPluginArgs('op', { id: 'c1', cultivate: 4 }).error);
  assert.ok(parseTestPluginArgs('op', { id: 'c1', stats: { atk: -1 } }).error);
  assert.ok(parseTestPluginArgs('op', { id: 'c1', stats: { mov: 1 } }).error);
  assert.deepEqual(parseTestPluginArgs('op', { id: 'c1', stats: { atk: 0 } }), { args: { id: 'c1', stats: { atk: 0 } } });
  assert.deepEqual(parseTestPluginArgs('op', { id: 'c1', moduleId: null }), { args: { id: 'c1', moduleId: null } });
});

test('enemy setup clamps counts and keeps replace/append apart', () => {
  // a zero count never reaches the server: the window drops the row instead
  assert.deepEqual(enemiesArgs('append', [{ id: 'e1', count: 0 }, { id: 'e2', count: 99 }]), {
    mode: 'append', list: [{ id: 'e2', count: 20 }],
  });
  assert.ok(parseTestPluginArgs('enemies', { mode: 'add', list: [{ id: 'e1', count: 1 }] }).error);
  assert.ok(parseTestPluginArgs('enemies', { mode: 'replace', list: [] }).error);
  assert.ok(parseTestPluginArgs('enemies', { mode: 'replace', list: [{ id: 'e1', count: 21 }] }).error);
});

test('boss jump and round bounds follow the mode', () => {
  const single = { lastRound: 14, bossRound: 14, hiddenRound: 15 };
  assert.deepEqual(bossJump(single, { hidden: false }), { hidden: false, round: 14, returnRound: 13 });
  assert.deepEqual(bossJump(single, { hidden: true }), { hidden: true, round: 15, returnRound: 13 });
  assert.equal(roundMax(single), 15);
  assert.equal(roundMax({ lastRound: 9 }), 9);
  assert.equal(clampShopLevel(9), 6);
  assert.equal(clampShopLevel(0), 1);
  assert.equal(clampShopLevel('4'), 4);
});

test('UI uses its own protocol, no speed or clock controls, no hooks, all copy translated', () => {
  const files = ['testPlugin.js', 'testPluginWindows.js'];
  for (const name of files) {
    const ui = readFileSync(new URL(`../../public/js/ui/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(ui, /net\.request\('g\.test'|g\.mod|value="speed"|useEffect|setInterval|setTimeout/, name);
    for (const locale of ['en', 'ja', 'ko', 'zh-TW']) {
      const pack = JSON.parse(readFileSync(new URL(`../../public/i18n/${locale}.json`, import.meta.url), 'utf8'));
      for (const [, key] of ui.matchAll(/\bt\('([^']+)'/g)) assert.ok(pack[key], `${locale}: ${key}`);
    }
  }
  const ui = readFileSync(new URL('../../public/js/ui/testPlugin.js', import.meta.url), 'utf8');
  assert.match(ui, /net\.request\('g\.testPlugin'/);
  assert.ok(ui.indexOf('if (!testPluginAvailable') < ui.indexOf('function TestPluginDock'));
  // the entry is draggable and remembers its own position; no countdown or stream is held client-side
  assert.match(ui, /setPointerCapture/);
  assert.match(ui, /localStorage/);
  assert.equal(itemOf('__missing__'), null);
  assert.equal(chessOf('__missing__'), null);
});
