// test/ui/room-seat-move.test.js — 界面#15: choosing your seat in the ready room and the four-a-group
// dividers of an expanded room. Static: room.js asks the server for room.moveSeat from an empty seat's
// 「移到这里」 button, inserts a .rseat-sep divider every four seats once the room has more than four,
// and the styles / English strings exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('room.js: an empty seat offers 移到这里 when I am seated, and it sends room.moveSeat {seat}', () => {
  const src = read('public/js/screens/room.js');
  assert.match(src, /const moveTo = \(seat\) => run\('move', \(\) => net\.request\('room\.moveSeat', \{ seat \}\)\);/);
  assert.match(src, /data-testid="seat-move"/);
  assert.match(src, /onMove=\$\{\(\) => moveTo\(i\)\}/);
  assert.match(src, /const canMove = coop && !facts\.spectating && !queued && !!facts\.mine;/);
  assert.match(src, /<span>\$\{t\('移到这里'\)\}<\/span>/);
});

test('room.js: a divider every four seats once the room has more than four', () => {
  const src = read('public/js/screens/room.js');
  assert.match(src, /if \(facts\.seats\.length <= 4 \|\| i === 0 \|\| i % 4 !== 0\) return card;/);
  assert.match(src, /class="rseat-sep" data-testid="seat-group-sep"/);
  assert.match(src, /\$\{t\('第 \{n\} 组', \{ n: i \/ 4 \+ 1 \}\)\}/);
});

test('styles: the move button and the dashed divider', () => {
  const css = read('public/css/screens/lobby.css');
  assert.match(css, /\.rseat__move \{/);
  assert.match(css, /\.rseat-sep \{/);
  assert.match(css, /\.rseat-sep span \{/);
  assert.match(css, /border-left: 1px dashed/);
});

test('English strings exist for the two new labels', () => {
  const en = JSON.parse(read('public/i18n/en.json'));
  assert.equal(en['移到这里'], 'Move here');
  assert.equal(en['第 {n} 组'], 'Group {n}');
});
