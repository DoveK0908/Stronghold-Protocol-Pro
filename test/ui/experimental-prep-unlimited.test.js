import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { experimentalOptions, experimentalSummary, experimentalChanged, experimentalCopy } from '../../public/js/ui/experimental.js';
const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
test('the room dialog offers a normal countdown with no forced prep end', () => {
  const ui = read('public/js/ui/experimental.js');
  assert.ok(ui.includes('id="experimental-prep-unlimited"'));
  assert.ok(ui.includes("change('prepUnlimited', e.currentTarget.checked)"));
  const off = { revivalEnabled: false, disableSharedPool: false };
  assert.deepEqual(experimentalOptions(off), off);
  assert.deepEqual(experimentalOptions({ ...off, prepUnlimited: true }), { ...off, prepUnlimited: true });
  assert.equal(experimentalChanged({ ...off, prepUnlimited: true }), true);
  assert.ok(experimentalSummary({ ...off, prepUnlimited: true }).includes('无限休整期'));
  assert.ok(experimentalCopy('prepUnlimited')[1].includes('归零后不强制结束'));
  const en = JSON.parse(read('public/i18n/en.json'));
  for (const zh of experimentalCopy('prepUnlimited')) {
    assert.equal(typeof en[zh], 'string', zh);
    assert.ok(en[zh].length > 0 && !/[一-鿿]/.test(en[zh]));
  }
});
