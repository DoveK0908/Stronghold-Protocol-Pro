// In-process input/visibility contracts only: no browser, server, timers or sockets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { testPluginAvailable, testPluginInput } from '../../public/js/ui/testPluginModel.js';

const pub = { experimental: { luckConsole: true }, phase: 'PREP', players: [{ playerId: 'p' }] };
const mine = { playerId: 'p', alive: true, lp: 10, testPlugin: { actions: 0, last: null } };

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
});

test('bounded native content inputs preserve optional count and never reset LP', () => {
  assert.deepEqual(testPluginInput('bond', { id: 'bond_a', layers: '2', count: '' }), { args: { id: 'bond_a', layers: 2 } });
  assert.deepEqual(testPluginInput('bond', { id: 'bond_a', layers: '2', count: '0' }), { args: { id: 'bond_a', layers: 2, count: 0 } });
  assert.deepEqual(testPluginInput('strategy', { id: 'band_a', resetLp: true }), { args: { id: 'band_a' } });
  assert.ok(testPluginInput('chess', { id: '__proto__' }).error);
  assert.ok(testPluginInput('item', { id: 'a'.repeat(65) }).error);
  assert.ok(testPluginInput('speed', { amount: '4' }).error);
});

test('shop input strictly preserves order and kind, supports native colon IDs', () => {
  assert.deepEqual(testPluginInput('shop', { shop: 'chess:char:a, item:equipment_b' }), { args: { slots: [{ kind: 'chess', id: 'char:a' }, { kind: 'item', id: 'equipment_b' }] } });
  for (const shop of ['', 'chess', 'token:a', 'chess:a,', 'chess:__proto__']) assert.ok(testPluginInput('shop', { shop }).error);
});

test('batch-2 inputs parse to the shared bounded shapes', () => {
  assert.deepEqual(testPluginInput('pick', { slot: '0', id: 'char:a' }), { args: { slot: 0, id: 'char:a' } });
  assert.ok(testPluginInput('pick', { slot: '', id: 'char_a' }).error);
  assert.ok(testPluginInput('pick', { slot: '12', id: 'char_a' }).error);
  assert.deepEqual(testPluginInput('shopLevel', { level: '3' }), { args: { level: 3 } });
  assert.ok(testPluginInput('shopLevel', { level: '0' }).error);
  assert.ok(testPluginInput('shopLevel', { level: '100' }).error);
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

test('batch-5 inputs parse to the shared bounded shapes', () => {
  assert.deepEqual(testPluginInput('ops', { id: 'char_a', potential: '6' }), { args: { id: 'char_a', potential: 6 } });
  assert.deepEqual(testPluginInput('ops', { id: 'char_a', cultivation: '0' }), { args: { id: 'char_a', cultivate: 0 } });
  assert.deepEqual(testPluginInput('ops', { id: 'char_a', potential: '3', cultivation: '2' }), { args: { id: 'char_a', potential: 3, cultivate: 2 } });
  assert.ok(testPluginInput('ops', { id: 'char_a' }).error, 'at least one of 潜能/练度 is required');
  assert.ok(testPluginInput('ops', { id: '', potential: '6' }).error);
  assert.ok(testPluginInput('ops', { id: 'char_a', potential: '7' }).error);
  assert.deepEqual(testPluginInput('timers', { timerMode: 'hold' }), { args: { on: false } });
  assert.deepEqual(testPluginInput('timers', { timerMode: 'resume' }), { args: { on: true } });
  assert.deepEqual(testPluginInput('diyRefresh', {}), { args: {} });
});

test('UI uses its own protocol, no speed controls or automatic request hook; all copy translated', () => {
  const ui = readFileSync(new URL('../../public/js/ui/testPlugin.js', import.meta.url), 'utf8');
  assert.match(ui, /net.request\('g.testPlugin'/);
  assert.doesNotMatch(ui, /net.request\('g.test'|g.mod|value="speed"|useEffect|setInterval|setTimeout/);
  assert.ok(ui.indexOf('if (!testPluginAvailable') < ui.indexOf('function TestPluginDock'));
  for (const locale of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(readFileSync(new URL(`../../public/i18n/${locale}.json`, import.meta.url), 'utf8'));
    for (const [, key] of ui.matchAll(/\bt\('([^']+)'/g)) assert.ok(pack[key], `${locale}: ${key}`);
  }
});
