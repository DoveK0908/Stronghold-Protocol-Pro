// 整备区扩容 (experimental.benchExpand): the three dead cells left of the 临时整备区 (row 8 cols 0..2) become 整备区
// slots, so the hand keeps 13 pieces instead of 10. Every other room stays on the official ten-slot bench, and the option
// never rides the wire unless it is on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { GEO, HAND_MAX, handSlot, handIndex } from '../../shared/constants.js';
import { stageWithBenchExpand, benchExpanded, benchExpandable } from '../../shared/benchExpand.js';
import { tileSlot, pieceTile } from '../../public/js/render/drag.js';
import { collectViolations } from '../../server/match/invariants.js';

const expanded = extra => ({ revivalEnabled: false, disableSharedPool: false, benchExpand: true, ...extra });
const official = extra => ({ revivalEnabled: false, disableSharedPool: false, ...extra });

test('slot geometry: ten official slots on row 7, three extra on row 8 cols 0..2 (leftmost cells of that row)', () => {
  assert.equal(GEO.HAND_SIZE, 10);
  assert.equal(HAND_MAX, 13);
  assert.deepEqual(handSlot(0), { row: 7, col: 0 });
  assert.deepEqual(handSlot(9), { row: 7, col: 9 });
  assert.deepEqual(handSlot(10), { row: 8, col: 0 });
  assert.deepEqual(handSlot(12), { row: 8, col: 2 });
  assert.equal(handIndex(7, 3, 10), 3);
  assert.equal(handIndex(8, 0, 10), -1, 'a ten-slot match has no row-8 hand cells');
  assert.equal(handIndex(8, 0, 13), 10);
  assert.equal(handIndex(8, 2, 13), 12);
  assert.equal(handIndex(8, 3, 13), -1, 'col 3 stays outside the expansion');
  assert.equal(handIndex(8, 4, 13), -1, 'col 4 is the 临时整备区, not the hand');
  // the client's drag mapping follows the same geometry
  assert.deepEqual(pieceTile({ area: 'hand', idx: 12 }), { row: 8, col: 2 });
  assert.deepEqual(tileSlot({ row: 8, col: 0 }, GEO, 13), { area: 'hand', idx: 10 });
  assert.equal(tileSlot({ row: 8, col: 0 }), null, 'the default (official) bench keeps row 8 for the temp area only');
});

test('stageWithBenchExpand opens exactly the three dead cells and leaves everything else alone', () => {
  // the official layout: row 7 = the ten 整备区 cells, row 8 = `#` left of the 临时整备区
  const rows = ['', '', '', '', '', '', '', 'aaaaaaaaaa###########', '####AAAAA##I#########', ''];
  const stage = { id: 'x', rows, devices: [{ id: 'd' }] };
  const out = stageWithBenchExpand(stage);
  assert.notEqual(out, stage, 'a copy, the shared data stage is never mutated');
  assert.equal(out.rows[GEO.HAND_EXTRA_ROW], 'aaa#AAAAA##I#########');
  assert.equal(out.rows[8], 'aaa#AAAAA##I#########');
  assert.equal(out.rows[7], rows[7], 'the official bench row is untouched');
  assert.equal(out.rows.length, rows.length);
  assert.deepEqual(out.devices, stage.devices);
  assert.deepEqual(stageWithBenchExpand(out), out, 'idempotent');
  const noRows = { id: 'no-rows' };
  assert.equal(stageWithBenchExpand(noRows), noRows, 'a stage without a rows array is returned as is');
  const short = { id: 'y', rows: ['a'] };
  assert.equal(stageWithBenchExpand(short), short, 'a stage without that row is returned as is');
  assert.equal(benchExpanded({ experimental: { benchExpand: true } }), true);
  assert.equal(benchExpanded({ experimental: {} }), false);
  assert.equal(benchExpanded(null), false);
});

test('only the measured layout opens cells: another stage is played untouched', () => {
  const officialRow8 = '####AAAAA##I#########';
  const ok = { rows: ['a'.repeat(10) + '#', '', '', '', '', '', '', 'a'.repeat(10) + '#', officialRow8] };
  assert.equal(benchExpandable(ok), true);
  // a stage whose bench row is not the official ten cells (a 版本 the host picked) has nowhere to put the extra slots
  const otherBench = { rows: ok.rows.slice() };
  otherBench.rows[GEO.HAND_ROW] = '#a#########';
  assert.equal(benchExpandable(otherBench), false);
  assert.equal(stageWithBenchExpand(otherBench), otherBench, 'returned as is');
  // nor does a stage that already uses row 8 cols 0..2 for something real
  const usedCells = { rows: ok.rows.slice() };
  usedCells.rows[GEO.HAND_EXTRA_ROW] = 'f##AAAAA##I#########';
  assert.equal(benchExpandable(usedCells), false);
  assert.equal(stageWithBenchExpand(usedCells), usedCells);
});

test('an expanded room benches 13 pieces and plays on the patched stage', t => {
  const h = makeMatch({ humans: 2, experimental: expanded(), seed: 91, fake: true }).start();
  const m = h.m; t.after(() => m.dispose());
  for (const ps of m.players.values()) {
    assert.equal(ps.hand.length, 13, `${ps.playerId}: 13 bench slots`);
    assert.equal(ps.handSize, 13);
  }
  const line = m.stage.rows[GEO.HAND_EXTRA_ROW];
  assert.equal(line.slice(GEO.HAND_EXTRA_C0, GEO.HAND_EXTRA_C0 + GEO.HAND_EXTRA), 'aaa', 'row 8 cols 0..2 are 整备区');
  assert.equal(line.slice(GEO.TEMP_C0, GEO.TEMP_C0 + GEO.TEMP_SIZE), 'AAAAA', 'the 临时整备区 keeps its five cells');
  assert.equal(m.publicView().experimental.benchExpand, true, 'the client sees the option (it patches its own stage)');
  // the invariant runs on every state check: a hand of the wrong size would fail here
  assert.deepEqual(collectViolations(m), [], 'the bench invariant accepts an expanded hand');
});

test('a room without the option keeps the official ten-slot bench and the unpatched stage', t => {
  const h = makeMatch({ humans: 2, experimental: official(), seed: 91, fake: true }).start();
  const m = h.m; t.after(() => m.dispose());
  for (const ps of m.players.values()) {
    assert.equal(ps.hand.length, 10);
    assert.equal(ps.handSize, 10);
  }
  assert.equal(m.stage.rows[GEO.HAND_EXTRA_ROW].slice(0, 3), '###', 'the dead cells stay forbidden');
  assert.equal(m.publicView().experimental.benchExpand, undefined, 'nothing rides the wire');
  assert.deepEqual(collectViolations(m), [], 'the bench invariant accepts an expanded hand');
});

test('the option is opt-in on the wire: it only rides when true, and the key/equality see it', async () => {
  const { experimentalOptions, experimentalKey, sameExperimental, isExperimental, EXPERIMENTAL_OPTIONAL } = await import('../../shared/experimental.js');
  const base = { revivalEnabled: false, disableSharedPool: false };
  assert.ok(EXPERIMENTAL_OPTIONAL.includes('benchExpand'));
  assert.deepEqual(experimentalOptions(base), base, 'an ordinary room keeps the two-flag shape');
  assert.deepEqual(experimentalOptions({ ...base, benchExpand: false }), base);
  assert.deepEqual(experimentalOptions({ ...base, benchExpand: true }), { ...base, benchExpand: true });
  assert.notEqual(experimentalKey({ ...base, benchExpand: true }), experimentalKey(base));
  assert.equal(sameExperimental({ ...base, benchExpand: true }, { ...base, benchExpand: true }), true);
  assert.equal(sameExperimental({ ...base, benchExpand: true }, base), false);
  assert.equal(isExperimental({ ...base, benchExpand: 'yes' }), false);
});
