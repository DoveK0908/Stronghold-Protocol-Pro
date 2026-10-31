// OfficialFx.update intentionally caps one frame at 0.25 s. Author-controlled stepping must retain the whole delta.
export function advanceEffectClock(effects, seconds) {
  if (!(seconds > 0) || !Number.isFinite(seconds)) { effects.update(0); return; }
  while (seconds > 0.25) { effects.update(0.25); seconds -= 0.25; }
  effects.update(seconds);
}

/**
 * Advance an effect layer's clock — the one thing that plays a prefab out (`Effect.update` is what starts its systems
 * and expires it by `ttl`). Every scene that can own a layer has to do it: an official effect spawned outside a battle
 * (the 休整期 arrival flash of a bought operator, or one swapped in by 巫恋's 「替身娃娃」) froze on its first frame and
 * stayed on screen until the next enterBattle/enterPrepMode cleared the layer.
 * (reported 2026-10-30: 「卖出干员触发策略效果时，休整期有特效残留」)
 */
export function tickEffectClock(effects, seconds, seekable = false) {
  if (!effects || effects.active === false) return false;
  if (seekable) advanceEffectClock(effects, seconds);
  else effects.update(seconds);
  return true;
}

/**
 * Real seconds between a battle cue's frame and the drawn frame: how long the sound of that batch has to wait so it is
 * heard when the swing / hit that made it is on screen (`view.cueDelay` → `audio.handleBattleEvents(ev, lead)`).
 * The render clock trails the newest snapshot by the jitter buffer's delay, so a cue sounded on arrival leads its own
 * picture — by 0.034 s in a client-simulated battle, from 0.1 s on a watched field, and at 2× the same real second is
 * two game seconds of the animation. A frame that is already drawn (negative) is 0; `max` keeps a stalled or rewinding
 * stream from parking a cue for seconds (audio.js clamps at the same value).
 * (reported 2026-10-30: 「对局中的音效和小人的动作不同步」 / 「二倍速下音效先响、动作后到」)
 */
export function cueLead(t, renderT, rate, max = 0.5) {
  const d = (Number(t) - Number(renderT)) / (Number(rate) > 0.01 ? Number(rate) : 1);
  if (!Number.isFinite(d) || !Number.isFinite(max)) return 0;
  return Math.max(0, Math.min(max, d));
}
