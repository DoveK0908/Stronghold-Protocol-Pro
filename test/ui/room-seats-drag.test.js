// A desktop has no swipe: the 同盟等待室 seat strip (8–20 seats) has to be draggable with the mouse, the same way the
// 干员调配 deck already is (community report 2026-10-24: 「多人时鼠标左右拖动查看成员那个没用了」 — it had never been
// wired to the room at all). Both strips now share one hook so the two cannot drift apart again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../public/${p}`, import.meta.url), 'utf8');
const hook = read('js/ui/dragScroll.js');
const room = read('js/screens/room.js');
const loadout = read('js/screens/loadout.js');
const css = read('css/screens/lobby.css');

test('the drag hook only takes the mouse, only the left button, and only after a few pixels', () => {
  assert.match(hook, /export function useDragScroll\(/);
  assert.match(hook, /if \(e\.pointerType !== 'mouse' \|\| e\.button !== 0\) return;/);
  assert.match(hook, /if \(Math\.abs\(dx\) < threshold\) return;/);
  assert.match(hook, /threshold = 6/);
  // a real drag must not let go into a click on whatever sits under the pointer
  assert.match(hook, /swallow\.current = true/);
  assert.match(hook, /onClickCapture: \(e\) => \{ if \(swallow\.current\)/);
  assert.match(hook, /classList\?\.add\?\.\('is-dragging'\)/);
  assert.match(hook, /classList\?\.remove\?\.\('is-dragging'\)/);
});

test('the room seat strip starts a drag only when it really overflows', () => {
  assert.match(room, /import \{ useDragScroll \} from '\.\.\/ui\/dragScroll\.js';/);
  assert.match(room, /const seatsDrag = useDragScroll\(\{/);
  assert.match(room, /canStart: \(el\) => !!el && el\.scrollWidth > el\.clientWidth \+ 1/);
  assert.match(room, /<main class="rs-seats" ref=\$\{bindSeatsWheel\} \.\.\.\$\{seatsDrag\}>/);
  // hooks run before the early return, otherwise the seat strip would mount without handlers
  const hookAt = room.indexOf('const seatsDrag = useDragScroll(');
  const early = room.indexOf('if (!room) return null;');
  assert.ok(hookAt > 0 && early > hookAt, 'useDragScroll must be called before `if (!room) return null`');
});

test('the loadout deck uses the same hook instead of its own copy', () => {
  assert.doesNotMatch(loadout, /function useDragScroll\(/);
  assert.match(loadout, /import \{ useDragScroll \} from '\.\.\/ui\/dragScroll\.js';/);
  assert.match(loadout, /const DECK_SKIP = \(target\) => !!target\?\.closest\?\.\('select, input, textarea, \.lo-op__quick--cult'\);/);
  assert.equal(loadout.match(/useDragScroll\(\{ skip: DECK_SKIP \}\)/g)?.length, 2);
});

test('dragging shows a grabbing cursor', () => {
  assert.match(css, /\.rs-seats\.is-dragging \{ cursor: grabbing; user-select: none; \}/);
  assert.match(css, /\.rs-seats\.is-dragging \* \{ cursor: grabbing; user-select: none; \}/);
});
