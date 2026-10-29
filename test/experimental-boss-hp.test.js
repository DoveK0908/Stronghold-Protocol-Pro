// 首领血量 (experimental `bossHpPercent`; the owner's request, 2026-10-28): one numeric room rule that scales the
// Final Assault / Hidden Core leader pool. The wire rule is the switches' rule with a bounded integer instead of a
// boolean (only a value off the 100% default rides the wire), and the pool math has a single point — finalAssault
// bossPoolHp — which every caller (the match's SharedBossPool, the bot preview, the audit) goes through.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPERIMENTAL_DEFAULTS, EXPERIMENTAL_NUMERIC, experimentalKey, experimentalOptions, isExperimental, numericValue,
  sameExperimental,
} from '../shared/experimental.js';
import { validateC2S } from '../shared/protocol.js';
import { bossPoolHp } from '../server/match/finalAssault.js';
import { makeMatch as makeHarnessMatch, DATA as LIVE_DATA } from './match/harness.js';
import { officialBossData } from './match/official-boss-fixture.js';

const RULE = EXPERIMENTAL_NUMERIC.bossHpPercent;
const withBossHp = (percent) => ({ ...EXPERIMENTAL_DEFAULTS, bossHpPercent: percent });
const DATA = officialBossData(LIVE_DATA);
const makeMatch = (opts = {}) => makeHarnessMatch({ ...opts, data: opts.data ?? DATA });

test('the rule has no gameplay upper cap: 100 by default, at least 25 in steps of 5', () => {
  assert.deepEqual({ ...RULE }, { def: 100, min: 25, step: 5 });
  for (const n of [305, 1000, 10000, 1000000]) {
    assert.equal(numericValue(withBossHp(n), 'bossHpPercent'), n);
    assert.equal(experimentalOptions(withBossHp(n)).bossHpPercent, n);
    assert.equal(validateC2S({ t: 'room.setExperimental', experimental: withBossHp(n) }), null);
  }
  assert.equal(numericValue({}, 'bossHpPercent'), 100, 'off the wire');
  assert.equal(numericValue(undefined, 'bossHpPercent'), 100, 'no options at all');
  assert.equal(numericValue({ bossHpPercent: 150 }, 'bossHpPercent'), 150, 'in range');
  for (const bad of [20, 301, 0, -50, 152, 12.5, '150', null, true, Infinity, NaN, Number.MAX_VALUE]) {
    assert.equal(numericValue({ bossHpPercent: bad }, 'bossHpPercent'), 100, `${JSON.stringify(bad)} falls back to 100`);
  }
});

test('the option rides the wire only when it is off 100%', () => {
  assert.deepEqual(experimentalOptions(EXPERIMENTAL_DEFAULTS), { revivalEnabled: false, disableSharedPool: false });
  assert.equal(experimentalOptions(withBossHp(100)).bossHpPercent, undefined, 'the default is not uploaded');
  assert.equal(experimentalOptions(withBossHp(150)).bossHpPercent, 150);
  assert.equal(experimentalKey(EXPERIMENTAL_DEFAULTS).includes('bossHpPercent'), false);
  assert.equal(experimentalKey(withBossHp(150)), '00:bossHpPercent=150');
  assert.equal(experimentalKey({ ...withBossHp(150), revivalEnabled: true }), '10:bossHpPercent=150');
});

test('two rooms differ as soon as one moves the pool', () => {
  assert.equal(sameExperimental(withBossHp(150), withBossHp(150)), true);
  assert.equal(sameExperimental(withBossHp(150), withBossHp(100)), false);
  assert.equal(sameExperimental(withBossHp(150), EXPERIMENTAL_DEFAULTS), false, 'absent reads as 100');
  assert.equal(sameExperimental(EXPERIMENTAL_DEFAULTS, withBossHp(100)), true, 'absent and 100 are the same rule');
});

test('the protocol accepts an in-range percentage and refuses the rest', () => {
  assert.equal(isExperimental(withBossHp(150)), true);
  assert.equal(isExperimental(withBossHp(25)), true);
  assert.equal(isExperimental(withBossHp(300)), true);
  for (const bad of [20, 301, 152, 12.5, '150']) assert.equal(isExperimental(withBossHp(bad)), false, `${bad}`);
  // the guard is what room.create / room.setExperimental run; validateC2S answers an error string, or null
  const create = (experimental) => validateC2S({ t: 'room.create', mode: 'coop', difficulty: 'HARD', experimental });
  assert.equal(create(withBossHp(50)), null);
  assert.equal(create(withBossHp(20)), 'bad field experimental');
  assert.equal(validateC2S({ t: 'room.setExperimental', experimental: withBossHp(150) }), null);
  assert.equal(validateC2S({ t: 'room.setExperimental', experimental: withBossHp(151) }), 'bad field experimental');
});

test('the pool is bloodPoint × alive × the room percentage, still one HP at the floor', () => {
  const ids = Object.keys(DATA.bosses);
  for (const difficulty of ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']) {
    const gd = makeMatch({ difficulty }).m.gd;
    for (const id of ids) {
      const base = DATA.bosses[id].bloodPoint[difficulty];
      for (const n of [1, 2, 3, 4]) {
        const plain = bossPoolHp(gd, id, n);
        assert.equal(bossPoolHp(gd, id, n, { hpPercent: 100 }), plain, `${id} ${difficulty} ×${n}: 100% is the official pool`);
        assert.equal(bossPoolHp(gd, id, n, { hpPercent: 50 }), Math.max(1, Math.round(base * n / 2)), `${id} ${difficulty} ×${n} at 50%`);
        for (const hpPercent of [300, 305, 1000, 10000]) {
          assert.equal(bossPoolHp(gd, id, n, { hpPercent }), Math.round(plain * hpPercent / 100), `${id} ${difficulty} ×${n} at ${hpPercent}%`);
        }
      }
    }
  }
  const gd = makeMatch({ difficulty: 'NORMAL' }).m.gd;
  const id = ids[0];
  assert.equal(bossPoolHp(gd, id, 4), bossPoolHp(gd, id, 4, { hpPercent: undefined }), 'no percentage: the rule default');
  assert.equal(bossPoolHp(gd, id, 4, { hpPercent: 0 }), bossPoolHp(gd, id, 4), 'a nonsense percentage does not zero the pool');
});

test('the match keeps the room percentage and builds the pool out of it', () => {
  const h = makeMatch({ humans: 4, difficulty: 'HARD', fake: true, experimental: withBossHp(50) }).start();
  const m = h.m;
  assert.equal(m.experimental.bossHpPercent, 50, 'the room snapshot keeps the number');
  // exactly the call bossRounds makes when it opens the fight
  assert.equal(bossPoolHp(m.gd, m.bossId, 4, { hpPercent: m.experimental.bossHpPercent }),
    bossPoolHp(m.gd, m.bossId, 4, { hpPercent: 50 }));
  assert.equal(bossPoolHp(m.gd, m.bossId, 4, { hpPercent: m.experimental.bossHpPercent }),
    Math.round(bossPoolHp(m.gd, m.bossId, 4) / 2));
  m.dispose();
  const plain = makeMatch({ humans: 4, difficulty: 'HARD', fake: true }).start();
  assert.equal(plain.m.experimental.bossHpPercent, undefined, 'a room that never touched it carries nothing');
  plain.m.dispose();
});
