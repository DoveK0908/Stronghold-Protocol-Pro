import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAdminClient } from '../../public/js/ui/adminApi.js';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const source = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('admin transport confines credentials to same-origin JSON and keeps CSRF in memory', async () => {
  const calls = [];
  const client = createAdminClient(async (url, init) => {
    calls.push({ url, init });
    return json(calls.length === 1 ? { ok: true, csrf: 'csrf-fixture' } : { ok: true, items: [], total: 0, results: [] });
  });
  await client.login('fixture-owner-key');
  await client.read('claims', { offset: 50, q: 'name#1234' });
  await client.write('claims.release', [{ name: 'name', tag: '1234' }]);
  assert.equal(calls[0].url, '/api/admin');
  assert.deepEqual(JSON.parse(calls[0].init.body), { action: 'login', key: 'fixture-owner-key' });
  assert.equal(calls[1].url, '/api/admin?resource=claims&offset=50&limit=50&q=name%231234');
  assert.deepEqual(JSON.parse(calls[2].init.body), { action: 'claims.release', confirm: 'CONFIRM', items: [{ name: 'name', tag: '1234' }] });
  assert.equal(calls[2].init.headers['X-SP-CSRF'], 'csrf-fixture');
  for (const { url, init } of calls) {
    assert.equal(url.includes('fixture-owner-key'), false);
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.cache, 'no-store');
    assert.ok(init.signal instanceof AbortSignal);
  }
});

test('admin clients clear capabilities after denied requests and logout, including failed logout', async () => {
  const calls = [];
  let fail = false;
  const client = createAdminClient(async (_url, init) => {
    calls.push(init);
    return fail ? json({ ok: false, error: 'UNAUTHORIZED' }, 401) : json({ ok: true, csrf: 'fixture-csrf' });
  });
  await client.login('fixture');
  fail = true;
  await assert.rejects(client.read('players'), { code: 'UNAUTHORIZED' });
  fail = false;
  await client.write('players.reset', [{ owner: 'fixture' }]);
  assert.equal(calls.at(-1).headers['X-SP-CSRF'], undefined);
  await client.login('fixture');
  fail = true;
  await assert.rejects(client.logout(), { code: 'UNAUTHORIZED' });
  fail = false;
  await client.write('players.reset', [{ owner: 'fixture' }]);
  assert.equal(calls.at(-1).headers['X-SP-CSRF'], undefined);
});

test('admin panel uses explicit owner login, batch confirmation and text-only feedback rendering', () => {
  const panel = source('public/js/ui/adminPanel.js');
  const api = source('public/js/ui/adminApi.js');
  const lobby = source('public/js/screens/lobby.js');
  for (const resource of ['players', 'claims', 'avatars', 'namecards', 'feedback', 'audit']) assert.ok(panel.includes(`'${resource}'`));
  for (const action of ['claims.release', 'claims.reassign', 'players.reset', 'feedback.status', 'feedback.reply', 'feedback.delete']) assert.ok(panel.includes(action));
  assert.match(panel, /confirmDialog\(/);
  assert.match(panel, /type="password" autocomplete="off"/);
  assert.match(panel, /finally \{ setKey\(''\)/);
  assert.match(panel, /data\.results/);
  assert.match(panel, /r\.ok \?/);
  assert.match(panel, /r\.partial/);
  assert.match(panel, /expectedOwner: row\.owner, expectedAt: row\.at/);
  assert.match(panel, /role="status"/);
  assert.match(panel, /generation\.current/);
  assert.match(panel, /closeOnBackdrop=\$\{false\}/);
  assert.match(lobby, /adminOpen \? html`<\$\{AdminPanel\}/);
  assert.doesNotMatch(panel + api, /localStorage|sessionStorage|savePref|innerHTML|console\./);
});

test('closing the admin panel also logs out, without a redundant logout button', () => {
  const panel = source('public/js/ui/adminPanel.js');
  assert.doesNotMatch(panel, /退出管理|const logout =/);
  assert.match(panel, /actions=\$\{html`<\$\{Button\} disabled=\$\{busy\} onClick=\$\{close\}>\$\{t\('关闭'\)\}/);
  assert.match(panel, /useEffect\(\(\) => \(\) => \{ generation\.current\+\+; client\.logout\(\)\.catch/);
});

test('every admin tab keeps the same bars, so the list never jumps between tabs', () => {
  const panel = source('public/js/ui/adminPanel.js');
  const css = source('public/css/screens/lobby.css');
  for (const slot of ['admin-tabs', 'admin-shell', 'admin-note', 'admin-search', 'admin-bar', 'admin-op', 'admin-list', 'admin-pagination']) {
    assert.match(panel, new RegExp(`class="${slot}"`), slot);
  }
  // the tab-specific pieces live in the fixed rows, never in their own extra block
  assert.doesNotMatch(panel, /admin-bulk/);
  assert.match(panel, /const NOTES = \{/);
  // the tabs are pinned with the search directly beneath them, then the tab's note and the two action rows
  const order = ['admin-tabs', 'admin-search', 'admin-note', 'admin-bar', 'admin-op', 'admin-list', 'admin-pagination']
    .map((slot) => [slot, panel.indexOf(`class="${slot}"`)]);
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1][1] >= 0 && order[i - 1][1] < order[i][1], `${order[i - 1][0]} before ${order[i][0]}`);
  // every row has one height (the same variable: .5rem of the scaled design, never below 34px) and the list is the only
  // growing/scrolling part
  assert.match(css, /\.modal__box\.admin-panel \{[^}]*--admin-bar-h:\s*max\(\.5rem, 34px\)/s);
  assert.ok((css.match(/height:\s*var\(--admin-bar-h\)/g) || []).length >= 4, 'tabs, note, search/bar/op and pages share --admin-bar-h');
  assert.match(css, /\.admin-list \{[^}]*flex:\s*1 1 auto[^}]*overflow-y:\s*auto/s);
  // the body and the footer stay put while only the list scrolls: 关闭 sits bottom right
  assert.match(css, /\.admin-panel \.modal__body \{[^}]*flex:\s*1 1 auto[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.admin-panel \.modal__actions \{[^}]*justify-content:\s*flex-end/s);
});

test('feedback list owns the board space and composing is a separate native modal', () => {
  const board = source('public/js/ui/feedbackBoard.js');
  const css = source('public/css/screens/lobby.css');
  assert.match(board, /\[composeOpen, setComposeOpen\] = useState\(false\)/);
  assert.match(board, /setComposeOpen\(true\)/);
  assert.match(board, /composeOpen \? html`<\$\{Modal\} open=\$\{true\}/);
  assert.match(board, /class="feedback-compose/);
  assert.match(board, /rows="8"/);
  assert.match(board, /setComposeOpen\(false\)/);
  // the toolbar is pinned, the four columns scroll inside; the footer keeps 关闭反馈板 bottom right
  assert.match(css, /\.feedback-board \.modal__body \{[^}]*flex:\s*1 1 auto[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.feedback-board \.modal__actions \{[^}]*justify-content:\s*flex-end/s);
  assert.match(css, /\.fb-columns[^}]*flex:\s*1 1 auto/s);
  assert.match(css, /\.fb-column__list \{[^}]*flex:\s*1 1 auto[^}]*overflow-y:\s*auto/s);
  assert.match(css, /@media \(max-width: 860px\)/);
  // moderation lives in the admin panel now: no maintainer login or board-side status buttons
  assert.doesNotMatch(board, /维护者入口|维护者密码|维护者模式|feedback\.token|NOT_MAINTAINER|'status'/);
});
