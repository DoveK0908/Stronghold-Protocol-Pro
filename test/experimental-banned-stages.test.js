// 地图禁用 (玩法#03): the ban list rides the room's experimental options and filters the stage draw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bannedStages, experimentalKey, experimentalOptions, isExperimental, MAX_BANNED_STAGES, sameExperimental } from '../shared/experimental.js';
import { setupMatchWaves } from '../server/match/waves.js';
import { makeMatch } from './match/harness.js';
import { DATA } from './match/harness.js';
import { createRng } from '../server/sim/rng.js';
import { GameData } from '../server/match/gamedata.js';

const base = { revivalEnabled: false, disableSharedPool: false };

test('bannedStages de-duplicates, sorts, drops junk and caps the list', () => {
  assert.deepEqual(bannedStages({ ...base, bannedStages: ['b', 'a', 'b', '', 7, 'a'] }), ['a', 'b']);
  assert.deepEqual(bannedStages({ ...base }), []);
  assert.deepEqual(bannedStages({ ...base, bannedStages: 'nope' }), []);
  const many = Array.from({ length: MAX_BANNED_STAGES + 6 }, (_, i) => `stage_${String(i).padStart(2, '0')}`);
  assert.equal(bannedStages({ ...base, bannedStages: many }).length, MAX_BANNED_STAGES);
});

test('isExperimental accepts a bounded stage list and rejects the rest', () => {
  assert.equal(isExperimental({ ...base, bannedStages: ['act1autochess_m02'] }), true);
  assert.equal(isExperimental({ ...base, bannedStages: ['act1autochess_m02'], playerCapacity: 8 }), true);
  assert.equal(isExperimental({ ...base, bannedStages: [] }), true);
  assert.equal(isExperimental({ ...base, bannedStages: [1, 2] }), false);
  assert.equal(isExperimental({ ...base, bannedStages: 'act1autochess_m02' }), false);
  assert.equal(isExperimental({ ...base, bannedStages: ['not a stage!'] }), false);
  assert.equal(isExperimental({ ...base, bannedStages: Array.from({ length: MAX_BANNED_STAGES + 1 }, (_, i) => `s${i}`) }), false);
});

test('experimentalOptions carries a non-empty ban list and omits an empty one', () => {
  assert.deepEqual(experimentalOptions({ ...base }), base);
  assert.deepEqual(experimentalOptions({ ...base, bannedStages: [] }), base);
  const wire = experimentalOptions({ ...base, bannedStages: ['b', 'a'] });
  assert.deepEqual(wire, { ...base, bannedStages: ['a', 'b'] });
  assert.equal(Object.isFrozen(wire.bannedStages), true);
});

test('the matchmaking key and the room comparison both see the ban list', () => {
  const plain = { ...base };
  const one = { ...base, bannedStages: ['act1autochess_m02'] };
  const two = { ...base, bannedStages: ['act1autochess_m03'] };
  assert.notEqual(experimentalKey(plain), experimentalKey(one));
  assert.notEqual(experimentalKey(one), experimentalKey(two));
  assert.equal(experimentalKey(one), experimentalKey({ ...base, bannedStages: ['act1autochess_m02', 'act1autochess_m02'] }));
  assert.equal(sameExperimental(plain, one), false);
  assert.equal(sameExperimental(one, { ...base, bannedStages: ['act1autochess_m02'] }), true);
  assert.equal(sameExperimental(one, two), false);
});

test('setupMatchWaves never draws an excluded stage, and ignores a ban that covers the whole pool', () => {
  const gd = new GameData(DATA, 'mode_single_hard');
  const modeStages = gd.mode.stages;
  assert.ok(modeStages.length > 1, 'the harness mode must offer more than one stage');
  const banned = modeStages[0];
  for (let i = 0; i < 40; i++) {
    const setup = setupMatchWaves(gd, createRng(1000 + i), { excludeStages: [banned] });
    assert.notEqual(setup.stageId, banned);
    assert.ok(modeStages.includes(setup.stageId));
  }
  // every stage banned: the room still gets one instead of a null stage
  const all = setupMatchWaves(gd, createRng(7), { excludeStages: modeStages });
  assert.ok(modeStages.includes(all.stageId));
  // no list: unchanged behaviour
  const free = setupMatchWaves(gd, createRng(7));
  assert.ok(modeStages.includes(free.stageId));
});

test('a match built with bannedStages lands on another stage', () => {
  // makeMatch defaults to coop NORMAL, whose pool is data-driven; ban its first stage and start the match.
  const gd = new GameData(DATA, 'mode_multi_normal');
  const banned = gd.mode.stages[0];
  assert.ok(banned, 'the coop NORMAL mode must have at least one stage');
  const h = makeMatch({ fake: true, experimental: { ...base, bannedStages: [banned] } });
  h.start();
  assert.notEqual(h.m.stageId, banned);
  assert.ok(gd.mode.stages.includes(h.m.stageId));
  h.m.dispose?.();
});
