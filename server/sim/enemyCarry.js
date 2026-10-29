// Experimental HP/phase continuation only: no operator-applied statuses, DoTs, ordinary skill timers or closures.
// Content explicitly opts phase bits/buffs into this versioned data codec. Remaining phase durations are sampled at
// each enemy's own escape, so waiting for other fields never advances them. Fresh destination callbacks are rebound.
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const plain = (o) => o && typeof o === 'object' && !Array.isArray(o) && (Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null);
const number = (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e12;
const badKey = (k) => k === '__proto__' || k === 'constructor' || k === 'prototype';
const primitive = (v) => v === null || typeof v === 'boolean' || number(v) || (typeof v === 'string' && v.length <= 64);
function record(raw, predicate = primitive) {
  if (!plain(raw) || Object.keys(raw).length > 40) return null;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (badKey(k) || k.length > 64 || !predicate(v)) return null;
    out[k] = v;
  }
  return out;
}
function buff(raw) {
  if (!plain(raw) || typeof raw.key !== 'string' || raw.key.length > 64 || badKey(raw.key)) return null;
  if (raw.left !== null && (!number(raw.left) || raw.left < 0)) return null;
  const mods = record(raw.mods, number), flags = record(raw.flags, (v) => typeof v === 'boolean');
  if (!mods || !flags || !number(raw.stacks) || raw.stacks < 1 || raw.stacks > 10000 || !number(raw.acc) || raw.acc < 0) return null;
  return { key: raw.key, left: raw.left, mods, flags, stacks: raw.stacks, acc: raw.acc, persist: raw.persist === true, visible: raw.visible === true };
}

/** Return a detached version-1 data record or null. Does not authorize a client result; match verification owns that. */
export function sanitizeEnemyCarry(raw) {
  if (!plain(raw) || raw.v !== 1 || !number(raw.hp) || raw.hp < 0 || !number(raw.maxHp) || raw.maxHp <= 0 || raw.hp > raw.maxHp + 1e-6 || !plain(raw.phases)) return null;
  const phases = {};
  if (Object.keys(raw.phases).length > 32) return null;
  for (const [key, phase] of Object.entries(raw.phases)) {
    if (badKey(key) || key.length > 64 || !plain(phase)) return null;
    const values = record(phase.values);
    if (!values || !Array.isArray(phase.buffs) || phase.buffs.length > 16) return null;
    const buffs = phase.buffs.map(buff);
    if (buffs.some((v) => !v) || new Set(buffs.map((v) => v.key)).size !== buffs.length) return null;
    phases[key] = { values, buffs };
  }
  return { v: 1, hp: raw.hp, maxHp: raw.maxHp, phases };
}

/** Pure descriptor attached as an inert ability for closure-owned phase bits, not ordinary runtime state. */
export function phaseState(key, state, fields, buffs = [], restore = null) {
  return { carryPhase: { key, state, fields, buffs, restore } };
}

const PROFILE = ['noAttack', 'melee', 'dmgType', 'maxTargets'];
const UNIT_FIELDS = ['form', 'motion', 'baseMaxHp', 'rangeRadius', 'times', 'atkType', ...PROFILE];
function phaseBuff(x) {
  return { key: x.key, left: Number.isFinite(x.timeLeft) ? Math.max(0, x.timeLeft) : null,
    mods: { ...(x.mods || {}) }, flags: { ...(x.flags || {}) }, stacks: x.stacks, acc: x._acc,
    persist: !!x.persist, visible: !!x.visible };
}

export function captureEnemyCarry(b, e) {
  if (!b.stateCarry || !e || e.bossPool) return null;
  const phases = {}, ab = e.mem.ab;
  for (const a of ab?.list || []) {
    const p = a.carryPhase;
    if (!p) continue;
    const values = {}, state = p.state || a;
    for (const key of p.fields) if (state[key] !== undefined) values[key] = state[key];
    if (p.capture) Object.assign(values, p.capture(b, e, a));
    phases[p.key] = { values, buffs: e.buffs.filter((x) => p.buffs.includes(x.key)).map(phaseBuff) };
  }
  if (Object.keys(phases).length || ab?.times) {
    const values = { motion: e.motion, baseMaxHp: e.base.maxHp, rangeRadius: e.base.rangeRadius || 0,
      times: ab?.times ?? null, atkType: ab?.atkType ?? null };
    if (e.form) values.form = e.form;
    for (const k of PROFILE) if (e.profile[k] !== undefined) values[k] = e.profile[k];
    phases.unit = { values, buffs: [] };
  }
  return sanitizeEnemyCarry({ v: 1, hp: Math.max(0, e.hp), maxHp: e.s.maxHp, phases });
}

export function restoreEnemyCarry(b, e, raw) {
  if (!b.stateCarry || !e || e.bossPool) return false;
  const data = sanitizeEnemyCarry(raw);
  if (!data) return false;
  const byKey = new Map();
  for (const a of e.mem.ab?.list || []) if (a.carryPhase) byKey.set(a.carryPhase.key, a);
  // Reject incompatible/unknown payloads before mutating the fresh enemy.
  for (const [key, phase] of Object.entries(data.phases)) {
    if (key === 'unit') {
      const v = phase.values;
      if (phase.buffs.length || Object.keys(v).some((k) => !UNIT_FIELDS.includes(k)) || !['WALK', 'FLY', 'NONE'].includes(v.motion)
        || !number(v.baseMaxHp) || v.baseMaxHp <= 0 || !number(v.rangeRadius) || v.rangeRadius < 0
        || (v.times !== null && (!number(v.times) || v.times <= 0))
        || (v.atkType !== null && !['phys', 'arts', 'true'].includes(v.atkType))
        || ['noAttack', 'melee'].some((k) => own(v, k) && typeof v[k] !== 'boolean')
        || (own(v, 'dmgType') && v.dmgType !== null && !['phys', 'arts', 'true', 'none'].includes(v.dmgType))
        || (own(v, 'maxTargets') && (!number(v.maxTargets) || v.maxTargets < 1 || v.maxTargets > 100))) return false;
      continue;
    }
    const a = byKey.get(key), p = a?.carryPhase;
    if (!p || Object.keys(phase.values).some((k) => ![...p.fields, ...(p.extra || [])].includes(k)) || phase.buffs.some((x) => !p.buffs.includes(x.key))) return false;
    if (p.validate && !p.validate(phase.values)) return false;
  }
  const unit = data.phases.unit?.values;
  if (unit) {
    e.motion = unit.motion;
    e.base.maxHp = unit.baseMaxHp;
    e.base.rangeRadius = unit.rangeRadius;
    if (unit.form) e.form = unit.form;
    if (e.mem.ab) { e.mem.ab.times = unit.times; e.mem.ab.atkType = unit.atkType; }
    for (const k of PROFILE) if (own(unit, k)) e.profile[k] = unit[k];
    e.markDirty();
  }
  for (const [key, phase] of Object.entries(data.phases)) {
    if (key === 'unit') continue;
    const a = byKey.get(key), p = a.carryPhase, state = p.state || a;
    for (const k of p.fields) {
      if (own(phase.values, k)) state[k] = phase.values[k];
      else delete state[k];
    }
    for (const key2 of p.buffs) b.removeBuff(e, key2);
    for (const x of phase.buffs) {
      const held = b.addBuff(e, { key: x.key, duration: x.left === null ? Infinity : x.left,
        mods: x.mods, flags: x.flags, stacks: x.stacks, maxStacks: x.stacks, persist: x.persist, visible: x.visible });
      if (held) held._acc = x.acc;
    }
    if (p.restore) p.restore(b, e, a, phase.values);
  }
  e.markDirty();
  e.hp = Math.max(0, Math.min(e.s.maxHp, data.hp));
  return true;
}
