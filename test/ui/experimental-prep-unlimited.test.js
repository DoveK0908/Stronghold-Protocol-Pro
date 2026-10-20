import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 无限休整期 (玩法#05): the room dialog's switch, the wire shape and the server's untimed prep.
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('the room dialog offers 无限休整期 and mirrors it onto the wire', async () => {
  const { experimentalOptions, experimentalSummary, experimentalChanged } = await import('../../public/js/ui/experimental.js');
  const ui = read('public/js/ui/experimental.js');
  assert.match(ui, /id="experimental-prep-unlimited"/);
  assert.match(ui, /<input id="experimental-prep-unlimited" type="checkbox" role="switch" checked=\$\{options\.prepUnlimited === true\}/);
  assert.match(ui, /change\('prepUnlimited', e\.currentTarget\.checked\)/);
  assert.match(ui, /if \(options\.prepUnlimited === true\) rules = `\$\{rules\} · \$\{t\('无限休整期'\)\}`/);
  const off = { revivalEnabled: false, disableSharedPool: false };
  assert.deepEqual(experimentalOptions(off), off);
  assert.deepEqual(experimentalOptions({ ...off, prepUnlimited: true }), { ...off, prepUnlimited: true });
  assert.equal(experimentalChanged({ ...off, prepUnlimited: true }), true);
  assert.match(experimentalSummary({ ...off, prepUnlimited: true }), /无限休整期/);
  const en = JSON.parse(read('public/i18n/en.json'));
  for (const zh of ['无限休整期', '休整期不再倒计时；所有还活着的博士都点「准备就绪」之后才进入战斗。']) {
    assert.equal(typeof en[zh], 'string', zh);
    assert.ok(en[zh].length > 0 && !/[一-鿿]/.test(en[zh]));
  }
});

test('the server drops the prep deadline for that room and the audit knows it', () => {
  const prep = read('server/match/match/prep.js');
  assert.match(prep, /const untimed = this\.soloUntimed \|\| this\.experimental\?\.prepUnlimited === true;/);
  assert.match(prep, /const secs = untimed \? null : this\.gd\.prepTime\(this\.round\);/);
  const audit = read('server/match/audit.js');
  assert.match(audit, /if \(m\.soloUntimed \|\| m\.experimental\?\.prepUnlimited === true\) \{ if \(m\.deadline\) fail\('untimed prep is timed'\); \}/);
});
