// shared/benchExpand.js — 整备区扩容 (experimental `benchExpand`): the three dead cells left of the 临时整备区 become
// 整备区 slots.
//
// Every stage draws row 8 as `####AAAAA##I#########` (act1autochess m01): cols 0..3 are `#` — ground-forbidden, FLY-only
// cells that no enemy route crosses, so nothing in the battle reads them. The option opens cols 0..2 as `a` (整备区) and
// the hand keeps 13 pieces instead of 10; slot idx 10..12 sit there (shared/constants.js handSlot) — the row's leftmost
// three cells, lining up under hand slots 0..2.
//
// The rows reach the board from the generated data/stages.json on both sides — the server's Match.stage and the browser's
// data.stage — so the patch is a copy per match rather than a data rebuild (data/*.json is tools/build-data.mjs output).

import { GEO } from './constants.js';

/** The tile key the extra slots' cells become (`a` = 整备区, same ground/height rules as the official bench row). */
export const BENCH_EXTRA_TILE = 'a';

/** The official bench row: ten 整备区 cells (`a`) at cols 0..9 of HAND_ROW. */
const BENCH_ROW = BENCH_EXTRA_TILE.repeat(GEO.HAND_SIZE);
/** The three cells the expansion opens: `#` (ground-forbidden) left of the 临时整备区. */
const EXTRA_CELLS = '#'.repeat(GEO.HAND_EXTRA);

/**
 * Whether a stage is the one this option was measured on: the official bench row intact and the three cells left of the
 * 临时整备区 still ground-forbidden. Every other stage (a 版本 by the owner's choice, or a hypothetical one) is played
 * untouched with the official ten-slot bench — the option opens nothing there, and the server keeps the hand at ten so
 * no piece can land on a cell the board never draws.
 * @param {{ rows?: string[] }} stage
 */
export function benchExpandable(stage) {
  const rows = stage && stage.rows;
  if (!Array.isArray(rows) || rows.length <= GEO.HAND_EXTRA_ROW) return false;
  const bench = rows[GEO.HAND_ROW];
  const line = rows[GEO.HAND_EXTRA_ROW];
  if (typeof bench !== 'string' || typeof line !== 'string') return false;
  if (bench.length < GEO.HAND_SIZE || bench.slice(0, GEO.HAND_SIZE) !== BENCH_ROW) return false;
  const c0 = GEO.HAND_EXTRA_C0;
  return line.slice(c0, c0 + GEO.HAND_EXTRA) === EXTRA_CELLS;
}

/**
 * The stage a `benchExpand` match plays on: the official stage with its three extra bench cells opened.
 * Any other stage is returned untouched (benchExpandable is false there, and the hand keeps ten slots).
 * @template {{ rows?: string[] }} T
 * @param {T} stage
 * @returns {T}
 */
export function stageWithBenchExpand(stage) {
  if (!benchExpandable(stage)) return stage;
  const rows = stage.rows;
  const line = rows[GEO.HAND_EXTRA_ROW];
  const c0 = GEO.HAND_EXTRA_C0;
  const next = `${line.slice(0, c0)}${BENCH_EXTRA_TILE.repeat(GEO.HAND_EXTRA)}${line.slice(c0 + GEO.HAND_EXTRA)}`;
  const copy = rows.slice();
  copy[GEO.HAND_EXTRA_ROW] = next;
  return { ...stage, rows: copy };
}

/** Whether a room/public view asked for the expansion (`pub.experimental.benchExpand`, only present when on). */
export const benchExpanded = (value) => !!(value && value.experimental && value.experimental.benchExpand === true);
