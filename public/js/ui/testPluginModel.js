// Native test plugin — client-side model. Catalogs, slot arithmetic and payload shaping only: the shared parser
// (shared/testPlugin.js) and the match stay authoritative, so every number and id here is re-validated server-side.
// No timers, no effects, no requests: the dock renders from the store and sends one command per user action.
import { parseTestPluginArgs } from '../../../shared/testPlugin.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';
import { MODULE_NONE } from '../../../shared/protocol.js';

/** The floating windows the dock can open, in tab order. `key` is the translated msgid. */
export const TEST_WINDOWS = Object.freeze([
  Object.freeze({ id: 'shop', key: t('资源和自选商店') }),
  Object.freeze({ id: 'op', key: t('干员修改') }),
  Object.freeze({ id: 'strategy', key: t('策略替换') }),
  Object.freeze({ id: 'filter', key: t('商店盟约过滤') }),
  Object.freeze({ id: 'round', key: t('回合控制') }),
  Object.freeze({ id: 'map', key: t('地图更改') }),
  Object.freeze({ id: 'enemies', key: t('敌人配置') }),
  Object.freeze({ id: 'boss', key: t('迎战首领') }),
]);

export function testPluginAvailable(pub, mine, myId) {
  return !!(pub?.experimental?.luckConsole === true && pub.phase !== 'RESULT' && !pub.ended
    && myId && mine?.playerId === myId && mine.alive === true && mine.lp > 0 && !mine.pendingDeath
    && mine.testPlugin && pub.players?.some((p) => p.playerId === myId && !p.isBot && !p.left));
}

const integer = (raw) => (typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN);

/** Legacy single-field inputs (资源 / 数量 / 回合), kept for the 资源 window and the existing input tests. */
export function testPluginInput(cmd, fields) {
  let args;
  if (cmd === 'funds') args = { amount: integer(fields.amount) };
  else if (cmd === 'lp') args = { value: integer(fields.amount) };
  else if (cmd === 'round') args = { round: integer(fields.round) };
  else if (cmd === 'level') args = {};
  else if (cmd === 'shop') {
    const slots = String(fields.shop || '').split(',').map((s) => {
      const part = s.trim();
      const colon = part.indexOf(':');
      return { kind: part.slice(0, colon), id: colon < 0 ? '' : part.slice(colon + 1).trim() };
    });
    args = { slots };
  } else if (cmd === 'bond') {
    args = { id: String(fields.id || '').trim(), layers: integer(fields.layers) };
    if (String(fields.count || '').trim()) args.count = integer(fields.count);
  } else if (cmd === 'pick') {
    args = { slot: integer(fields.slot), id: String(fields.id || '').trim() };
  } else if (cmd === 'shopLevel') {
    args = { level: integer(fields.level) };
  } else if (cmd === 'filter') {
    const bonds = String(fields.bonds || '').split(',').map((s) => s.trim()).filter(Boolean);
    args = { bonds, mode: fields.mode === 'all' ? 'all' : 'any' };
  } else if (cmd === 'deployCap') {
    args = { value: integer(fields.cap) };
  } else if (cmd === 'refreshFree') {
    args = { count: integer(fields.count) };
  } else if (cmd === 'ops') {
    args = { id: String(fields.id || '').trim() };
    if (String(fields.potential || '').trim()) args.potential = integer(fields.potential);
    if (String(fields.cultivation || '').trim()) args.cultivate = integer(fields.cultivation);
  } else if (cmd === 'diyRefresh') {
    args = {};
  } else if (cmd === 'map') {
    args = { id: String(fields.id || '').trim() };
  } else args = { id: String(fields.id || '').trim() };
  return parseTestPluginArgs(cmd, args);
}

// ---------------------------------------------------------------------------------------------------
// shop slots
// ---------------------------------------------------------------------------------------------------

/** The side of the layout slot `index` belongs to ('chess' first, then 'item'). */
export function slotKindAt(layout, index) {
  return index < (layout?.chess ?? 0) ? 'chess' : 'item';
}

/** The seat's current shop slots as the command's payload shape (null = an empty slot). */
export function slotEntries(mine) {
  const slots = Array.isArray(mine?.shop?.slots) ? mine.shop.slots : [];
  return slots.map((s) => (s && s.id ? { kind: s.kind, id: s.id } : null));
}

/** `shopSlots` payload after putting `entry` (or null) in `index`, keeping every other slot as it is. */
export function withSlot(mine, index, entry) {
  const slots = slotEntries(mine);
  while (slots.length <= index) slots.push(null);
  slots[index] = entry ? { kind: entry.kind, id: entry.id } : null;
  return { slots };
}

/** `shop` (next-round queue) payload from a queue array or the current slots, dropping empty slots. */
export function queueArgs(slots) {
  return { slots: (slots || []).filter((s) => s && s.id).map((s) => ({ kind: s.kind, id: s.id })) };
}

/** The queued next-round layout from the receipt, or null when nothing is queued. */
export function queuedSlots(mine) {
  const next = mine?.testPlugin?.shopNext;
  return Array.isArray(next) && next.length ? next.map((s) => ({ kind: s.kind, id: s.id })) : null;
}

// ---------------------------------------------------------------------------------------------------
// catalogs (all names and art come from data; no internal id is shown to the player)
// ---------------------------------------------------------------------------------------------------

const mapOf = (name) => data.get(name) || {};
const listOf = (name) => Object.values(mapOf(name));

export function chessOf(id) {
  return mapOf('chess')[id] || null;
}

export function itemOf(id) {
  return mapOf('items')[id] || null;
}

export function assetsOf() {
  return data.get('assets') || {};
}

export function bondRecords() {
  return listOf('bonds').filter((b) => b && b.bondId);
}

export function bandRecords() {
  return listOf('bands').filter((b) => b && b.bandId);
}

export function stageRecords() {
  return listOf('stages').filter((s) => s && s.id);
}

export function skillList(chess) {
  return Array.isArray(chess?.skills) ? chess.skills.filter((s) => s && Number.isInteger(s.index)) : [];
}

/** The 不装模组 choice: native `MODULE_NONE` (a module-less fight, distinct from "keep the default"). */
export { MODULE_NONE };

/** The 模组 choices of a chess: only its elite (golden) record carries the `modules` array. */
export function moduleList(chess) {
  const golden = chess?.goldenId ? chessOf(chess.goldenId) : null;
  const list = Array.isArray(golden?.modules) ? golden.modules : Array.isArray(chess?.modules) ? chess.modules : [];
  return list.filter((m) => m && m.uniEquipId);
}

/** The 特质 records (garrisons.json): the operator's own effects, the list `chess.garrisonIds` picks from.
 *  The short label is added on copies: the page's data files are handed to the browser sim as they are and frozen
 *  there, so writing a display helper back into a record throws (and the game data files are never ours to edit). */
export function traitRecords() {
  return listOf('garrisons')
    .filter((g) => g && g.garrisonId)
    .map((g) => {
      const text = String(g.desc || '').replace(/<[^>]*>/g, '').trim();
      return { ...g, _testLabel: text.length > 18 ? `${text.slice(0, 18)}…` : text || g.garrisonId };
    });
}

/** Shop chess records a test pick may stock, grouped by tier (diy slots need the seat's own pick, so they are left out). */
export function chessRecords() {
  const list = listOf('chess').filter((c) => c && c.chessId && !c.isDiy && !c.isHidden && c.visible !== false);
  list.sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0) || String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
  return list;
}

export function itemRecords() {
  const list = listOf('items').filter((c) => c && (c.trapId || c.id));
  list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh'));
  return list;
}

const enemyKeyOf = (rec) => rec?.key || rec?.enemyKey || rec?.id || null;

/** 普通 / 赏金 / 特训 enemy catalogs, each entry {id, name, level, rank, group?}. */
export function enemyGroups() {
  const enemies = mapOf('enemies');
  const all = Object.values(enemies).filter((e) => e && enemyKeyOf(e));
  const byKey = new Map(all.map((e) => [enemyKeyOf(e), e]));
  const shape = (e) => ({ id: enemyKeyOf(e), name: e.name || enemyKeyOf(e), level: e.level ?? 0, rank: e.rank || '', iconId: e.iconId || null });
  const used = new Set();
  const groups = [];

  const bountyCards = Array.isArray(mapOf('choices')?.cards?.bounty) ? mapOf('choices').cards.bounty : [];
  const bounty = [];
  const seenBounty = new Set();
  for (const c of bountyCards) {
    const e = c && byKey.get(c.enemyKey);
    if (!e || seenBounty.has(c.enemyKey)) continue;
    seenBounty.add(c.enemyKey);
    used.add(c.enemyKey);
    bounty.push({ ...shape(e), coin: c.coin ?? null, count: c.count ?? null });
  }
  if (bounty.length) groups.push({ id: 'bounty', name: t('赏金敌人'), list: bounty });

  const factions = mapOf('factions') || {};
  const types = factions.types && typeof factions.types === 'object' ? factions.types : {};
  const entries = factions.entries && typeof factions.entries === 'object' ? factions.entries : {};
  const buckets = new Map();
  for (const key of Object.keys(entries)) {
    const e = byKey.get(key);
    if (!e) continue;
    const type = entries[key]?.type || 'SPECIAL';
    if (!buckets.has(type)) buckets.set(type, []);
    buckets.get(type).push(shape(e));
    used.add(key);
  }
  const typeOrder = ['SPECIAL', 'FLY', 'TIMES', 'ELEMENT', 'DOT', 'INVISIBLE', 'REFLECTION'];
  const typeEntries = [...buckets.entries()].sort((a, b) => typeOrder.indexOf(a[0]) - typeOrder.indexOf(b[0]));
  const special = [];
  for (const [type, list] of typeEntries) {
    list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
    special.push({ id: type, name: types[type]?.name || type, list });
  }
  // every other elite / boss body stays reachable here rather than disappearing from the catalog
  const rest = all.filter((e) => !used.has(enemyKeyOf(e)) && e.rank !== 'NORMAL').map(shape);
  if (rest.length) {
    rest.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
    special.push({ id: 'other', name: t('其他敌人'), list: rest });
    for (const r of rest) used.add(r.id);
  }
  if (special.length) groups.push({ id: 'special', name: t('特训敌人'), list: special });

  const normal = all.filter((e) => e.rank === 'NORMAL' && !used.has(enemyKeyOf(e))).map(shape);
  normal.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
  if (normal.length) groups.unshift({ id: 'normal', name: t('普通敌人'), list: normal });
  return groups;
}

/** 普通 / 隐匿 boss catalogs. */
export function bossGroups() {
  const bosses = listOf('bosses').filter((b) => b && (b.bossId || b.id));
  const shape = (b) => ({
    id: b.bossId || b.id,
    name: b.name || b.bossId || b.id,
    enemyKey: b.enemyKey || null,
    desc: b.desc || '',
    hidden: b.hidden === true,
    sortId: b.sortId ?? 0,
  });
  const list = bosses.map(shape).sort((a, b) => a.sortId - b.sortId);
  return { normal: list.filter((b) => !b.hidden), hidden: list.filter((b) => b.hidden) };
}

/** Where the 迎战 window sends the match: the boss round, and the round a win returns to. */
export function bossJump(pub, boss) {
  const hidden = boss?.hidden === true;
  const bossRound = pub?.bossRound || pub?.lastRound || 1;
  const hiddenRound = pub?.hiddenRound || bossRound;
  const round = hidden ? hiddenRound : bossRound;
  // a win returns to the round before the leader phase (第13回合 for the 14/15 rounds), never to the boss round itself
  return { hidden, round, returnRound: Math.max(1, Math.min(round - 1, bossRound - 1)) };
}

/** The highest round the round control may jump to (the mode's last round, or its hidden core round). */
export function roundMax(pub) {
  return Math.max(1, pub?.lastRound || 0, pub?.hiddenRound > 0 ? pub.hiddenRound : 0);
}

/** The seat's own operators on the board, in hand or waiting on the bench — one row per chess id. */
export function ownedOperators(mine) {
  const areas = [['board', mine?.board], ['hand', mine?.hand], ['temp', mine?.temp]];
  const seen = new Set();
  const rows = [];
  for (const [area, list] of areas) {
    for (const p of Array.isArray(list) ? list : []) {
      if (!p || p.kind !== 'chess' || !p.id || seen.has(p.id)) continue;
      seen.add(p.id);
      const chess = chessOf(p.id);
      rows.push({ id: p.id, uid: p.uid, area, name: chess?.name || p.id, chess });
    }
  }
  rows.sort((a, b) => (a.area === 'board' ? -1 : 0) - (b.area === 'board' ? -1 : 0));
  return rows;
}

/** The effective (base + promoted) stats of a chess record, as the editor's rows. */
export const STAT_FIELDS = Object.freeze([
  Object.freeze({ key: 'atk', label: t('攻击') }),
  Object.freeze({ key: 'def', label: t('防御') }),
  Object.freeze({ key: 'maxHp', label: t('生命') }),
  Object.freeze({ key: 'res', label: t('法抗') }),
  Object.freeze({ key: 'aspd', label: t('攻速') }),
  Object.freeze({ key: 'cost', label: t('费用') }),
]);

export function baseStats(chess) {
  const stats = chess?.stats && typeof chess.stats === 'object' ? chess.stats : {};
  return { atk: stats.atk ?? 0, def: stats.def ?? 0, maxHp: stats.maxHp ?? 0, res: stats.res ?? 0, aspd: stats.aspd ?? 100, cost: stats.cost ?? 0 };
}

/** The seat's current override record for one chess, as the receipt and the editor read it. */
export function operatorOverride(mine, chessId) {
  return mine?.testPlugin?.ops?.[chessId] || null;
}

/** Current 潜能 / 练度 / 技能 / 模组 for one chess (the seat's overrides win over the record). */
export function operatorState(mine, chess) {
  const id = chess?.chessId || chess?.id;
  const over = operatorOverride(mine, id);
  const charId = chess?.charId;
  const op = charId ? mine?.ops?.[charId] : null;
  const lo = id ? mine?.loadout?.[id] : null;
  const skills = skillList(chess);
  const mods = moduleList(chess);
  return {
    potential: over?.potential ?? op?.potential ?? 6,
    cultivate: over?.cultivate ?? op?.cultivate ?? 3,
    skillIndex: over?.skillIndex ?? (lo?.skill ?? skills.find((s) => s.isDefault)?.index) ?? skills[0]?.index ?? 0,
    moduleId: over?.moduleId ?? (lo?.module ?? mods.find((m) => m.isDefault)?.uniEquipId ?? null),
    bonds: Array.isArray(over?.bonds) ? over.bonds : (Array.isArray(chess?.bonds) ? chess.bonds : []),
    traits: Array.isArray(over?.traits) ? over.traits : (Array.isArray(chess?.garrisonIds) ? chess.garrisonIds : []),
    stats: { ...baseStats(chess), ...(over?.stats || {}) },
  };
}

/** Drop empty values so the command carries only what the player touched (an explicit [] is kept: it clears). */
export function compactArgs(args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) continue;
    out[k] = v;
  }
  return out;
}

/** `enemies` payload: list entries with count clamped to the command's own 1..20. */
export function enemiesArgs(mode, picks) {
  return { mode, list: (picks || []).filter((p) => p && p.id && p.count > 0).map((p) => ({ id: p.id, count: Math.max(1, Math.min(20, Math.round(p.count) || 1)) })) };
}

/** `op` payload from the editor's draft, dropping keys that still hold the record's own value. */
export function opArgs(chess, draft) {
  const id = chess?.chessId || chess?.id;
  const skills = skillList(chess);
  const mods = moduleList(chess);
  const base = {
    potential: 6,
    cultivate: 3,
    skillIndex: skills.find((s) => s.isDefault)?.index ?? skills[0]?.index ?? 0,
    moduleId: mods.find((m) => m.isDefault)?.uniEquipId ?? null,
    bonds: Array.isArray(chess?.bonds) ? chess.bonds : [],
    traits: Array.isArray(chess?.garrisonIds) ? chess.garrisonIds : [],
    stats: baseStats(chess),
  };
  const args = {};
  if (draft.potential !== base.potential) args.potential = draft.potential;
  if (draft.cultivate !== base.cultivate) args.cultivate = draft.cultivate;
  if (draft.skillIndex !== base.skillIndex) args.skillIndex = draft.skillIndex;
  // null keeps the default module, 'none' fights without one, an id equips that module (shared/protocol.js MODULE_NONE)
  if ((draft.moduleId || null) !== (base.moduleId || null)) args.moduleId = draft.moduleId || null;
  if (draft.bonds.length !== base.bonds.length || draft.bonds.some((b, i) => b !== base.bonds[i])) args.bonds = draft.bonds.slice();
  if (draft.traits.length !== base.traits.length || draft.traits.some((b, i) => b !== base.traits[i])) args.traits = draft.traits.slice();
  const changed = {};
  for (const f of STAT_FIELDS) {
    if (Number(draft.stats[f.key]) !== Number(base.stats[f.key])) changed[f.key] = Math.max(0, Math.round(Number(draft.stats[f.key]) || 0));
  }
  if (Object.keys(changed).length) args.stats = changed;
  const payload = compactArgs(args);
  // an explicit null module is "back to the default", not "unchanged": compactArgs drops nulls, so re-add it
  if (Object.hasOwn(args, 'moduleId') && args.moduleId === null) payload.moduleId = null;
  return { id, args: payload };
}

/** `shopLevel` 1..6, clamped for the level stepper. */
export function clampShopLevel(level) {
  return Math.max(1, Math.min(6, Math.round(Number(level) || 1)));
}
