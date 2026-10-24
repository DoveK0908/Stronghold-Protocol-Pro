// server/sim/content/kits/ops/op-makoto.js — 结城理 (char_4217_makoto) kit, tier 6.
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.
//
// 结城理 is a 自选-only operator: the official tables have him (Persona 3 联动, SPECIAL/dollkeeper, 6★) but the chess
// pool does not, so `tools/build-data.mjs` keeps him in `data/backups.json` `diy.ownedPool` through the
// `DIY_INCLUDED_COLLAB` exception. The 替身 switch itself is `professions.js installDollkeeper` (fatal → 1 s 无敌 switch
// animation → the 替身 for `trait.bb.duration` = 20 s → back to the 本体); this kit adds what is his:
//
// - 三个技能都是「立刻切换为<替身>状态作战」(MANUAL, durationType NONE): the selected skill decides WHICH 人格面具 the
//   替身 is — S1 俄耳甫斯, S2 塔纳托斯, S3 塔纳托斯 that becomes 俄耳甫斯 when it would be knocked out. The skeleton
//   carries one clip set per form (`Doll_Skill_1_*` / `Doll_Skill_2_*` / `Doll_Skill_3_P1_*` / `Doll_Skill_3_P2_*`),
//   so the sim names the form (`unit.form` = 'doll1' | 'doll2' | 'doll3p1' | 'doll3p2'; `installDollkeeper` maps the
//   selected skill through `unit.profile.dollForms`) and `public/js/render/units.js` FORMS maps it to those clips.
// - T0 不羁之力: switching to the 替身 停顿 (stun) the enemies around her for `sluggish` s; in the 替身 ATK +85 %,
//   max HP +35 %, attack interval +0.4 s (the 人格面具 swings slower but hits far harder).
// - T1 S.E.E.S.队长: when the 替身 ends she leads the squad's 总攻击 — `atk_scale` × ATK true damage to every enemy
//   around her [SIMPLIFIED: PRTS spreads it around the S.E.E.S. squad members; the sim has no team ids, so only her own
//   surroundings are hit].
// - 「范围」 is the trait's `x-1` ring (`chess.trait.rangeGrid`, 13 tiles), not the 2-tile attack range: the 停顿, the
//   heal, the extra targets and the 总攻击 all read it (`bbStr.range_id` on both talents names `x-1`).
// - The 替身's normal attack is the 人格面具's: an arts hit at `attack@atk_scale` (S1 150 %, S2 160 %, S3 170 %) on up to
//   `attack@max_target` enemies. 俄耳甫斯 (S1, and S3's second form) heals instead when an ally below 50 % HP stands in
//   her range (S1 40 % ATK; S3-P2 also 25 % ATK per second to up to 3 allies, plus 30 % physical and arts 闪避 to the
//   team); 塔纳托斯 (S2) fears on 35 % for 1.5 s and knocks out a feared enemy whose HP is below 230 % of her ATK.
//   [ASSUMED: S2/S3 read 弱点/法术 — the sim has no 弱点 damage type, so both are arts.]

import { num, talentBb, traitBb, batMod, RING1, instantKind, enemiesInGrid, alliesInGridOf } from '../shared/tier1.js';

/** The 替身 form of each selectable skill (index 0/1/2); `installDollkeeper` maps the selected skill to it. */
const DOLL_FORMS = Object.freeze(['doll1', 'doll2', 'doll3p1']);
/** S3's second 人格面具: 塔纳托斯 would be knocked out ⇒ 俄耳甫斯 takes over (PRTS "受到致命伤时改为召唤俄耳甫斯"). */
const DOLL_FORM_P2 = 'doll3p2';
/** S1/S3-P2 "范围内有生命值低于50%的友方干员时，改为对其治疗". */
const HEAL_BELOW = 0.5;
/** S3-P2 俄耳甫斯: 30 % physical and arts 闪避, 25 % ATK/s to up to 3 allies, while the 替身 lasts. */
const P2_DODGE = 0.3;
const P2_MAX_HEAL = 3;

export default {
  char_4217_makoto: (bb, chess, def) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1), tb = traitBb(chess);
    const dollDur = Math.max(1, num(tb.duration, 20));
    // the SELECTED skill's blackboard (`bb`) describes the 人格面具 it summons
    const atkScale = num(bb['attack@atk_scale'], 1);
    const maxTarget = Math.max(1, Math.round(num(bb['attack@max_target'], 1)));
    const healScale = num(bb['attack@heal_scale']);
    const fearProb = num(bb['attack@prob']);
    const fearDur = num(bb['attack@fear']);
    const killScale = num(bb['attack@kill_atk_scale']);
    const p2Block = Math.round(num(bb['attack@block_cnt']));
    const atkPct = num(t0.atk);
    const hpPct = num(t0.max_hp_t1);
    const batPct = batMod(t0.base_attack_time, chess);
    const sluggish = num(t0.sluggish);
    const allOut = num(t1.atk_scale);
    const ring = chess?.trait?.rangeGrid ?? null;
    /** The 俄耳甫斯 forms heal instead of striking (`S1 俄耳甫斯`, `S3-P2 俄耳甫斯`); `doll2` is 塔纳托斯. */
    const isOrfeo = (form) => form === 'doll1' || form === DOLL_FORM_P2;
    // 俄耳甫斯's heal and 塔纳托斯's extra targets both use the trait's own 范围 (`x-1`: the 13-tile ring around her),
    // which is what the talent blackboards' `bbStr.range_id` names — her 2-tile attack range would make both moot
    const hurtAlly = (battle, unit, n) => alliesInGridOf(battle, unit, ring)
      .filter((a) => a !== unit && a.hp > 0 && a.hp < a.s.maxHp)
      .filter((a) => a.hp / a.s.maxHp < HEAL_BELOW)
      .sort((a, b) => a.hp / a.s.maxHp - b.hp / b.s.maxHp)
      .slice(0, n);

    return {
      skills: {
        // the three skills only perform the switch: the 替身's identity is the form of the selected skill (profile
        // `dollForms`), its numbers are that skill's blackboard
        skchr_makoto_1: { kind: instantKind(def), onStart({ unit }) { unit.trait.dollEnter?.(); } },
        skchr_makoto_2: { kind: instantKind(def), onStart({ unit }) { unit.trait.dollEnter?.(); } },
        skchr_makoto_3: { kind: instantKind(def), onStart({ unit }) { unit.trait.dollEnter?.(); } },
      },
      talents: [
        { install(battle, unit) { // 不羁之力: the switch itself, its 停顿, and the 人格面具's boosts
          unit.profile.dollForms = DOLL_FORMS;
          battle.on('dollSwap', (ctx) => {
            if (ctx.unit !== unit) return;
            if (!ctx.form) { // the 本体 is back: the 人格面具 leaves
              battle.removeBuff(unit, 'makoto:doll');
              battle.removeBuff(unit, 'makoto:orfeo');
              // T1 S.E.E.S.队长: 总攻击, `atk_scale` × ATK true damage around her (see the header: [SIMPLIFIED])
              if (allOut > 0 && unit.alive && unit.deployed) {
                const targets = enemiesInGrid(battle, unit, ring, { n: 0 });
                for (const e of targets) if (e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * allOut, type: 'true', tags: ['talent', 'allout'] });
                if (targets.length) battle.fx('aoe', { x: unit.x, y: unit.y, radius: RING1, kind: 'allout' });
              }
              return;
            }
            // into the 替身: 停顿 the enemies around her (PRTS: 切换为<替身>状态时停顿周围一定范围内敌人 8 秒)
            if (sluggish > 0) {
              for (const e of enemiesInGrid(battle, unit, ring, { n: 0 })) {
                if (e.alive) battle.applyStatus(e, 'stun', { duration: sluggish, source: unit });
              }
            }
            battle.addBuff(unit, {
              key: 'makoto:doll', duration: 1 + dollDur, visible: false,
              mods: { atkPct, ...(hpPct ? { hpPct } : null), ...(batPct ? { batPct } : null) },
            });
            // S3-P2 俄耳甫斯: 阻挡数 +2 and the team's 闪避
            if (ctx.form === DOLL_FORM_P2 && (p2Block > 0 || healScale > 0)) {
              battle.addBuff(unit, {
                key: 'makoto:orfeo', duration: 1 + dollDur, visible: false,
                mods: { ...(p2Block > 0 ? { blockCnt: p2Block } : null), dodgePhys: P2_DODGE, dodgeArts: P2_DODGE },
              });
            }
          }, { owner: unit });
          // S3: 塔纳托斯 would be knocked out ⇒ 俄耳甫斯 takes over (once; after that she is knocked out as usual).
          // The 傀儡师 trait's own fatal handler runs at priority −100, this one just before it.
          battle.on('fatal', (ctx) => {
            if (ctx.unit !== unit || ctx.prevented) return;
            if (!unit.trait.doll || unit.trait.dollSwitching || unit.form !== DOLL_FORMS[2]) return;
            if (!unit.trait.dollForm) return;
            ctx.prevented = true;
            unit.trait.dollForm(DOLL_FORM_P2);
          }, { owner: unit, priority: -90 });
        } },
        { install(battle, unit) { // the 人格面具's own attack: arts, `attack@atk_scale`, up to `attack@max_target` enemies
          battle.on('hit', (ctx) => {
            if (ctx.source !== unit || !unit.trait.doll || unit.trait.dollSwitching) return;
            const dmg = ctx.dmg;
            if (!dmg || !dmg.isAttack) return; // her own normal attack only — not talent / item damage
            if (isOrfeo(unit.form) && healScale > 0) {
              // "改为对其治疗": an ally below half HP in her range takes the heal instead of the strike
              const [hurt] = hurtAlly(battle, unit, 1);
              if (hurt) {
                dmg.cancel = true;
                battle.heal(unit, hurt, unit.s.atk * healScale, { tags: ['doll', 'orfeo'] });
                return;
              }
            }
            dmg.type = 'arts';
            dmg.mul *= atkScale;
            const feared = (t) => fearProb > 0 && fearDur > 0 && t && t.alive && battle.rng.chance(fearProb)
              && battle.applyStatus(t, 'fear', { duration: fearDur, source: unit });
            const execute = (t) => {
              if (killScale > 0 && t && t.alive && t.hp > 0 && t.hp < unit.s.atk * killScale) {
                battle.dealDamage(unit, t, { amount: t.hp + 1, type: 'true', tags: ['doll', 'execute'] });
              }
            };
            feared(ctx.target);
            execute(ctx.target);
            // the remaining targets of a multi-target hit (`attack@max_target`), each with the same flavour
            if (maxTarget > 1) {
              for (const e of enemiesInGrid(battle, unit, ring, { n: maxTarget })) {
                if (e === ctx.target || !e.alive) continue;
                battle.dealDamage(unit, e, { amount: unit.s.atk * atkScale, type: 'arts', tags: ['doll', 'multi'] });
                feared(e);
                execute(e);
              }
            }
          }, { owner: unit });
          // S3-P2 俄耳甫斯's aura: 25 % ATK per second to up to 3 hurt allies while the 替身 lasts
          if (healScale > 0) {
            battle.every(1, () => {
              if (!unit.alive || !unit.trait.doll || unit.form !== DOLL_FORM_P2) return;
              for (const a of hurtAlly(battle, unit, P2_MAX_HEAL)) battle.heal(unit, a, unit.s.atk * healScale, { tags: ['doll', 'orfeo'] });
            }, { owner: unit });
          }
        } },
      ],
    };
  },
};
