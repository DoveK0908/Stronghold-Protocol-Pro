// The lobby latency badge must not change width with the measured value: the ping pill reserves a fixed width and the
// number is tabular, so a 1 → 9999 → -- change never shoves the toolbar to the right.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../public/css/screens/lobby.css', import.meta.url), 'utf8');

test('the lobby latency pill has one width whatever the ping value', () => {
  assert.match(css, /\.hub-topbar \.latency-status \.ping \{ width: max\(\.8rem, 78px\); justify-content: center; overflow: hidden; \}/);
  assert.match(css, /\.hub-topbar \.ping__value \{ min-width: 2\.2ch; text-align: right; font-variant-numeric: tabular-nums; \}/);
  // no leftover min-width-only rule that would still let the pill grow
  assert.doesNotMatch(css, /\.hub-topbar \.latency-status \.ping \{[^}]*min-width: max\(\.72rem, 70px\)/);
});
