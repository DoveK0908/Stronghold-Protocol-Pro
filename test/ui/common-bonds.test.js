import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commonBondIds, compactRecord, recordsOfVersion } from '../../public/js/ui/stats.js';
import { DEFAULT_VERSION, VERSIONS } from '../../shared/versions.js';

const record = (id, difficulty = 'HARD') => ({
  id, end: 'settled', difficulty, selfId: 'self', victory: true,
  players: [
    { playerId: 'self', victory: true, bonds: [{ bondId: 'a', active: true }, { bondId: 'a', active: true }, { bondId: 'inactive', active: false }] },
    { playerId: 'other', victory: true, bonds: [{ bondId: 'other-only', active: true }] },
  ],
});

test('common bonds unlock exactly at three distinct clears across any difficulties', () => {
  const records = [record('1', 'FUNNY'), record('2', 'ABYSS'), record('3', 'TRAINING')];
  assert.deepEqual(commonBondIds(records.slice(0, 2)), []);
  assert.deepEqual(commonBondIds([records[0], records[0], records[1]]), []);
  assert.deepEqual(commonBondIds(records), ['a']);
  assert.deepEqual(commonBondIds(null), []);
});

test('failed, quit, test, plugin, takeover and spectator records award no progress', () => {
  const failed = record('failed'); failed.players[0].victory = false;
  const takeover = record('takeover'); takeover.players[0].aiTakeoverRound = 2;
  const spectator = record('spectator'); spectator.selfId = 'absent';
  const excluded = [failed, takeover, spectator, { ...record('quit'), end: 'quit' },
    { ...record('test'), test: true }, { ...record('plugin'), content: { cs: 'plugin' } }];
  assert.deepEqual(commonBondIds([record('1'), record('2'), ...excluded]), []);
});

test('compacted history keeps the clear and active bond ids', () => {
  assert.deepEqual(commonBondIds(['1', '2', '3'].map(id => compactRecord(record(id)))), ['a']);
});

test('the picker scopes progress to its own content version', () => {
  const other = VERSIONS.find(v => v.id !== DEFAULT_VERSION).id;
  const records = [record('1'), record('2'), { ...record('3'), version: other }];
  assert.deepEqual(commonBondIds(recordsOfVersion(records, DEFAULT_VERSION)), []);
  records.push(record('4'));
  assert.deepEqual(commonBondIds(recordsOfVersion(records, DEFAULT_VERSION)), ['a']);
});
