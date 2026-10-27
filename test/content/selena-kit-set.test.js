// test/content/selena-kit-set.test.js — the selena 0.4.1 comparison kits (SP_KIT_SET=selena).
//
// kits/index.js swaps 丰川祥子 and 结城理 to `ops/op-oblvns.selena.js` / `ops/op-makoto.selena.js` when the server boots
// with SP_KIT_SET=selena — a comparison build the user A/B tests against this tree's own kits. The env is read once at
// module load, so a test process cannot flip it; what is checked here is the default boot (this process) plus that both
// swapped-in files load and register exactly the charId they replace (a second key would silently override another
// operator in selena mode).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { KITS, OPERATOR_KIT_PATHS, SELENA_KIT_MODE, SELENA_KIT_CHARS } from '../../server/sim/content/kits/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OPS = resolve(HERE, '../../server/sim/content/kits/ops');

test('the default boot keeps this tree\'s own kits for 丰川祥子 and 结城理', () => {
  assert.equal(SELENA_KIT_MODE, false, 'no SP_KIT_SET=selena in this process');
  assert.deepEqual([...SELENA_KIT_CHARS], [], 'nothing is replaced');
  assert.ok(OPERATOR_KIT_PATHS.includes('op-oblvns.js'));
  assert.ok(OPERATOR_KIT_PATHS.includes('op-makoto.js'));
  assert.ok(!OPERATOR_KIT_PATHS.includes('op-oblvns.selena.js'));
  assert.equal(typeof KITS.char_4182_oblvns, 'function');
  assert.equal(typeof KITS.char_4217_makoto, 'function');
});

test('both selena comparison files exist and register exactly the charId they replace', async () => {
  for (const [file, charId] of [['op-oblvns.selena.js', 'char_4182_oblvns'], ['op-makoto.selena.js', 'char_4217_makoto']]) {
    assert.ok(existsSync(resolve(OPS, file)), `${file} is in kits/ops`);
    const mod = await import(`../../server/sim/content/kits/ops/${file}`);
    const reg = mod.default;
    assert.equal(typeof reg, 'object', `${file} default-exports a registry`);
    assert.deepEqual(Object.keys(reg), [charId], `${file} registers only ${charId}`);
    assert.equal(typeof reg[charId], 'function', 'as a kit builder');
  }
  // the 替身 kit pulls its shared helper along; it must not shadow this tree's tier-1 helpers
  assert.ok(existsSync(resolve(OPS, '../shared/mod-tier3.js')), 'mod-tier3.js came with the selena kit');
});
