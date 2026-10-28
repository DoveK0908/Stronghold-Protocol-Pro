// test/ui/ui-leftovers-3533.test.js — the §35.18 UI leftovers fixed in 0.3.2 (DESIGN §35.51), pinned in the stylesheets
// and the markup; the browser checks are test/ui/room-fit.e2e.test.js and lobby-hub.e2e.test.js (text-fit) and the
// measurements in §35.51.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const block = (text, head) => {
  const i = text.indexOf(head);
  assert.ok(i >= 0, head);
  let depth = 0;
  for (let j = text.indexOf('{', i); j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}' && --depth === 0) return text.slice(i, j + 1);
  }
  return text.slice(i);
};

test('the 机变 overlay leaves the corner\'s buttons uncovered: they wrap within its 2.8rem column, a phone\'s overlay starts past them', () => {
  const panels = css('public/css/screens/game-panels.css');
  assert.match(panels, /\.spov \{ position: absolute; inset: 0 0 0 2\.8rem;/);
  assert.match(block(panels, '@media (min-width: 768px) {\n  .gm.has-sp .gm__corner'),
    /\.gm\.has-sp \.gm__corner \{ flex-wrap: wrap-reverse; align-content: flex-start; max-width: calc\(2\.8rem - \.24rem - \.1rem\); \}/);
  const dev = css('public/css/devices.css');
  // the coarse phone's overlay starts past the corner's wrapped width (measured in the browser: mock.e2e's 「the 机变
  // overlay leaves every corner button clickable」, elementFromPoint at each button's centre, wide windows and a phone)
  assert.match(dev, /\.gm\.has-sp > \.spov \{ left: calc\(max\(2\.8rem,/);
  assert.match(dev, /\.gm\.is-collapsed\.has-sp \.gm__corner \{ flex-wrap: wrap-reverse;/);
});

test('选择模拟协议 in a portrait window keeps the .5rem the chosen card slides into', () => {
  const lobby = css('public/css/screens/lobby.css');
  assert.match(lobby, /\.proto-list \{[^}]*padding: \.07rem \.06rem \.07rem \.5rem;/);
  assert.match(lobby, /\.pcard\.is-on \{ transform: translateX\(-\.44rem\);/);
  // the fork writes the sheet's portrait rules in a block of its own, after the hub's 试炼 dialog's (upstream has one
  // block for both dialogs, so the first `max-aspect-ratio: 1/1` is not this one)
  const portrait = lobby.slice(lobby.indexOf('.proto__pic { inset: 0 0 .9rem; }')).slice(0, 600);
  assert.doesNotMatch(portrait, /\.proto-list[^{]*\{[^}]*padding-left/);
  assert.match(portrait, /\.proto-foot \{ padding-left: \.1rem; \}/);
});

test('short screens: the empty key field takes the placeholder\'s size; 同盟模拟\'s line above its entry keeps 「1–4 名博士」', () => {
  const lobby = css('public/css/screens/lobby.css');
  const short = lobby.slice(lobby.indexOf('@media (max-height: 520px) {'));
  const ph = /\.ally-key input::placeholder \{ font-size: (clamp\([^;]+\)); \}/.exec(short)?.[1];
  assert.ok(ph, 'the placeholder\'s size');
  assert.ok(short.includes(`.ally-key input:placeholder-shown { font-size: ${ph}; }`), 'the empty field at the same size');
  assert.match(lobby, /\.hub-entry__short \{ display: none; \}/);
  assert.match(short, /\.hub-entry__long \{ display: none; \}\s*\.hub-entry__short \{ display: inline; \}/);
  const js = readFileSync(path.join(ROOT, 'public/js/screens/lobby.js'), 'utf8');
  assert.match(js, /pointShort: N_\('1–\{n\} 名博士'\)/);
  assert.match(js, /<span class="hub-entry__long">\$\{t\(card\.points\[0\], card\.pointParams\)\}<\/span><span class="hub-entry__short">\$\{t\(card\.pointShort, card\.pointParams\)\}<\/span>/);
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(readFileSync(path.join(ROOT, `public/i18n/${lang}.json`), 'utf8'));
    assert.match(pack['1–{n} 名博士'], /\{n\}/, lang);
  }
});

test('text-fit: ellipsis exceptions stay scoped; only player names may break inside a word', () => {
  const src = readFileSync(path.join(ROOT, 'test/e2e/text-fit.mjs'), 'utf8');
  assert.match(src, /webkitLineClamp/);
  // §35.23.12: callers may allow the compact version pill while checking its accessible name and bounds.
  assert.ok(src.includes("export function textProblems(rootSel, extraEllipsis = '')"));
  assert.ok(src.includes("if (!cut.matches(`.seat__name, .specbar__who, .room-mode${extraEllipsis ? `, ${extraEllipsis}` : ''}`)) out.push(`ellipsis ${label}`);"));
  assert.match(src, /!breakOk\(p, c\) && !el\.closest\('\.seat__name'\)/);
});

test('the room: a 确认 that drops a plugin mode says so to the host', () => {
  const js = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8');
  // the fork's 选择模拟协议 is RoomProtocol (its own scene + cards): 确认 does nothing when the pick did not change —
  // unless a plugin mode is on, which picking a difficulty leaves — and setDifficulty tells the host it did
  assert.match(js, /pick === room\.difficulty && !pluginMode \? onClose\(\) : onPick\(pick\)/);
  assert.match(js, /if \(dropped\) toast\(t\('已退出插件模式「\{name\}」', \{ name: dropped \}\), 'info'\);/);
  assert.match(js, /const setDifficulty = \(difficulty\) => run\('diff', async \(\) => \{/);
});

test('the other event screens at a big 文字大小: 成就统计\'s banner, the briefing\'s header, 已被选择, the top bar\'s ping, the loadout card view', () => {
  const stats = css('public/css/screens/stats.css');
  assert.match(stats, /\.achv__banner \{[^}]*min-height: \.74rem;/);
  assert.doesNotMatch(stats, /\.achv__banner \{[^}]*[^-]height: \.74rem/);
  assert.match(stats, /\.achv__title \{[^}]*grid-template-areas: "mark en" "mark name";/);
  assert.doesNotMatch(stats, /margin: 0 0 0 -\.9rem/, 'the name no longer slides under the decorative ALLIANCE');
  const brief = css('public/css/screens/briefing.css');
  // FORK NOTE (2026-10-25 逐屏裁决: 确认本局信息取回 0.3.2-pro.6 的版式): the official 0.3.3 briefing carries its own
  // section-bar header (grey gradient bar + mask icon) with a short-window block (≤ 520 px hides the micro and the guide
  // label) and a ≤ 640 px one for 大 / 特大. The fork's briefing keeps the older mint-rule section heads and none of those
  // media blocks, so those three assertions are dropped here; the fork's own short-screen rules live in draft.css.
  assert.doesNotMatch(brief, /@media \(max-height: 520px\)/, 'the fork briefing has no short-window block of its own');
  // FORK NOTE (2026-10-25 逐屏裁决: 确认本局信息取回 pro.6): the fork's MatchEnemies paints the type's name and its
  // description in the cell (the official PR #643 one kept the description in a Tooltip and split the name with <wbr />)
  assert.match(readFileSync(path.join(ROOT, 'public/js/ui/matchEnemies.js'), 'utf8'), /brief-faction__text/);
  // FORK NOTE (2026-10-25 逐屏裁决: 确认本局信息与选择策略都取回 0.3.2-pro.6): the official 0.3.3 sheets carry a
  // responsive pass (§35.51 / §35.56: short-window blocks at 520 / 640 px, `:root[data-text="lg"|"xl"]` rules that drop the
  // step name, the grey section bars, the two-line English / Korean step name) that the fork's older draft.css and
  // briefing.css never had and that this tree does not want to reproduce — the fork's own short-screen handling lives in
  // its `.dband` / `.stephead` rules. The official assertions for those blocks are dropped; the bits both trees share
  // (the panels, the loadout deck and the lobby cards below) are still pinned.
  const draftAll = css('public/css/screens/draft.css');
  assert.doesNotMatch(draftAll, /@media \(max-height: 520px\)/, 'the fork draft has no short-window block of its own');
  assert.doesNotMatch(draftAll, /@media \(max-width: 1440px\)/, 'nor the old width-based fallback');
  const panels = css('public/css/screens/game-panels.css');
  assert.match(panels, /\.spov \.rt:lang\(ko\), \.spov \.rt-note:lang\(ko\), \.spov \.rt-vup:lang\(ko\) \{ word-break: keep-all; overflow-wrap: break-word; \}/);
  assert.match(block(panels, '@media (max-height: 520px) {\n  .spov__titles'), /\.spov__sub \{ grid-row: 3; grid-column: 1 \/ -1;/);
  // FORK NOTE (2026-10-25 逐屏裁决: 选择策略取回 pro.6): the fork's order row carries its own state classes
  // (is-cur / is-done / is-self / is-flash / has-nc) instead of the official held / has-status pair.
  assert.match(readFileSync(path.join(ROOT, 'public/js/screens/bandDraft.js'), 'utf8'), /class=\$\{cx\('dorder', cur && 'is-cur'/);
  // FORK NOTE (2026-10-25): the official rule above made the latency cell 1 px taller than its neighbours; the fork's
  // strip now stretches every cell to the strip's height instead (the same alignment the room's top bar uses)
  assert.match(css('public/css/screens/game.css'),
    /\.gtop__net \.ping, \.gtop__net \.specpill,\s*\.gtop__net \.latency-status \.server-load-button \{ height: 100%; min-height: 0; padding-top: 0; padding-bottom: 0; \}/);
  const lo = css('public/css/screens/loadout.css');
  assert.match(lo, /\.lo-top__note \{ margin: 0; max-width: min\(8\.4rem, 100%\);/);
  assert.match(lo, /\.lo-bbar__tiers \{[^}]*padding-top: max\(\.24rem, calc\(17px \* var\(--sp-ui, 1\)\)\); \}/);
  assert.match(block(lo, '@media (max-height: 520px) {\n  .lo-deck'), /\.lo-diy__frame \{ width: 46%; \}/);
  const lobby = css('public/css/screens/lobby.css');
  assert.match(lobby, /\.ally-card__bar small \{[^}]*min-width: min\(100%, 10em\); white-space: normal; text-align: right;/);
  assert.match(lobby, /\.ally-card--create \.ally-card__bar \{ flex-wrap: wrap;/);
  assert.match(lobby, /\.ally-card__bar small:lang\(ko\) \{ word-break: keep-all;/);
});

test('the draft\'s name cards fall back to the default picture when an outfit\'s fails, as the seat cards do', () => {
  const js = readFileSync(path.join(ROOT, 'public/js/screens/bandDraft.js'), 'utf8');
  // FORK NOTE (2026-10-25 逐屏裁决: 选择策略取回 pro.6): the fork's order row paints the doctor's 名片立绘 as a
  // background layer from seatPortrait(); the official row built an <img> candidate list with seatArtSrc(arts, badArt)
  assert.match(js, /const artOf = \(pl\) => seatPortrait\(seatOf\(pl\.playerId\) \|\| pl, portraits\);/);
  // the fork's name cards paint the fallback as a background layer (.dorder__art: background-size: cover;
  // background-position: 50% 12%), the official ones as an <img> (object-fit: cover; object-position: 50% 16%)
  assert.match(css('public/css/screens/draft.css'), /\.dorder__art \{[^}]*(object-fit: cover; object-position: 50% 16%|background-size: cover; background-position: 50% 12%);/);
});
