// 取自 selena 0.4.1 的丰川祥子实现（维护者 2026-10-27 决定整份采用，本树原实现已移除）。
// 音效仍用本树 data/assets.json 的 units[char_4182_oblvns] 与音效 bank（kit 不负责音效）。
// Official skill/talent/module BB: tools/data/sakiko-source.json. Native flight notes: PRTS 丰川祥子.
// [ASSUMED] Safe bounds: 192 live notes, 12s lifetime; removed with their caster. This also bounds empty-field tests.
import { num, talentBb, moduleOn, up, skillRec } from '../shared/tier1.js';
import { absoluteRangeKeys, canTargetEnemy, sortEnemyTargets } from '../../../targeting.js';
import { bodyInRange } from '../../../body.js';
import { dirVec } from '../../../dir.js';
import { hypot, atan2, sin, cos } from '../../../detmath.js';
import { COLS } from '../../../constants.js';
const S1 = 'skchr_oblvns_1', S2 = 'skchr_oblvns_2', S3 = 'skchr_oblvns_3';
export const NOTE_LIMIT = 192, NOTE_LIFETIME = 12, FEVER_LIMIT = 450;
const PI = 3.141592653589793;
const bbOf = (chess, id) => skillRec(chess, id)?.bb || {};
const inRange = (u, x, y) => !!u.rangeKeySet?.has(Math.round(y) * COLS + Math.round(x));
const valid = (u, e) => e?.alive && !e.hidden && inRange(u, e.x, e.y) && canTargetEnemy(u, e, { canHitFly: true });
const distanceToSegment = (e, x0, y0, x1, y1) => {
  const dx = x1 - x0, dy = y1 - y0, den = dx * dx + dy * dy;
  const t = den > 0 ? Math.max(0, Math.min(1, ((e.x - x0) * dx + (e.y - y0) * dy) / den)) : 0;
  return hypot(e.x - x0 - t * dx, e.y - y0 - t * dy);
};
export default {
  char_4182_oblvns: (_bb, chess) => {
    const t1 = talentBb(chess), t2 = talentBb(chess, 1), b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const selected = chess.skill?.skillId, mod = moduleOn(chess);
    const skillGrid = skillRec(chess, selected)?.rangeGrid;
    const tone = (battle, unit) => {
      battle.removeBuff(unit, 'oblvns:tone');
      if (selected === S2) battle.addBuff(unit, { key: 'oblvns:tone', persist: true, allowDead: true,
        mods: unit.mem.oblvnsOrgan ? { aspd: num(b2['attack@attack_speed']) } : { atkPct: num(b2['attack@atk']) } });
      if (selected === S2) { unit.form = unit.mem.oblvnsOrgan ? 'oblvns_organ' : 'oblvns_piano'; battle.fx('phase', { x: unit.x, y: unit.y, id: unit.id, form: unit.form }); }
    };
    const launch = (unit, type, scale = 1, offset = 0, fever = true, pierce = false, projectile = null, aimed = false) => {
      const m = unit.mem.oblvns;
      if (!m || m.notes.length >= NOTE_LIMIT) return;
      const [dy, dx] = dirVec(unit.dir), angle = atan2(dy, dx) + offset;
      const penalty = unit.blocking.length || mod && unit.skill.active ? 1 : 0.8;
      m.notes.push({ x: unit.x, y: unit.y, angle, origin: angle, age: 0, outside: 0, target: null, seen: new Set(),
        aimed, seekRadius: selected === S2 && pierce ? 0.8 : 1,
        weakTurn: selected === S3 && unit.skill.active ? 1 / 4 : selected === S2 ? (pierce ? 1 / 2 : 1 / 12) : 1 / 6,
        amount: unit.s.atk * unit.s.atkScaleMul * scale * penalty,
        type, scale, fever, pierce, pass: 0, seq: ++m.seq, speed: pierce ? 3.4 : type === 'arts' && selected === S2 ? 1.2 : 1.7,
        projectile: projectile || (selected === S2 ? `projectile_chr_oblvns_s2${type === 'arts' ? '_slow' : ''}`
          : selected === S3 && unit.skill.active ? `projectile_chr_oblvns_s3_${type === 'arts' ? 'mag' : 'phy'}` : 'projectile_chr_oblvns') });
    };
    const feverStart = (battle, unit) => {
      const m = unit.mem.oblvns;
      if (m.fever > 0 || m.gauge < FEVER_LIMIT) return;
      m.fever = 20; m.gauge = 0;
      battle.fx('sonic', { x: unit.x, y: unit.y, id: unit.id, skill: 'oblvns:fever' });
    };
    const clear = unit => { if (unit.mem.oblvns) { unit.mem.oblvns.notes = []; unit.mem.oblvns.fever = 0; } };
    return {
      trait: { noAttack: true, canHitFly: true },
      skills: {
        [S1]: { kind: 'charges', charges: 2, trigger: 'MANUAL', onStart({ battle, unit, reason }) {
          const aimed = battle.enemies.some(e => valid(unit, e));
          for (let i = 0; i < 8; i++) launch(unit, 'arts', num(b1[i ? `atk_scale_${i + 1}` : 'atk_scale'], 0.04), (i - 3.5) * PI / 12, reason !== 'full-charge', false, `projectile_chr_oblvns_s1_${i + 1}`, aimed);
          if (reason !== 'full-charge') feverStart(battle, unit);
        } },
        [S2]: { kind: 'instant', trigger: 'MANUAL', onStart({ battle, unit }) { unit.mem.oblvnsOrgan = !unit.mem.oblvnsOrgan; tone(battle, unit); feverStart(battle, unit); } },
        [S3]: { kind: 'duration', trigger: 'MANUAL', targeting: { rangeGrid: skillRec(chess, S3)?.rangeGrid },
          onTick({ unit, skill, dt }) { if (unit.mem.oblvns?.fever > 0) skill.timeLeft += dt; },
          onStart({ battle, unit }) { feverStart(battle, unit); } },
      },
      install(battle, unit) {
        const reset = () => { const gauge = unit.mem.oblvns?.gauge || 0; unit.mem.oblvns = { notes: [], seq: 0, cd: 0, draw: 0, aura: 0, gauge, fever: 0, feverCd: 0, deferredDeath: false }; unit.mem.oblvnsOrgan = false; tone(battle, unit); };
        reset();
        battle.on('deploy', c => { if (c.unit === unit && !c.move) reset(); }, { owner: unit });
        for (const event of ['death', 'retreat']) battle.on(event, c => { if (c.unit === unit) clear(unit); }, { owner: unit });
        battle.on('battleEnd', () => clear(unit), { owner: unit });
        battle.on('kill', ({ victim }) => { if (victim === unit && selected === S3 && unit.skill.active && unit.mem.oblvns?.fever > 0) { unit.hp = 1; unit.mem.oblvns.deferredDeath = true; } }, { owner: unit });
        battle.on('tick', ({ dt }) => {
          const m = unit.mem.oblvns;
          if (!up(unit)) { clear(unit); return; }
          const feverWasActive = m.fever > 0;
          m.fever = Math.max(0, m.fever - dt); m.cd -= dt; m.draw -= dt; m.aura -= dt; m.feverCd -= dt;
          if (feverWasActive && m.fever <= 0 && m.deferredDeath) { battle.retreat(unit, { reason: 'oblvns:fever-end', dying: true }); clear(unit); return; }
          const foes = battle.enemies.filter(e => canTargetEnemy(unit, e, { canHitFly: true }));
          const enemies = sortEnemyTargets(battle, unit, foes.filter(e => valid(unit, e)));
          const skillKeys = skillGrid?.length ? new Set(absoluteRangeKeys(skillGrid, unit.tileR, unit.tileC, unit.dir, unit.s.baseRangeExtend || 0)) : unit.rangeKeySet;
          const skillEnemies = sortEnemyTargets(battle, unit, foes.filter(e => bodyInRange(e, skillKeys)));
          const actionable = !unit.hidden && !unit.s.flags.stun && !unit.s.flags.noAttack;
          if (actionable && m.fever > 0 && selected === S1 && m.feverCd <= 0) {
            m.feverCd = Math.max(0.1, unit.s.interval);
            unit.skill.activate('fever', { free: true });
          }
          if (actionable && unit.skill.ready && !unit.skill.active && !unit.skill.opCooling) {
            if (selected === S1 && (skillEnemies.length || unit.skill.charges >= 2)) unit.skill.activate(skillEnemies.length ? 'enemy' : 'full-charge');
            else if (selected === S3 && skillEnemies.length) unit.skill.activate('enemy');
            else if (selected === S2 && skillEnemies.length) {
              // [ASSUMED] Automatic operations choose the better tone; manual activation always switches it.
              const target = skillEnemies[0], wantOrgan = target.s.def > unit.s.atk * Math.max(0.2, target.s.res / 100);
              if (wantOrgan !== unit.mem.oblvnsOrgan || m.gauge >= FEVER_LIMIT) unit.skill.activate('tone');
            }
          }
          if (actionable && m.cd <= 1e-9) {
            m.cd += Math.max(0.1, unit.s.interval);
            const skill3 = selected === S3 && unit.skill.active;
            const aimed = foes.some(e => valid(unit, e)); // activation above may have expanded the range this tick
            if (skill3) for (let i = 0; i < 2; i++) { launch(unit, 'phys', num(b3['attack@atk_scale'], 1.8), (i ? 1 : -1) * 0.15, true, false, null, aimed); launch(unit, 'arts', num(b3['attack@atk_scale'], 1.8), (i ? 1 : -1) * 0.25, true, false, null, aimed); }
            else for (let i = 0; i < (selected === S2 && m.fever > 0 ? 2 : 1); i++) launch(unit, selected === S2 && unit.mem.oblvnsOrgan ? 'arts' : 'phys', 1, i * 0.12, true, selected === S2 && !unit.mem.oblvnsOrgan, null, aimed);
            battle._ev(['atk', unit.id, enemies[0]?.id ?? unit.id, 'none']);
            battle.emit('attack', { attacker: unit, targets: enemies.slice(0, 1), isSkill: skill3 });
            unit.skill.onAttackPerformed(enemies.slice(0, 1), skill3);
          }
          const keep = [];
          for (const n of m.notes) {
            n.age += dt;
            // All notes seek locally, regardless of the caster's current range. Launching at an in-range enemy
            // strengthens steering, never the acquisition radius. Do not turn back toward a passed/distant foe.
            const radius = n.seekRadius ?? (selected === S2 && n.pierce ? 0.8 : 1);
            const near = e => canTargetEnemy(unit, e, { canHitFly: true }) && hypot(e.x - n.x, e.y - n.y) <= radius
              && (e.x - n.x) * cos(n.angle) + (e.y - n.y) * sin(n.angle) >= -1e-9;
            const nearby = foes.filter(e => !n.seen.has(e.id) && near(e));
            if (n.age >= NOTE_LIFETIME || n.pass > 0 && (n.pass -= dt) <= 0) continue;
            if (!n.pass && n.target && !near(n.target)) n.target = null;
            if (!n.target && !n.pass) {
              const candidates = nearby;
              if (selected === S3 && unit.skill.active) candidates.sort((a, b) => (n.type === 'phys' ? b.s.res - a.s.res : b.s.def - a.s.def) || a.spawnSeq - b.spawnSeq);
              else candidates.sort((a, b) => hypot(a.x - n.x, a.y - n.y) - hypot(b.x - n.x, b.y - n.y) || a.spawnSeq - b.spawnSeq);
              n.target = candidates[0] || null;
            }
            n.outside = inRange(unit, n.x, n.y) || n.target ? 0 : n.outside + dt;
            if (n.outside >= num(t1.delay, 1)) continue;
            let angle = n.origin + sin(n.age * PI * 2) * Math.min(0.6, n.age * 0.2);
            if (n.target && !n.pass) angle = atan2(n.target.y - n.y, n.target.x - n.x);
            else if (n.pass) angle = n.angle;
            let turn = angle - n.angle;
            // loop-cap: both terms are normalized angles (atan2 / the stored n.angle), so each correction runs at most once
            while (turn > PI) turn -= 2 * PI;
            while (turn < -PI) turn += 2 * PI;
            const weak = n.target && !n.aimed && !n.pass;
            const fraction = n.weakTurn ?? (selected === S3 && unit.skill.active ? 1 / 4
              : selected === S2 ? (n.pierce ? 1 / 2 : 1 / 12) : 1 / 6);
            n.angle += weak ? turn * Math.min(1, fraction * dt * 30) : Math.max(-PI * 5 * dt, Math.min(PI * 5 * dt, turn));
            const x0 = n.x, y0 = n.y, speed = n.target && !n.pass ? 2.2 : n.speed;
            n.x += cos(n.angle) * speed * dt; n.y += sin(n.angle) * speed * dt;
            let hit = false;
            for (const e of foes) {
              if (!e.alive || n.seen.has(e.id) || distanceToSegment(e, x0, y0, n.x, n.y) > 0.3) continue;
              n.seen.add(e.id); hit = true;
              battle.dealDamage(unit, e, { amount: n.amount, type: n.type,
                isSkill: n.scale !== 1 || selected === S2, tags: ['oblvns:note'], defIgnorePct: Math.min(1, Math.min(m.notes.length, num(t1.max_cnt, 10)) * num(t1.def_penetrate_ratio)),
                resIgnorePct: Math.min(1, Math.min(m.notes.length, num(t1.max_cnt, 10)) * num(t1.magic_resist_penetrate_ratio)) });
              battle.fx('musicNote', { x: e.x, y: e.y, id: unit.id, target: e.id, kind: n.type, note: n.seq,
                projectile: n.projectile, angle: n.angle, phase: 'hit', pierce: n.pierce, skill: selected });
              if (n.fever && m.fever <= 0) m.gauge = Math.min(FEVER_LIMIT, m.gauge + num(t2.cnt, 3));
              if (!n.pierce) break;
              n.pass ||= num(b2['attack@passby_delay'], 0.5); n.target = null;
            }
            if (hit && !n.pierce) continue;
            if (m.draw <= 0) battle.fx('musicNote', { x: n.x, y: n.y, id: unit.id, kind: n.type, note: n.seq,
              projectile: n.projectile, angle: n.angle, skill: selected });
            keep.push(n);
          }
          m.notes = keep;
          if (m.draw <= 0) m.draw = 0.1;
          if (m.aura <= 0) {
            m.aura = 0.2;
            for (const ally of battle.allyUnits) {
              if (!up(ally) || ally.ownerId !== unit.ownerId) continue;
              const key = `oblvns:aura:${unit.id}`;
              battle.removeBuff(ally, key);
              if (inRange(unit, ally.x, ally.y) && num(t2.attack_speed) > 0) battle.addBuff(ally, { key, duration: 0.3, mods: { aspd: num(t2.attack_speed) } });
            }
          }
        }, { owner: unit });
      },
    };
  },
};
