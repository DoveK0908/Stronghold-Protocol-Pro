// The lobby latency badge must not change width with the measured value: the number column is 4ch and tabular (the
// same rule the room top bar uses), so 1 / 9999 / -- all occupy one box and never shove the toolbar to the right.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../public/css/screens/lobby.css', import.meta.url), 'utf8');

test('the lobby latency badge keeps one width whatever the ping value', () => {
  assert.match(css, /\.hub-topbar \.ping__value \{ display: inline-block; min-width: 4ch; text-align: right; font-variant-numeric: tabular-nums; \}/);
  assert.match(css, /\.hub-topbar \.latency-status \.ping \{ align-items: center; flex: none; \}/);
  // the room top bar keeps the identical value rule
  assert.match(css, /\.rs-top \.rs-pingpill \.ping__value \{ min-width: 4ch; \}/);
  // no leftover fixed-width pill from the earlier attempt
  assert.doesNotMatch(css, /\.hub-topbar \.latency-status \.ping \{ width: max/);
});
