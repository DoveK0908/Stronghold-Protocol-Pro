// public/js/render/vfx/sakiko.js — 丰川祥子 (char_4182_oblvns) 的音符与拨档特效，
// Adapted from selena 0.4.1: notes follow sim events, forms are detected in tick(), and placement uses playOn.
// The kit is now the default, so ownership follows the DIY character rather than the old kitSet comparison marker.
// import-sakiko-fx.mjs supplies the original and outfit prefabs and maps the fork's underscore outfit id.
//
// 与 selena 的 kit 配套：服务端 `server/sim/content/kits/ops/op-oblvns.js` 发 `musicNote` 事件
// （`fx/kinds.js` + `fx/simfx.js` 的 `musicNote` 分支画 sim 侧的短促记号）。默认启用（2026-10-27 定案，本树原实现已删除）。
//
// Native independent notes follow the sim's positions, not an extra client-side homing flight. Each caster + note has
// one handle, including notes without targets.
export const SAKIKO = 'char_4182_oblvns';
const NOTE_STALE = 0.35;
const MAX_NOTES = 192;

export class SakikoFx {
  constructor(wiring) {
    this.w = wiring;
    this.notes = new Map();
    this.tones = new Map();
    this.ranges = new Map();
    /** 上一帧各单位的 form（本树没有 form 回调，这里自己检测；见头注释第 2 条）。 */
    this.forms = new Map();
  }

  /** Own Sakiko's notes for the adopted kit, including DIY slots and unmarked snapshots. */
  owns(view) {
    const info = view?.info;
    return (info?.diy?.charId || info?.charId || this.w.unitKeyOf(view)) === SAKIKO;
  }

  keys(views) {
    if (![...views].some(v => this.owns(v))) return [];
    // Include all eight S1 notes and both S2/S3 tones, plus their exact outfit replacements. The first attack must not
    // wait for its texture to download.
    return Object.keys(this.w.idx?.prefabs || {}).filter(k => k.startsWith('oblvns_'));
  }

  key(view, key) {
    // The imported outfit uses underscore ids in this fork; its prefab keys retain the client's suffix.
    if (view?.info?.skin === 'char_4182_oblvns_avemujica_1') {
      const outfit = `${key}_avemujica#1`;
      if (this.w.ofx.lib.has(outfit)) return outfit;
    }
    const overlay = this.w.idx?.skinVariants?.[view?.info?.skin];
    const replacement = overlay?.charId === SAKIKO && overlay.replacements?.[key];
    return replacement && this.w.ofx.lib.has(replacement) ? replacement : key;
  }

  attack(view) {
    if (!this.owns(view) || !this.w.ofx.active) return false;
    const form = this.w.formOf(view), state = this.w.skills.state(view);
    const key = state.on && view.info?.skillIndex === 2 ? 'oblvns_skill_03_start'
      : form === 'oblvns_organ' ? 'oblvns_skill_02_start_b'
        : form === 'oblvns_piano' ? 'oblvns_skill_02_start_a' : 'oblvns_attack_01_start';
    this.w.playOn(this.key(view, key), view);
    return true; // the sim's note events provide the flight and actual impacts
  }

  skill(view, on) {
    if (!this.owns(view)) return;
    const id = view.id ?? view.info?.id;
    if (view.info?.skillIndex === 2) {
      this.ranges.get(id)?.stop();
      this.ranges.delete(id);
      if (on && this.w.ofx.active) {
        this.w.playOn(this.key(view, 'oblvns_skill_03_start'), view);
        const h = this.w.playOn(this.key(view, 'oblvns_skill_03_range'), view, { loop: true, follow: true });
        if (h) this.ranges.set(id, h);
      }
    }
  }

  form(view, form) {
    if (!this.owns(view)) return;
    const id = view.id ?? view.info?.id;
    this.tones.get(id)?.stop();
    this.tones.delete(id);
    if (!this.w.ofx.active || !['oblvns_piano', 'oblvns_organ'].includes(form)) return;
    this.w.playOn(this.key(view, 'oblvns_skill_02_start'), view);
    const h = this.w.playOn(this.key(view, 'oblvns_skill_02_buff'), view, { loop: true, follow: true });
    if (h) this.tones.set(id, h);
  }

  simFx(kind, x, y, extra) {
    if (kind !== 'musicNote' || !this.w.ofx.active || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const view = this.w.view(extra?.id);
    if (!this.owns(view)) return false;
    const projectile = this.w.idx.projectiles?.[extra.projectile];
    if (!projectile) return false;
    const slot = `${extra.id}:${extra.note}`, now = this.w.ofx.time;
    if (extra.phase === 'hit') {
      const target = this.w.view(extra.target);
      const point = target || { x, y, z: view.z || 0 };
      let drew = false;
      for (const key of projectile.onHit || []) {
        // Replacement belongs to the shooter, not the enemy struck by the note.
        if (this.w.playOn(this.key(view, key), point, { flipFrom: view })) drew = true;
      }
      if (!extra.pierce) {
        this.notes.get(slot)?.handle.stop({ hit: true });
        this.notes.delete(slot);
      }
      return drew;
    }
    const key = this.key(view, projectile.main);
    if (!key || !this.w.ofx.lib.has(key)) return false;
    let note = this.notes.get(slot);
    if (note && note.key !== key) { note.handle.kill(); this.notes.delete(slot); note = null; }
    if (!note || !note.handle.alive) {
      const owned = [...this.notes].filter(([, n]) => n.owner === extra.id);
      if (owned.length >= MAX_NOTES) { owned[0][1].handle.kill(); this.notes.delete(owned[0][0]); }
      note = { owner: extra.id, key, x, y, fromX: x, fromY: y, span: 0.1, angle: extra.angle || 0, at: now, base: null };
      // 用 playOn 而不是裸 spawn：音符的朝向/贴图/材质要走与其它官方特效同一条摆放路径（render/vfx/wiring.js
      // playOn —— 载体按干员的 dir/visFacing/skin 摆好，裸 spawn + yaw 会把 prefab 拧成一片发光条，看起来
      // 就不像音符了，用户 2026-10-27 报「有一团发光的东西，但不像音符模型」）。
      const carrier = {
        x, y, z: 0, hover: 0, dir: view.dir ?? 'RIGHT', visFacing: view.visFacing ?? 1,
        alive: true, destroyed: false, anim: null, info: view.info ?? null,
      };
      note.handle = this.w.playOn(key, carrier, {
        loop: true, by: view,
        track: fx => {
          if (this.w.ofx.time - note.at > NOTE_STALE || view.destroyed || view.alive === false) { fx.stop(); return; }
          // 摆放点是音符的出生点，之后每帧只按「飞了多远」平移（与 render/fx/notes.js 的官方音符同法）。
          if (!note.base) note.base = [fx.anchor[0], fx.anchor[1], carrier.x, carrier.y];
          const t = Math.min(1, Math.max(0, (this.w.ofx.time - note.at) / note.span));
          fx.anchor[0] = note.base[0] + note.fromX + (note.x - note.fromX) * t - note.base[2];
          fx.anchor[1] = note.base[1] + note.fromY + (note.y - note.fromY) * t - note.base[3];
        },
      });
      if (!note.handle) return false;
      this.notes.set(slot, note);
    }
    const elapsed = now - note.at;
    const t = Math.min(1, Math.max(0, elapsed / note.span));
    Object.assign(note, {
      fromX: note.fromX + (note.x - note.fromX) * t,
      fromY: note.fromY + (note.y - note.fromY) * t,
      span: elapsed > 0 ? Math.min(0.2, Math.max(1 / 120, elapsed)) : note.span,
      x, y, angle: extra.angle || 0, at: now,
    });
    return true;
  }

  /** 每帧：收掉过期的音符 + 自行检测 form 变化（本树没有 form 回调）。 */
  tick(views = null) {
    for (const [slot, note] of this.notes) {
      const view = this.w.view(note.owner);
      if (!this.w.ofx.active || !note.handle.alive || this.w.ofx.time - note.at > NOTE_STALE || !view || view.alive === false) {
        note.handle.stop(); this.notes.delete(slot);
      }
    }
    if (!views) return;
    for (const v of views) {
      const id = v?.id ?? v?.info?.id;
      if (id == null) continue;
      const form = v?.info?.form ?? null;
      if (this.forms.get(id) === form) continue;
      const had = this.forms.has(id);
      this.forms.set(id, form);
      if (had || form != null) this.form(v, form);   // 首次见到但 form 为空时不播
    }
  }

  release(view) {
    const id = view?.id ?? view?.info?.id;
    for (const [slot, note] of this.notes) if (note.owner === id) { note.handle.kill(); this.notes.delete(slot); }
    for (const map of [this.tones, this.ranges]) { map.get(id)?.stop(); map.delete(id); }
    this.forms.delete(id);
  }

  clear() {
    for (const note of this.notes.values()) note.handle.kill();
    this.notes.clear();
    for (const map of [this.tones, this.ranges]) { for (const h of map.values()) h.stop(); map.clear(); }
    this.forms.clear();
  }
}
