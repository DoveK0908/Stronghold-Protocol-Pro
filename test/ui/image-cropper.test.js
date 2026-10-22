// 图片裁剪器 (ui/imageCropper.js): the cover framing, the zoom and the pan clamp — the maths every upload shares.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { framing, MAX_ZOOM } from '../../public/js/ui/imageCropper.js';

test('framing: a wide picture covers the stage and is centred', () => {
  const f = framing({ iw: 1000, ih: 500, w: 400, h: 600 });
  assert.equal(f.scale, 1.2, 'cover uses the taller side');
  assert.equal(f.dw, 1200);
  assert.equal(f.dh, 600);
  assert.equal(f.x, -400);
  assert.equal(f.y, 0);
});

test('framing: zoom is clamped to [1, MAX_ZOOM] and the pan cannot open a gap', () => {
  const base = framing({ iw: 800, ih: 800, w: 400, h: 400 });
  assert.equal(base.scale, 0.5);
  const out = framing({ iw: 800, ih: 800, w: 400, h: 400, zoom: 99, x: 9999, y: -9999 });
  assert.equal(out.scale, 0.5 * MAX_ZOOM);
  assert.equal(out.dw, 800 * 0.5 * MAX_ZOOM);
  // clamped to the edges: the image still covers the stage
  assert.ok(out.x <= 0 && out.x + out.dw >= 400);
  assert.ok(out.y <= 0 && out.y + out.dh >= 400);
  const z = framing({ iw: 800, ih: 800, w: 400, h: 400, zoom: 0 });
  assert.equal(z.scale, 0.5, 'below 1 still covers');
});
