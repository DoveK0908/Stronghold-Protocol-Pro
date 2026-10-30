// Native room-gated test tools. Independent of local/host-only g.test; no speed or clock controls.
// Limits: own living human seat, LP 1..99999, native 8 attempts/cmd/10s.
import { parseTestArgs, TEST_RATE_COUNT, TEST_RATE_WINDOW_MS, TEST_SHOP_SLOTS_MAX } from './testMode.js';
import { CULTIVATE_MAX, POTENTIAL_MAX, POTENTIAL_MIN, isCultivate, isPotential } from './potential.js';

export const TEST_PLUGIN_LP_MAX = 99999;
export const TEST_PLUGIN_RATE_COUNT = TEST_RATE_COUNT;
export const TEST_PLUGIN_RATE_WINDOW_MS = TEST_RATE_WINDOW_MS;
export const TEST_PLUGIN_SHOP_LEVEL_MAX = 6;
export const TEST_PLUGIN_FILTER_MAX = 12;
export const TEST_PLUGIN_DEPLOY_CAP_MAX = 12;
export const TEST_PLUGIN_REFRESH_FREE_MAX = 99;
export const TEST_PLUGIN_POTENTIAL_MIN = POTENTIAL_MIN;
export const TEST_PLUGIN_POTENTIAL_MAX = POTENTIAL_MAX;
export const TEST_PLUGIN_CULTIVATE_MAX = CULTIVATE_MAX;
/** 干员修改 (`op`): the skill slot is bounded by the record in the handler; parse allows the widest native set. */
export const TEST_PLUGIN_SKILL_INDEX_MAX = 8;
export const TEST_PLUGIN_TRAITS_MAX = 8;
export const TEST_PLUGIN_ENEMY_LIST_MAX = 12;
export const TEST_PLUGIN_ENEMY_COUNT_MAX = 20;
export const TEST_PLUGIN_STAT_MAX = 99999;
export const TEST_PLUGIN_STAT_KEYS = Object.freeze(['atk', 'def', 'maxHp', 'res', 'aspd', 'cost']);
export const TEST_PLUGIN_COMMANDS = Object.freeze([
  'funds', 'lp', 'chess', 'item', 'shop', 'shopSlots', 'pick', 'shopLevel', 'filter', 'map',
  'bond', 'strategy', 'level', 'deployCap', 'refreshFree', 'bounty', 'wave', 'ops', 'op', 'enemies', 'boss',
  'diyRefresh', 'round',
]);
export const isTestPluginCommand = (v) => typeof v === 'string' && TEST_PLUGIN_COMMANDS.includes(v);

const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
// same id shape as shared/testMode.js: ASCII only, bounded, never a prototype key
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64
  && !['__proto__', 'prototype', 'constructor'].includes(v) && /^[A-Za-z0-9_\-.:]+$/.test(v);
const exact = (args, keys) => {
  const a = args === undefined ? {} : args;
  if (!plain(a)) return { error: 'BAD_MSG' };
  const got = Object.keys(a);
  if (got.length > 8) return { error: 'BAD_MSG' };
  for (const k of got) if (!keys.includes(k)) return { error: 'BAD_MSG' };
  return { args: a };
};

/**
 * Strict bounded subset of native test args; no actor/target, strategy LP reset, or clock controls.
 * @returns {{ error: 'BAD_MSG' | 'BAD_TARGET' } | { args: object }}
 */
export function parseTestPluginArgs(cmd, args) {
  if (!isTestPluginCommand(cmd)) return { error: 'BAD_MSG' };
  if (cmd === 'lp') {
    if (!plain(args) || Object.keys(args).length !== 1 || !Object.hasOwn(args, 'value')) return { error: 'BAD_MSG' };
    if (!Number.isInteger(args.value) || args.value < 1 || args.value > TEST_PLUGIN_LP_MAX) return { error: 'BAD_TARGET' };
    return { args: { value: args.value } };
  }
  if (cmd === 'pick') {
    const r = exact(args, ['slot', 'id']);
    if (r.error) return r;
    if (!isInt(r.args.slot, 0, TEST_SHOP_SLOTS_MAX - 1) || !isId(r.args.id)) return { error: 'BAD_TARGET' };
    return { args: { slot: r.args.slot, id: r.args.id } };
  }
  if (cmd === 'shopLevel') {
    const r = exact(args, ['level']);
    if (r.error) return r;
    if (!isInt(r.args.level, 1, TEST_PLUGIN_SHOP_LEVEL_MAX)) return { error: 'BAD_TARGET' };
    return { args: { level: r.args.level } };
  }
  if (cmd === 'filter') {
    const r = exact(args, ['bonds', 'mode']);
    if (r.error) return r;
    const bonds = r.args.bonds;
    if (!Array.isArray(bonds) || bonds.length > TEST_PLUGIN_FILTER_MAX || !bonds.every(isId)) return { error: 'BAD_TARGET' };
    const mode = r.args.mode === undefined ? 'any' : r.args.mode;
    if (mode !== 'any' && mode !== 'all') return { error: 'BAD_TARGET' };
    return { args: { bonds: [...new Set(bonds)], mode } };
  }
  if (cmd === 'map' || cmd === 'bounty' || cmd === 'wave') {
    const r = exact(args, ['id']);
    if (r.error) return r;
    if (!isId(r.args.id)) return { error: 'BAD_TARGET' };
    return { args: { id: r.args.id } };
  }
  if (cmd === 'deployCap') {
    const r = exact(args, ['value']);
    if (r.error) return r;
    if (!isInt(r.args.value, 1, TEST_PLUGIN_DEPLOY_CAP_MAX)) return { error: 'BAD_TARGET' };
    return { args: { value: r.args.value } };
  }
  if (cmd === 'refreshFree') {
    const r = exact(args, ['count']);
    if (r.error) return r;
    if (!isInt(r.args.count, 0, TEST_PLUGIN_REFRESH_FREE_MAX)) return { error: 'BAD_TARGET' };
    return { args: { count: r.args.count } };
  }
  if (cmd === 'shopSlots') {
    const r = exact(args, ['slots']);
    if (r.error) return r;
    const slots = r.args.slots;
    if (!Array.isArray(slots) || slots.length < 1 || slots.length > TEST_SHOP_SLOTS_MAX) return { error: 'BAD_TARGET' };
    const out = [];
    for (const s of slots) {
      if (s === null) { out.push(null); continue; }
      const e = exact(s, ['kind', 'id']);
      if (e.error) return e;
      if ((e.args.kind !== 'chess' && e.args.kind !== 'item') || !isId(e.args.id)) return { error: 'BAD_TARGET' };
      out.push({ kind: e.args.kind, id: e.args.id });
    }
    return { args: { slots: out } };
  }
  if (cmd === 'op') {
    const r = exact(args, ['id', 'potential', 'cultivate', 'skillIndex', 'moduleId', 'bonds', 'traits', 'stats']);
    if (r.error) return r;
    if (!isId(r.args.id)) return { error: 'BAD_TARGET' };
    const out = { id: r.args.id };
    let changing = false;
    if (r.args.potential !== undefined) {
      if (!isPotential(r.args.potential)) return { error: 'BAD_TARGET' };
      out.potential = r.args.potential;
      changing = true;
    }
    if (r.args.cultivate !== undefined) {
      if (!isCultivate(r.args.cultivate)) return { error: 'BAD_TARGET' };
      out.cultivate = r.args.cultivate;
      changing = true;
    }
    if (r.args.skillIndex !== undefined) {
      if (!isInt(r.args.skillIndex, 0, TEST_PLUGIN_SKILL_INDEX_MAX)) return { error: 'BAD_TARGET' };
      out.skillIndex = r.args.skillIndex;
      changing = true;
    }
    if (r.args.moduleId !== undefined) {
      if (r.args.moduleId !== null && !isId(r.args.moduleId)) return { error: 'BAD_TARGET' };
      out.moduleId = r.args.moduleId;
      changing = true;
    }
    if (r.args.bonds !== undefined) {
      const bonds = r.args.bonds;
      if (!Array.isArray(bonds) || bonds.length > TEST_PLUGIN_FILTER_MAX || !bonds.every(isId)) return { error: 'BAD_TARGET' };
      out.bonds = [...new Set(bonds)];
      changing = true;
    }
    if (r.args.traits !== undefined) {
      const traits = r.args.traits;
      if (!Array.isArray(traits) || traits.length > TEST_PLUGIN_TRAITS_MAX || !traits.every(isId)) return { error: 'BAD_TARGET' };
      out.traits = [...new Set(traits)];
      changing = true;
    }
    if (r.args.stats !== undefined) {
      const stats = r.args.stats;
      if (!plain(stats)) return { error: 'BAD_MSG' };
      const keys = Object.keys(stats);
      if (!keys.length || keys.some((k) => !TEST_PLUGIN_STAT_KEYS.includes(k))) return { error: 'BAD_MSG' };
      if (!keys.every((k) => isInt(stats[k], 0, TEST_PLUGIN_STAT_MAX))) return { error: 'BAD_TARGET' };
      out.stats = Object.fromEntries(keys.map((k) => [k, stats[k]]));
      changing = true;
    }
    if (!changing) return { error: 'BAD_MSG' };
    return { args: out };
  }
  if (cmd === 'enemies') {
    const r = exact(args, ['mode', 'list']);
    if (r.error) return r;
    if (r.args.mode !== 'replace' && r.args.mode !== 'append') return { error: 'BAD_TARGET' };
    const list = r.args.list;
    if (!Array.isArray(list) || list.length < 1 || list.length > TEST_PLUGIN_ENEMY_LIST_MAX) return { error: 'BAD_TARGET' };
    const out = [];
    for (const it of list) {
      const e = exact(it, ['id', 'count']);
      if (e.error) return e;
      if (!isId(e.args.id) || !isInt(e.args.count, 1, TEST_PLUGIN_ENEMY_COUNT_MAX)) return { error: 'BAD_TARGET' };
      out.push({ id: e.args.id, count: e.args.count });
    }
    return { args: { mode: r.args.mode, list: out } };
  }
  if (cmd === 'boss') {
    const r = exact(args, ['id']);
    if (r.error) return r;
    if (!isId(r.args.id)) return { error: 'BAD_TARGET' };
    return { args: { id: r.args.id } };
  }
  if (cmd === 'ops') {
    const r = exact(args, ['id', 'potential', 'cultivate']);
    if (r.error) return r;
    if (!isId(r.args.id)) return { error: 'BAD_TARGET' };
    const out = { id: r.args.id };
    if (r.args.potential !== undefined) {
      if (!isPotential(r.args.potential)) return { error: 'BAD_TARGET' };
      out.potential = r.args.potential;
    }
    if (r.args.cultivate !== undefined) {
      if (!isCultivate(r.args.cultivate)) return { error: 'BAD_TARGET' };
      out.cultivate = r.args.cultivate;
    }
    if (out.potential === undefined && out.cultivate === undefined) return { error: 'BAD_MSG' };
    return { args: out };
  }
  if (cmd === 'diyRefresh') {
    const r = exact(args, []);
    if (r.error) return r;
    return { args: {} };
  }
  if (cmd === 'strategy' && (!plain(args) || Object.keys(args).some((k) => k !== 'id'))) return { error: 'BAD_MSG' };
  return parseTestArgs(cmd, args);
}

/** Also checked by C2S before journalling/IPC; refusals never retain raw payloads. */
export function parseTestPluginMessage(msg) {
  if (!plain(msg) || msg.t !== 'g.testPlugin' || Object.keys(msg).some((k) => !['t', 'rid', 'cmd', 'args'].includes(k))) return { error: 'BAD_MSG' };
  if (msg.rid !== undefined && (!Number.isInteger(msg.rid) || msg.rid < 0 || msg.rid > 2 ** 31)) return { error: 'BAD_MSG' };
  return parseTestPluginArgs(msg.cmd, msg.args);
}
