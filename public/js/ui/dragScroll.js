// Mouse drag pans a sideways strip (a desktop has no swipe): past a few pixels the press becomes a drag, the strip
// follows the pointer, and the click that ends it is swallowed so nothing under the pointer is picked by letting go.
// Touch and pen keep the browser's own scrolling — `pointerType !== 'mouse'` never starts a drag.
//
// Two users: the 干员调配 deck (screens/loadout.js) and the 同盟等待室 seat strip (screens/room.js, 8–20 seat rooms —
// community report 2026-10-24: the seats can only be reached with the wheel or the thin scrollbar).
//
// Options:
//   canStart(el) → boolean   only start when this strip really overflows (default: always).
//   skip(target) → boolean   true for elements a press must not turn into a drag (default: form controls).
//   threshold                pixels before a press counts as a drag (default 6).
import { useRef } from '../../vendor/hooks.module.js';

const FORM_FIELDS = 'select, input, textarea';

export function useDragScroll(opts = {}) {
  const {
    canStart = () => true,
    skip = (target) => !!target?.closest?.(FORM_FIELDS),
    threshold = 6,
  } = opts;
  const drag = useRef(null);
  const swallow = useRef(false);
  const end = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    e.currentTarget?.classList?.remove?.('is-dragging');
    swallow.current = true;
    setTimeout(() => { swallow.current = false; }, 0);
  };
  return {
    onPointerDown: (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      if (skip(e.target)) return;
      if (!canStart(e.currentTarget)) return;
      drag.current = { id: e.pointerId, x: e.clientX, left: e.currentTarget.scrollLeft, moved: false };
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      if (!d.moved) {
        if (Math.abs(dx) < threshold) return;
        d.moved = true;
        // A synthetic pointer (tests) or one already released throws here; capturing is only an optimisation, so shrug.
        try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* no active pointer */ }
        e.currentTarget.classList?.add?.('is-dragging');
      }
      e.currentTarget.scrollLeft = d.left - dx;
    },
    onPointerUp: end,
    onPointerCancel: end,
    onClickCapture: (e) => { if (swallow.current) { swallow.current = false; e.stopPropagation(); e.preventDefault(); } },
  };
}
