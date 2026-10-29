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

const FILLER = 'chess_item_2_03_e_b'; // Golden equipment never merges with adjacent fillers.
const NORMAL = 'chess_char_1_06_a';

function emptyPrep(t, experimental = expanded()) {
  const h = makeMatch({ mode: 'solo', experimental, seed: 91, fake: true }).start().toPrep(1);
  const m = h.m;
  t.after(() => m.dispose());
  const ps = h.ps('p_0');
  for (const p of ps.allChess()) ps.returnCopies(p);
  ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.bandId = null; ps.recompute();
  ps.funds = 100;
  return { m, ps };
}

function fillOriginal(ps) {
  for (let i = 0; i < GEO.HAND_SIZE; i++) ps.hand[i] = ps.newPiece('item', FILLER);
}

test('g.buy chess and equipment prefer original slot 9 while both bench ranges are free', t => {
  for (const kind of ['chess', 'item']) {
    const { m, ps } = emptyPrep(t);
    const id = kind === 'chess' ? NORMAL : FILLER;
    ps.shop.slots[0] = { kind, id, basePrice: 1, sold: false };
    assert.deepEqual(m.handle(ps.playerId, { t: 'g.buy', slot: 0 }), { ok: true });
    assert.equal(ps.hand[9]?.id, id, kind);
    assert.equal(ps.hand[9]?.kind, kind);
    assert.ok(ps.hand.slice(10).every(p => p == null), 'extra slots stay empty');
    assert.equal(ps.shop.slots[0].sold, true);
  }
});

test('granted chess and equipment fill 9..0, then 12..10, then temp', t => {
  const order = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 12, 11, 10];
  for (const kind of ['chess', 'item']) {
    const { m, ps } = emptyPrep(t);
    const gain = () => kind === 'chess'
      ? ps.acquireChess(m.gd.goldenIdOf(NORMAL), { fromPool: false, silent: true })
      : ps.acquireItem(FILLER, { silent: true });
    for (const idx of order) {
      const piece = gain();
      assert.ok(piece);
      assert.equal(ps.hand[idx], piece, `${kind}: next slot ${idx}`);
      assert.ok(ps.tempEmpty);
    }
    const overflow = gain();
    assert.ok(overflow);
    assert.equal(ps.temp[4], overflow, `${kind}: overflow only after all thirteen slots`);
  }
});

test('grants prioritize an original hole without relocating existing extra pieces', t => {
  for (const kind of ['chess', 'item']) {
    const { ps } = emptyPrep(t);
    fillOriginal(ps);
    const existing = ps.newPiece('item', FILLER);
    ps.hand[10] = existing;
    ps.hand[3] = null;
    const piece = kind === 'chess'
      ? ps.acquireChess(NORMAL, { silent: true })
      : ps.acquireItem(FILLER, { silent: true });
    assert.ok(piece);
    assert.equal(ps.hand[3], piece, kind);
    assert.equal(ps.hand[10], existing, 'existing extra card stays where the player placed it');
    assert.equal(ps.hand[11], null);
    assert.equal(ps.hand[12], null);
  }
});

test('temp refill fills all original slots before 12..10 and clears moved deadlines', t => {
  const { ps } = emptyPrep(t);
  fillOriginal(ps);
  for (let i = 10; i < ps.hand.length; i++) ps.hand[i] = ps.newPiece('item', FILLER);
  const queued = Array.from({ length: 14 }, () => ps.acquireItem(FILLER, { silent: true }));
  assert.ok(queued.every(Boolean));
  const due = ps.tempDue(queued[13]);
  ps.hand.fill(null);
  ps.recompute();
  const order = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 12, 11, 10];
  order.forEach((idx, i) => {
    assert.equal(ps.hand[idx], queued[i], `queued piece ${i} takes slot ${idx}`);
    assert.equal(ps._tempDue.has(queued[i].uid), false);
  });
  assert.deepEqual(ps.temp.filter(Boolean), [queued[13]], 'remaining overflow is not lost');
  assert.equal(ps.tempDue(queued[13]), due);
});

test('explicit stow preferences and manual moves can still choose extra slots', t => {
  const { m, ps } = emptyPrep(t);
  const preferred = ps.newPiece('item', FILLER);
  assert.equal(ps.stow(preferred, { preferIdx: 10 }), 'hand');
  assert.equal(ps.hand[10], preferred);
  assert.equal(ps.hand[9], null, 'an explicit extra-slot preference overrides automatic placement');
  const original = ps.newPiece('item', FILLER);
  assert.equal(ps.stow(original, { preferIdx: 2 }), 'hand');
  assert.equal(ps.hand[2], original);
  assert.deepEqual(m.handle(ps.playerId, { t: 'g.move', uid: original.uid, to: { area: 'hand', idx: 12 } }), { ok: true });
  assert.equal(ps.hand[12], original);
  assert.equal(ps.hand[2], null);
  assert.equal(ps.hand[10], preferred);
});

test('non-expanded acquisitions and temp refill keep the ten-slot right-to-left order', t => {
  const { m, ps } = emptyPrep(t, official());
  const bought = ps.acquireChess(NORMAL, { silent: true });
  assert.equal(ps.hand[9], bought);
  for (let idx = 8; idx >= 0; idx--) {
    const item = ps.acquireItem(FILLER, { silent: true });
    assert.ok(item);
    assert.equal(ps.hand[idx], item);
  }
  const overflow = ps.acquireItem(FILLER, { silent: true });
  assert.ok(overflow);
  assert.equal(ps.temp[4], overflow);
  assert.equal(ps.hand.length, 10);
  ps.hand[6] = null;
  ps.recompute();
  assert.equal(ps.hand[6], overflow);
  assert.ok(ps.tempEmpty);
  const moved = ps.hand[9];
  assert.deepEqual(m.handle(ps.playerId, { t: 'g.move', uid: moved.uid, to: { area: 'hand', idx: 10 } }), { error: 'BAD_TARGET' });
  assert.equal(ps.hand[9], moved);
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
