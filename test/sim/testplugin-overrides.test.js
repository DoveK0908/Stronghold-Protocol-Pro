// test/sim/testplugin-overrides.test.js — 测试插件 v2 (TESTPLUGIN-V2-CONTRACT §4): the per-piece `testStats` /
// `testTraits` / `testBonds` overrides reach the shared sim. Everything here goes through `server/sim/` and
// `public/js/battle/operatorTraits.js` — the same modules the browser loads through simLoader/simHost — so a passing
// test means both ends agree: (1) simdata getChess folds testStats into the def and its cache key, (2) players.js
// carries the three overrides onto the unit and the def's stats reach `_makeAlly`, (3) the trait runtime installs the
// picked garrison traits by id, (4) bondsMeta computeBonds lets a piece's override replace its bonds while the
// mode-off strip (offBondCounts) keeps counting the real bonds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataSource, getDefaultSource, hasGeneratedData } from '../../server/sim/simdata.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { GameData } from '../../server/match/gamedata.js';
import { computeBonds, offBondCounts } from '../../server/match/bondsMeta.js';
import { installOperatorTraits } from '../../public/js/battle/operatorTraits.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { DATA } from '../match/harness.js';

const skip = !hasGeneratedData() && 'no generated data (run node tools/build-data.mjs)';
const ds = getDefaultSource();
const ID = 'chess_char_1_01_a'; // 隐现, a normal (non-elite) operator whose def has no module choice

test('testStats: the def carries the override, the default def and its cache are untouched', { skip }, () => {
  const data = new DataSource(ds.raw, null);
  const base = data.getChess(ID);
  assert.ok(base && base.stats.atk != null);
  const def = data.getChess(ID, { testStats: { atk: 1234, maxHp: 4321 } });
  assert.notEqual(def, base);
  assert.equal(def.stats.atk, 1234);
  assert.equal(def.stats.maxHp, 4321);
  assert.equal(def.stats.def, base.stats.def, 'keys not given keep the record value');
  assert.deepEqual(def.testStats, { atk: 1234, maxHp: 4321 }, 'the applied override stays on the def for debugging');
  assert.equal(data.getChess(ID), base, 'the default def is still the same cached object');
  assert.equal(base.testStats, undefined);
  assert.notEqual(base.stats.atk, 1234);
  // the cache key is the effective override, so the same values in another key order hit the same entry
  assert.equal(data.getChess(ID, { testStats: { maxHp: 4321, atk: 1234 } }), def);
  const other = data.getChess(ID, { testStats: { atk: 9 } });
  assert.notEqual(other, def);
  assert.equal(other.stats.atk, 9);
  assert.equal(def.stats.atk, 1234, 'a later override never rewrites an earlier def');
  // a real loadout composes with the override: both halves of the key differ
  const flavoured = data.getChess(ID, { skillIndex: 0, testStats: { atk: 9 } });
  assert.notEqual(flavoured, other);
  assert.equal(flavoured.loadout.skillIndex, 0);
  assert.equal(flavoured.stats.atk, 9);
});

test('testStats: values are clamped, non-numbers and unknown keys are ignored', { skip }, () => {
  const data = new DataSource(ds.raw, null);
  const base = data.getChess(ID);
  const def = data.getChess(ID, { testStats: { atk: -5, maxHp: 0, aspd: 0, cost: 1e9, res: 'x', nope: 7 } });
  assert.equal(def.stats.atk, 0, 'negative atk clamps to 0');
  assert.equal(def.stats.maxHp, 1, 'maxHp keeps a floor of 1');
  assert.equal(def.stats.aspd, 1, 'aspd keeps a floor of 1');
  assert.equal(def.stats.cost, 99999, 'values cap at the op command ceiling');
  assert.equal(def.stats.res, base.stats.res, 'a non-numeric value leaves the stat alone');
  assert.equal('nope' in def.stats, false, 'unknown keys never reach the stats');
  assert.deepEqual(def.testStats, { atk: 0, maxHp: 1, aspd: 1, cost: 99999 });
});

test('a deployed ally fights with its testStats and carries testTraits / testBonds', { skip }, () => {
  const baseAtk = new DataSource(ds.raw, null).getChess(ID).stats.atk;
  const input = (extra) => ({
    playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, bandId: null, playerEffects: [],
    units: [{ uid: 1, kind: 'chess', chessId: ID, row: 10, col: 5, ...extra }],
  });
  const overridden = makeBattle({ players: [input({ testStats: { atk: 1234, maxHp: 4321 }, testTraits: ['g_test_norm'], testBonds: ['yanShip'] })], autoFinish: false });
  overridden.step();
  const u = overridden.b.allyUnits.find((x) => x.uid === 1);
  assert.ok(u, 'the ally deployed');
  assert.equal(u.base.atk, 1234, 'the unit base attack is the override');
  assert.equal(u.base.maxHp, 4321);
  assert.equal(u.maxHp, 4321);
  assert.deepEqual(u.testTraits, ['g_test_norm'], 'the picked garrison ids ride on the unit');
  assert.deepEqual(u.testBonds, ['yanShip'], 'the bond override rides on the unit');
  const plain = makeBattle({ players: [input({})], autoFinish: false });
  plain.step();
  const p = plain.b.allyUnits.find((x) => x.uid === 1);
  assert.equal(p.base.atk, baseAtk, 'no testStats → the record value');
  assert.equal(p.testTraits, undefined, 'undefined = no override');
  assert.equal(p.testBonds, undefined);
  // `[]` is an explicit clear (the player emptied 特质 / 盟约), not "no override": the unit carries the empty list
  const cleared = makeBattle({ players: [input({ testTraits: [], testBonds: [] })], autoFinish: false });
  cleared.step();
  const c = cleared.b.allyUnits.find((x) => x.uid === 1);
  assert.deepEqual(c.testTraits, [], 'an empty testTraits survives as an empty array');
  assert.deepEqual(c.testBonds, [], 'an empty testBonds survives as an empty array');
});

const traitRecord = (garrisonId, bond, elite = false) => ({
  garrisonId, name: `Synthetic ${garrisonId}`, desc: '',
  operatorTrait: {
    charId: 'char_999_other', elite, pluginId: 'test-plugin',
    spec: { dsl: 1, talents: [{ when: 'battleStart', do: [{ layers: { bond, amount: 5, maxPerBattle: 3 } }] }] },
  },
});
const withGarrisons = (extra) => ({ ...ds.raw, garrisons: { ...ds.raw.garrisons, ...extra } });

test('testTraits: a picked garrison trait installs on a piece of another character', { skip }, async (t) => {
  const raw = withGarrisons({
    g_test_norm: traitRecord('g_test_norm', 'egirShip'),
    g_test_elite: traitRecord('g_test_elite', 'swiftShip', true),
  });
  const data = new DataSource(raw, null);
  await installOperatorTraits(raw);
  setGameData(raw);
  t.after(async () => { await installOperatorTraits(DATA); setGameData(null); });
  const battle = (testTraits) => {
    const h = makeBattle({
      data, autoFinish: false,
      players: [{
        playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bandId: null, playerEffects: [],
        units: [{ uid: 1, kind: 'chess', chessId: ID, row: 10, col: 5, testTraits }],
        bonds: { egirShip: { active: true, layers: 0, count: 1 }, swiftShip: { active: true, layers: 0, count: 1 } },
      }],
    });
    h.step();
    for (let i = 0; i < 90; i++) h.step();
    return h.b;
  };
  // the record's charId is another operator's: only the testTraits path can install it
  const b = battle(['g_test_norm']);
  assert.equal(b.getPlayer('p1').bonds.egirShip.layers, 3, 'the picked trait fired its battleStart layers');
  assert.equal(b.getPlayer('p1').bonds.swiftShip.layers, 0, 'an unpicked trait does nothing');
  assert.equal(battle([]).getPlayer('p1').bonds.egirShip.layers, 0, 'without testTraits nothing installs');
  assert.equal(battle(['g_unknown']).getPlayer('p1').bonds.egirShip.layers, 0, 'an unknown garrison id is ignored');
  assert.equal(battle(['g_test_elite']).getPlayer('p1').bonds.swiftShip.layers, 0, 'an elite trait never installs on a normal chess');
});

test('the overrides survive the BattleSpec a browser client replays', { skip }, async (t) => {
  // The browser gets the same field through buildBattleSpec → createBattleFromSpec (simLoader/simHost), so the three
  // fields must ride through the JSON round-trip and reach the unit there too.
  const raw = withGarrisons({ g_test_norm: traitRecord('g_test_norm', 'egirShip') });
  const data = new DataSource(raw, null);
  await installOperatorTraits(raw);
  setGameData(raw);
  t.after(async () => { await installOperatorTraits(DATA); setGameData(null); });
  const spec = buildBattleSpec({
    seed: 7, kind: 'normal', stageId: 'act1autochess_m01', rect: { r0: 9, r1: 12, c0: 0, c1: 10 }, timeLimit: 8,
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bandId: null, playerEffects: [],
      units: [{ uid: 1, kind: 'chess', chessId: ID, row: 10, col: 5,
        testStats: { atk: 1234, maxHp: 4321 }, testTraits: ['g_test_norm'], testBonds: ['yanShip'] }],
      bonds: { egirShip: { active: true, layers: 0, count: 1 } },
    }],
    spawns: [], routes: [],
  });
  const sent = spec.players[0].units[0];
  assert.deepEqual(sent.testStats, { atk: 1234, maxHp: 4321 }, 'testStats stays in the spec');
  assert.deepEqual(sent.testTraits, ['g_test_norm'], 'testTraits stays in the spec');
  assert.deepEqual(sent.testBonds, ['yanShip'], 'testBonds stays in the spec');
  const b = createBattleFromSpec(spec, data, { quiet: true });
  b.start();
  for (let i = 0; i < 90; i++) b.step();
  const u = b.getPlayer('p1').units.find((x) => x.kind === 'op');
  assert.equal(u.base.atk, 1234, 'the spec battle deploys the overridden atk');
  assert.equal(u.base.maxHp, 4321);
  assert.deepEqual(u.testTraits, ['g_test_norm']);
  assert.deepEqual(u.testBonds, ['yanShip']);
  assert.equal(b.getPlayer('p1').bonds.egirShip.layers, 3, 'the picked trait installed inside the spec battle');
});

test('computeBonds: a piece bond override replaces that piece only; offBondCounts keeps the real bonds', { skip }, () => {
  const gd = new GameData(DATA, 'mode_multi_normal');
  let uid = 1;
  const piece = (id) => ({ uid: uid++, kind: 'chess', id, items: [] });
  const state = ({ board = [], testOps = null } = {}) => {
    const b = new Map();
    board.forEach((p, i) => b.set(`${9 + (i % 4)},${2 + Math.floor(i / 4)}`, p));
    return { board: b, hand: new Array(10).fill(null), layers: {}, ...(testOps ? { _testOps: testOps } : null) };
  };
  const yan = Object.values(DATA.chess)
    .filter((c) => c.visible && !c.isGolden && c.bonds.includes('yanShip') && !c.bonds.includes('maniShip'))
    .slice(0, 3).map((c) => c.chessId);
  assert.equal(yan.length, 3, 'the data has three 燕鸥 members outside 调和');
  const p = yan.map(piece);
  const full = computeBonds(gd, state({ board: p }));
  assert.equal(full.yanShip.count, 3);
  const dropped = computeBonds(gd, state({ board: p, testOps: { [p[0].id]: { bonds: [] } } }));
  assert.equal(dropped.yanShip.count, 2, 'an empty override drops that one piece');
  assert.equal(full.yanShip.count, 3, 'the untouched caller state still counts 3');
  const mani = dropped.maniShip.count - full.maniShip.count;
  assert.equal(mani, 0);
  const moved = computeBonds(gd, state({ board: p, testOps: { [p[0].id]: { bonds: ['maniShip'] } } }));
  assert.equal(moved.maniShip.count, 1, 'the replacement bond counts instead');
  assert.equal(moved.yanShip.count, 3, 'two 燕鸥 members plus 调和\'s +1 (maniShip is now active)');
  assert.equal(moved.yanShip.harmony, 1);
  const junk = computeBonds(gd, state({ board: p, testOps: { [p[0].id]: { bonds: ['nope', 'yanShip'] } } }));
  assert.equal(junk.yanShip.count, 3, 'an unknown bond id is ignored');
  // the 本局禁用 strip counts the real bonds: a test override never rewrites what the mode switches off
  const offBond = [...gd.modeInactiveBonds].find((id) => (full[id]?.count ?? 0) > 0);
  if (offBond) {
    const member = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.bonds.includes(offBond));
    const q = piece(member.chessId);
    const before = offBondCounts(gd, state({ board: [q] }));
    const after = offBondCounts(gd, state({ board: [q], testOps: { [q.id]: { bonds: [] } } }));
    assert.equal(before[offBond].count, after[offBond].count, 'offBondCounts ignores the override');
  }
});
