// Safe Node-only UI/option contracts: no browser, server or subprocess dependencies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXPERIMENTAL_DEFAULTS, experimentalOptions, experimentalKey, sameExperimental, optionalValue } from '../../shared/experimental.js';
import { validateC2S } from '../../shared/protocol.js';

// Result modules warm game data at import; absent files are harmless and no network is needed here.
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
const { BossQuotaLedger } = await import('../../public/js/screens/result.js');
const ui = await import('../../public/js/ui/experimental.js');
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const on = { ...EXPERIMENTAL_DEFAULTS, bossQuota: true };
const nodes = value => Array.isArray(value) ? value.flatMap(nodes)
  : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join('')
  : value && typeof value === 'object' ? text(value.props?.children) : value == null ? '' : String(value);
const rounds = [
  { kind: 'boss', round: 14, quota: 150000, players: [
    { playerId: 'seat2', name: '<Doctor>', time: 12.345, rank: 1 },
    { playerId: 'seat3', name: 'Tied', time: 12.345, rank: 1 },
    { playerId: 'seat0', name: 'Unfinished', time: null, rank: null },
  ] },
  { kind: 'hidden', round: 15, quota: 240000, players: [
    { playerId: 'seat0', name: 'Unfinished', time: 0, rank: 1 },
  ] },
];

test('bossQuota defaults off, only uploads true, and participates in protocol / comparison / key', () => {
  assert.equal(optionalValue({}, 'bossQuota'), false);
  assert.deepEqual(experimentalOptions({ ...EXPERIMENTAL_DEFAULTS, bossQuota: false }), EXPERIMENTAL_DEFAULTS);
  assert.equal(experimentalOptions(on).bossQuota, true);
  assert.equal(experimentalKey(on), '00:quota');
  assert.equal(sameExperimental(on, EXPERIMENTAL_DEFAULTS), false);
  assert.equal(sameExperimental({ ...EXPERIMENTAL_DEFAULTS, bossQuota: false }, EXPERIMENTAL_DEFAULTS), true);
  assert.equal(validateC2S({ t: 'room.setExperimental', experimental: on }), null);
  assert.equal(validateC2S({ t: 'room.create', mode: 'coop', difficulty: 'HARD', experimental: on }), null);
  assert.equal(validateC2S({ t: 'room.setExperimental', experimental: { ...on, bossQuota: 1 } }), 'bad field experimental');
  assert.equal(ui.experimentalChanged(on), true);
  assert.equal(ui.experimentalChanged(EXPERIMENTAL_DEFAULTS), false);
  assert.equal(ui.experimentalOptions(on).bossQuota, true);
  assert.ok(ui.experimentalSummary(on).includes('防治倒转区'));
});

test('quota report is absent for old records and absent/empty quota data', () => {
  for (const value of [undefined, null, [], {}, [{ kind: 'boss', players: [] }]]) {
    assert.equal(BossQuotaLedger({ rounds: value }), null);
  }
});

test('both rounds render independently with table headers, ties and explicit unfinished status', () => {
  const before = JSON.stringify(rounds);
  const tree = BossQuotaLedger({ rounds });
  const all = nodes(tree);
  assert.equal(tree.props['data-testid'], 'result-boss-quota');
  assert.equal(all.filter(n => n.type === 'table').length, 2);
  assert.deepEqual(all.filter(n => n.props?.['data-quota-kind']).map(n => n.props['data-quota-kind']), ['boss', 'hidden']);
  assert.deepEqual(all.filter(n => n.type === 'tr' && n.props['data-player-id']).map(n => n.props['data-player-id']), ['seat2', 'seat3', 'seat0', 'seat0']);
  assert.deepEqual(all.filter(n => n.type === 'tbody')[0].props.children.map(row => text(row.props.children[0])), ['1', '1', '—']);
  const shown = text(tree);
  for (const label of ['最终攻势', '隐秘核心', '排名', '博士', '配额完成时间（游戏秒）', '12.35 秒', '0.00 秒', '未完成', '<Doctor>']) {
    assert.ok(shown.includes(label), `visible text: ${label}`);
  }
  assert.ok(!shown.includes('null'));
  assert.ok(all.every(n => !n.props?.dangerouslySetInnerHTML), 'names stay escaped text nodes');
  assert.equal(JSON.stringify(rounds), before, 'never re-sort or rewrite server rank/seat order');
});

test('dialog has visible linked explanation and ResultView consumes only provided quota data', () => {
  const dialog = read('public/js/ui/experimental.js');
  const result = read('public/js/screens/result.js');
  assert.ok(dialog.includes('id="experimental-boss-quota"'));
  assert.ok(dialog.includes('aria-describedby="experimental-boss-quota-help"'));
  assert.ok(dialog.includes("ruleLabel('bossQuota', 'experimental-boss-quota-help')"));
  for (const rule of ['入场存活人数', '共享血池 ÷', '伤害与 DPS', '两轮独立', '不影响胜负与奖励', '超时扣血阶段解除限伤']) {
    assert.ok(dialog.includes(rule), `visible rule: ${rule}`);
  }
  assert.ok(result.includes('<${BossQuotaLedger} rounds=${res?.bossQuota} />'));
  const en = JSON.parse(read('public/i18n/en.json'));
  assert.equal(en['防治倒转区'], 'Boss Quota Zone');
  assert.equal(en['未完成'], 'Not completed');
  assert.ok(en['配额完成时间（游戏秒）'].includes('game seconds'));
});
