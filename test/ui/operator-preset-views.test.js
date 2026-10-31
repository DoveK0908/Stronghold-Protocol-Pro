// test/ui/operator-preset-views.test.js — an imported 干员预设 has to survive the views rebuild (feedback 2026-10-31):
// the store keeps the settings by operator (`byChar` / `notOwnedChars`, DESIGN §35.23) and shows them as views
// (`entries` / `notOwned`), and every sync's prepare calls refreshViews — which rebuilds the views FROM the by-operator
// settings. Publishing only the views made the import look applied and then reverted a moment later (潜能 / 练度 是
// settings of their own, so they alone stuck). The 自选 picks likewise live under their version's own key
// (diyModel.js diyPrefKey), not the base one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const chess = readJson('data/chess.json'), backups = readJson('data/backups.json');

const OP = await import('../../public/js/ui/operatorPresetModel.js');
const D = await import('../../public/js/ui/diyModel.js');
const M = await import('../../public/js/ui/loadoutModel.js');
const S = await import('../../public/js/ui/loadoutSync.js');
const { data } = await import('../../public/js/data.js');
const { createStore } = await import('../../public/js/store.js');

const lookup = (id) => (Object.hasOwn(chess, id) ? chess[id] : null);
const kitted = Object.keys(backups.diy.operators);
const deps = { lookup, data: { chess, backups }, kitted };
const slot = Object.keys(backups.diy.slots)[0];
/** A complete preset: one skill/module choice, one 干员持有 mark, one 自选 pick. */
const SETTING = {
  entries: { chess_char_1_01_a: { skill: 0 } },
  notOwned: ['chess_char_3_01_a'], // 能天使: a droppable chess that is also its operator's slot (the view's own id)
  diy: { [slot]: D.defaultPick(kitted[0], slot, deps.data) },
  skins: {},
};
const preset = () => OP.parseOperatorPreset(OP.operatorPresetPayload(SETTING, { now: 0 }));
/** A store shaped like the app's (ui/loadoutSync.js loadoutStore: settings by operator, views beside them). */
const v2Target = () => createStore({ entries: {}, byChar: {}, ops: {}, notOwned: [], notOwnedChars: [], diy: {}, diyVersion: 'act2autochess', diyKitted: kitted, open: true });
const show = (c) => data.setContent({ id: 'def', values: new Map([['chess', c], ['backups', backups]]) });

test('an imported preset publishes the by-operator settings: the next views rebuild keeps the import', () => {
  show(chess);
  const target = v2Target();
  const saved = [];
  const result = S.applyOperatorPreset(preset(), deps, { target, persist: (key, value) => saved.push({ key, value }) });
  assert.equal(result.ok, true);
  const imported = {
    entries: structuredClone(target.get().entries),
    notOwned: [...target.get().notOwned],
    diy: structuredClone(target.get().diy),
  };
  assert.deepEqual(imported.entries, SETTING.entries);
  assert.deepEqual(imported.notOwned, SETTING.notOwned);
  assert.deepEqual(imported.diy, SETTING.diy);
  // the settings the views are rebuilt from, and what is stored for the next session
  const byChar = { [chess.chess_char_1_01_a.charId]: { skill: 0 } };
  assert.deepEqual(target.get().byChar, byChar);
  assert.deepEqual(target.get().notOwnedChars, [chess.chess_char_3_01_a.charId]);
  assert.deepEqual(saved.find((row) => row.key === 'loadout').value.byChar, byChar);
  assert.deepEqual(saved.find((row) => row.key === 'ownership').value.notOwnedChars, [chess.chess_char_3_01_a.charId]);
  assert.deepEqual(saved.find((row) => row.key === 'diy').value.picks, SETTING.diy);
  // what every sync's prepare does before it sends — the reported "changed, then immediately reset"
  S.refreshViews({ target });
  assert.deepEqual(target.get().entries, imported.entries);
  assert.deepEqual(target.get().notOwned, imported.notOwned);
  assert.deepEqual(target.get().diy, imported.diy);
  // and the views are the by-operator settings' own view (an edit through them lands on the right operator)
  assert.deepEqual(M.entriesView(target.get().byChar, M.charKeyMap(Object.values(chess))), imported.entries);
  data.setContent(null);
});

test('an explicit empty preset clears the by-operator settings too, not only the views', () => {
  show(chess);
  const target = v2Target();
  target.set({ entries: SETTING.entries, byChar: { [chess.chess_char_1_01_a.charId]: { skill: 0 } }, notOwned: SETTING.notOwned, notOwnedChars: [chess.chess_char_3_01_a.charId] });
  const saved = [];
  const empty = { entries: {}, notOwned: [], diy: {}, skins: {} };
  const result = S.applyOperatorPreset(OP.parseOperatorPreset(OP.operatorPresetPayload(empty, { now: 0 })), deps, { target, persist: (key, value) => saved.push({ key, value }) });
  assert.equal(result.ok, true);
  assert.deepEqual(target.get().byChar, {});
  assert.deepEqual(target.get().notOwnedChars, []);
  S.refreshViews({ target });
  assert.deepEqual(target.get().entries, {});
  assert.deepEqual(target.get().notOwned, []);
  data.setContent(null);
});

test('the 自选 of the version on screen is persisted under that version\'s own key', () => {
  show(chess);
  const target = v2Target();
  target.set({ diyVersion: 'act1autochess@V1_1' });
  const saved = [];
  const result = S.applyOperatorPreset(preset(), deps, { target, persist: (key, value) => saved.push({ key, value }) });
  assert.equal(result.ok, true);
  const key = D.diyPrefKey('act1autochess@V1_1');
  assert.equal(key, 'diy.act1autochess-v1_1');
  assert.deepEqual(saved.find((row) => row.key === key)?.value.picks, SETTING.diy);
  assert.equal(saved.some((row) => row.key === 'diy'), false, 'the base key belongs to 第二期下半');
  data.setContent(null);
});
