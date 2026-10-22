// 自传图片的裁剪器（维护者 2026-10-22：头像、名片底图、大厅背景这些能上传的都要能裁剪、缩放、挪位置）。
// One modal for every upload: the picture covers a fixed-aspect stage, the user drags it / zooms with the wheel or the
// slider, and 确定 re-draws the same framing into a canvas at the target size. Geometry is a pure function so the tests
// can check the cover / clamp maths without a DOM.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { render, h } from '../../vendor/preact.module.js';
import { html, Modal, Button, Icon } from './components.js';
import { t } from '../../../shared/i18n.js';

/** The stage's CSS width, in px (its height follows the aspect). */
export const STAGE_W = 520;
const STAGE_H = 420;
export const MAX_ZOOM = 4;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The framing of an image inside a w×h stage: the cover scale, the user's zoom, and the clamped pan. */
export function framing({ iw, ih, w, h, zoom = 1, x = 0, y = 0 }) {
  const base = Math.max(w / iw, h / ih);
  const scale = base * clamp(zoom, 1, MAX_ZOOM);
  const dw = iw * scale;
  const dh = ih * scale;
  // the image always covers the stage, so the pan may not open a gap on any side
  const px = clamp(x, (w - dw) / 2, (dw - w) / 2);
  const py = clamp(y, (h - dh) / 2, (dh - h) / 2);
  return { scale, dw, dh, x: (w - dw) / 2 + px, y: (h - dh) / 2 + py };
}

/** Draw the framing into a canvas of `ow × oh` and hand back a Blob (WebP, PNG when the browser won't encode WebP). */
export async function renderCrop(bitmap, { aspect, outWidth = 1024, framing: f, w, _stageH, quality = 0.9, maxBytes = 0 }) {
  // (stageH is the on-screen stage height; the output keeps the requested aspect)
  const ladder = maxBytes ? [quality, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42] : [quality];
  // 服务端上行帧上限 64 KB（server/http/websocket.js 的 WS_MAX_PAYLOAD），base64 还会涨 4/3。
  // 先按质量阶梯压；仍超就等比缩输出宽度再压，保证一次上传不会因为帧太大被掐断。
  const scales = maxBytes ? [1, 0.82, 0.66, 0.54] : [1];
  let last = null;
  for (const scale of scales) {
    const ow = Math.max(64, Math.round(outWidth * scale));
    const oh = Math.max(1, Math.round(ow / aspect));
    const canvas = document.createElement('canvas');
    canvas.width = ow; canvas.height = oh;
    const cx = canvas.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    const k = ow / w;
    cx.drawImage(bitmap, f.x * k, f.y * k, f.dw * k, f.dh * k);
    for (const q of ladder) {
      const webp = await new Promise((r) => canvas.toBlob(r, 'image/webp', q));
      if (!webp) break;
      last = webp;
      if (!maxBytes || webp.size <= maxBytes) return webp;
    }
  }
  if (last) return last;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(outWidth); canvas.height = Math.max(1, Math.round(outWidth / aspect));
  return await new Promise((r) => canvas.toBlob(r, 'image/png'));
}


function Cropper({ file, aspect, title, outWidth = 1024, maxBytes = 0, onDone }) {
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const [bitmap, setBitmap] = useState(null);
  const [url, setUrl] = useState(null);
  // 竖构图（名片 1:2）按高度收边，否则 520/0.5 = 1040px 会顶出弹窗
  const stage = (() => {
    const h = Math.min(STAGE_H, Math.round(STAGE_W / aspect));
    return { w: Math.round(h * aspect), h };
  })();
  useEffect(() => {
    let alive = true;
    createImageBitmap(file).then((bm) => {
      if (!alive) { bm.close?.(); return; }
      setBitmap(bm);
      setUrl(URL.createObjectURL(file));
    }).catch(() => onDone(null));
    return () => { alive = false; };
  }, [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const f = bitmap ? framing({ iw: bitmap.width, ih: bitmap.height, w: stage.w, h: stage.h, zoom, ...pos }) : null;
  const onDown = (e) => {
    drag.current = { sx: e.clientX, sy: e.clientY, x: pos.x, y: pos.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (drag.current) setPos({ x: drag.current.x + (e.clientX - drag.current.sx), y: drag.current.y + (e.clientY - drag.current.sy) });
  };
  const onUp = () => { drag.current = null; };
  const onWheel = (e) => { e.preventDefault(); setZoom((z) => clamp(z - e.deltaY * 0.0015, 1, MAX_ZOOM)); };
  return html`<${Modal} open title=${title || t('调整图片')} width="6.4rem" onClose=${() => onDone(null)}>
    <div class="crop">
      <div class="crop__stage" style=${`width:${stage.w}px;height:${stage.h}px`}
           onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${onUp} onWheel=${onWheel}>
        ${url && f ? html`<img src=${url} alt="" draggable="false"
             style=${`width:${f.dw}px;height:${f.dh}px;transform:translate(${f.x}px,${f.y}px)`} />` : null}
      </div>
      <div class="crop__bar">
        <${Icon} name="minus" />
        <input type="range" min="1" max=${MAX_ZOOM} step="0.01" value=${zoom} aria-label=${t('缩放')}
               onInput=${(e) => setZoom(Number(e.currentTarget.value))} />
        <${Icon} name="plus" />
        <span class="crop__zoom">${Math.round(zoom * 100)}%</span>
        <button type="button" class="crop__reset" onClick=${() => { setZoom(1); setPos({ x: 0, y: 0 }); }}>${t('重置')}</button>
      </div>
      <p class="crop__hint">${t('拖动图片调整位置，滚轮或滑块缩放')}</p>
      <div class="crop__foot">
        <${Button} variant="ghost" onClick=${() => onDone(null)}>${t('取消')}</${Button}>
        <${Button} variant="primary" disabled=${!bitmap} onClick=${async () => {
          if (!bitmap) return;
          const blob = await renderCrop(bitmap, { aspect, outWidth, framing: f, w: stage.w, stageH: stage.h, maxBytes });
          bitmap.close?.();
          onDone(blob);
        }}>${t('确定')}</${Button}>
      </div>
    </div>
  </${Modal}>`;
}

/**
 * Ask the user to frame a picture. Resolves to the cropped Blob, or null when they cancel / the file won't decode.
 * @param {{ file: File, aspect: number, outWidth?: number, title?: string }} opts
 */
export async function cropImage({ file, aspect, outWidth = 1024, title, maxBytes = 0 }) {
  return await new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let settled = false;
    const done = (blob) => {
      if (settled) return;
      settled = true;
      try { render(null, host); } catch { /* ignore */ }
      try { host.remove(); } catch { /* ignore */ }
      resolve(blob || null);
    };
    render(h(Cropper, { file, aspect, title, outWidth, maxBytes, onDone: done }), host);
  });
}

/** The File → cropped Blob of one upload (null when not an image or the user cancels). */
export async function cropFile(file, opts) {
  if (!file || !/^image\//.test(file.type || '')) return null;
  return await cropImage({ file, ...opts });
}
