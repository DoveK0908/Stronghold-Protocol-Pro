// PR #828 review (must-fix F2): the strategy wall's orange corner badge follows the official bands victorCount — the
// stats page's own rule, ui/stats.js strategyBadgeIds (3 clears for all 40 strategies) — not a single local win; the
// detail pane's 已通过模拟 N 次 counts the same clears (bandClearCounts, so training and quits are no progress either).
// screens/bandDraft.js draftRecords, read after the screen is up.
// Restored for 常用策略 on 2026-10-29 (owner's request) onto the pro.6 选择策略 layout, which 3297f715 had taken back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const { buildRecord } = await import('../../public/js/ui/stats.js');
const { draftRecords } = await import('../../public/js/screens/bandDraft.js');

const BANDS = JSON.parse(read('data/bands.json'));

function record(seed, { bandId = 'band_amiya', victory = true, difficulty = 'HARD', modeId = 'mode_multi_hard' } = {}) {
  return buildRecord({ seed, victory, roundsPassed: 14, difficulty, modeId, hiddenReached: false, hiddenCleared: false,
    players: [{ playerId: 'self', bandId, victory, alive: victory, roundsPassed: 14, stats: {} }],
  }, { myId: 'self', now: seed + 1 });
}

test('every official strategy needs 3 clears for its badge (data/bands.json victorCount, from activity_table)', () => {
  const list = Object.values(BANDS);
  assert.equal(list.length, 40);
  assert.ok(list.every((b) => b.victorCount === 3), 'victorCount 3 for all 40');
});

test('draftRecords: one win counts (已通过模拟 1 次) but gives no badge; the third clear does; training and quits never do', () => {
  const one = draftRecords([record(1)], BANDS);
  assert.deepEqual(one.won, { band_amiya: 1 });
  assert.deepEqual([...one.badges], [], 'a single local win is not the badge');
  const two = draftRecords([record(1), record(2), record(3, { difficulty: 'TRAINING', modeId: 'mode_training_1' }), { ...record(4), end: 'quit' }], BANDS);
  assert.deepEqual([...two.badges], [], 'training and a quit run are no clears');
  assert.deepEqual(two.won, { band_amiya: 2 }, 'the detail count leaves them out too — one rule, ui/stats.js bandClearCounts');
  const three = draftRecords([record(1), record(2), record(5)], BANDS);
  assert.deepEqual(three.won, { band_amiya: 3 });
  assert.deepEqual([...three.badges], ['band_amiya']);
  const lost = draftRecords([record(1), record(2), record(6, { victory: false })], BANDS);
  assert.deepEqual([...lost.badges], [], 'a lost run is no clear');
  assert.deepEqual(draftRecords([], BANDS), { won: {}, badges: new Set() });
});

test('the wall gates the badge on draftRecords().badges with the official sprite; the records are read after mount', () => {
  const src = read('public/js/screens/bandDraft.js');
  assert.match(src, /const badged = local\.badges\.has\(b\.bandId\);/);
  assert.match(src, /badged && 'has-badge'/);
  assert.match(src, /\$\{badged \? html`<span class="dband__badge" data-testid="band-badge"/);
  assert.match(src, /<\$\{Sprite\} k="statistics\/strategyBadge" class="dband__badge-art"/);
  assert.doesNotMatch(src, /\$\{wins \? html`<span class="dband__medal"/, 'no badge after one win');
  // the detail pane's count stays plain text, and only for a strategy this browser has won with
  assert.match(src, /local\.won\[band\.bandId\] \? html`<span class="draft-detail__medal" data-testid="band-clears">\$\{t\('已通过模拟\{n\}次'/);
  // not parsed while the screen mounts (the stats store can be large): an idle callback after it is up
  assert.match(src, /const \[local, setLocal\] = useState\(NO_RECORDS\);/);
  assert.match(src, /setLocal\(draftRecords\(peekStatsRecords\(\), data\.get\('bands'\)\)\)/);
  assert.ok(JSON.parse(read('data/assets.json')).ui['statistics/strategyBadge'], 'the official badge sprite is in the asset list');
  const css = read('public/css/screens/draft.css');
  // the official box: a full-tile overlay whose crown lands on the tile's corner, and the picker avatars below it
  assert.match(css, /\.dband__badge \{ position: absolute; top: -10\.8%; right: -10\.8%; width: 82\.35%; height: 84\.8%; pointer-events: none; \}/);
  assert.match(css, /\.dband\.has-badge \.dband__who \{ top: \.34rem; \}/);
  assert.match(css, /\.draft-detail__medal \{/);
});

test.skip('the order rows\' name cards wear the doctor\'s outfit (B6, docs/SKINS.md): the seat cards\' seatCardSkin, then chessPortraitUrl', () => {
  const src = read('public/js/screens/bandDraft.js');
  // the rule itself is unit-tested in seat-art.test.js (one's own choice at once, a teammate's public map, the switch)
  // (§35.51: the outfit's picture, then the default one should the outfit's file fail to load, as on the seat cards)
  assert.match(src, /const skin = op \? seatCardSkin\(p, op\.chess\.charId, \{ myId, localSkins, players, otherSkins \}\) : null;\n\s+return op \? \[chessPortraitUrl\(data\.get\('assets'\), op\.chess, \{ skin \}\), skin \? chessPortraitUrl\(data\.get\('assets'\), op\.chess\) : null\] : null;/);
  assert.match(src, /const art = seatArtSrc\(arts, badArt\);/);
  assert.match(src, /<img key=\$\{art\} class="dorder__art" src=\$\{art\}[^>]*onError=\$\{\(\) => setBadArt\(/);
  assert.match(read('docs/SKINS.md'), /strategy draft's name cards/);
});
