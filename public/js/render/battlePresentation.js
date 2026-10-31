import { ANIM, UF } from '../../../shared/constants.js';

// Preserve flight, stealth-driven forms and other persistent identity/status bits.
const END_CLEAR = UF.SKILL | UF.STUNNED | UF.FROZEN | UF.SLEEP | UF.BLOCKED | UF.COLD;

// How long the finish is played out once a decided field's feed stops growing, in GAME seconds: the tail belongs to the
// battle — the last swing, the deaths it triggers, their cues — so a real-second window halves at 2× and cuts exactly the
// moment it was meant to keep (reported 2026-10-30 at 2×: 「击杀最后一个怪的前几秒钟，声音和动作会突然停止」). The battle
// itself has already ended: the caller only asks `finish()` once the field is decided, so this is presentation only — no
// simulation tick, no delayed result, no golden moves. [ASSUMED] 1.2 game s outlasts a swing plus a death animation; the
// official finish's own length is not in the data tables.
const SETTLE_GAME = 1.2;
// The same window in real seconds is clamped: at a high rate it must still read as a pause, and a slow or stalled clock
// must not hold the settle for long.
const SETTLE_MIN = 0.6;
const SETTLE_MAX = 1.6;

/** Presentation-only completion: never infer an end from a missing/paused feed. */
export class BattlePresentation {
  constructor() { this.reset(); }
  reset() {
    this.requested = false; this.ended = false; this.tail = 0; this.quiet = 0; this.late = 0; this.newest = NaN;
    this.window = SETTLE_MAX;
  }
  finish() { this.requested = true; }
  /** Real seconds the finish plays for when the picture runs at `rate` game-s per real s (render/interp.js `rate`). */
  settleWindow(rate) {
    const r = Number(rate);
    if (!Number.isFinite(r) || r <= 0) return SETTLE_MAX;
    return Math.min(SETTLE_MAX, Math.max(SETTLE_MIN, SETTLE_GAME / r));
  }
  /**
   * @param renderT the render clock (render/interp.js `renderT`), game seconds
   * @param newestT the newest snapshot's time, game seconds
   * @param dt real seconds since the last frame
   * @param rate the picture's game-s per real s (render/interp.js `rate`)
   * @param trailing how far behind `newestT` the render clock settles by design (`delay × rate`, game seconds)
   */
  update(renderT, newestT, dt, rate, trailing = 0) {
    if (this.ended) { this.tail += Math.max(0, dt); return false; }
    if (!this.requested || !Number.isFinite(newestT)) {
      this.quiet = 0; this.late = 0; this.newest = NaN; return false;
    }
    // Two clocks decide the end: the feed stopping (the caller only asks `finish()` once the field is decided) AND the
    // picture having played what the feed handed it. The quiet window alone froze the tail whenever the render clock was
    // seconds behind the newest snapshot — which is exactly the shape a catch-up burst leaves at 2× (the local sim runs
    // up to CATCHUP_TICKS ahead in one frame): 2026-10-30 「击杀最后一个怪的前几秒钟，声音和动作会突然停止」. The old
    // `renderT >= newestT` test was the opposite failure and never fired: the clock settles `delay × rate` behind by
    // design (render/interp.js). So the window runs only while the picture is within `trailing` of the feed, and
    // `SETTLE_MAX × 2` is the backstop for a clock that cannot reach it at all (a stalled tab keeps its pose).
    this.window = this.settleWindow(rate);
    const step = Math.max(0, dt);
    this.late += step;
    const trail = Number.isFinite(trailing) && trailing > 0 ? trailing : 0;
    const gap = Number.isFinite(renderT) ? newestT - renderT : NaN;
    const caught = Number.isFinite(gap) && gap <= trail + 1e-6;
    // a growing feed means the finish is not over: the window counts from the last snapshot
    if (newestT !== this.newest) { this.newest = newestT; this.quiet = 0; }
    else if (caught) this.quiet += step;
    else this.quiet = 0;
    const start = this.quiet >= this.window || this.late >= SETTLE_MAX * 2;
    if (!start) return false;
    this.ended = true;
    this.tail += Math.max(0, dt);
    return true;
  }
  sample(s) {
    return this.ended && s.hp > 0 && s.anim !== ANIM.DIE
      ? { ...s, anim: ANIM.IDLE, flags: s.flags & ~END_CLEAR, vx: 0, vy: 0 } : s;
  }
}
