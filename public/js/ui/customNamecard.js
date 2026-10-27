// 自传名片底图 (维护者需求 2026-10-22): one picture per browser, kept by the server (server/namecards.js) and shared
// with the room through seats[].card.bg = `custom:<id>` (GET /namecard/<id>). The crop / zoom / pan dialog is
// ui/imageCropper.js; the plate behind a name is wide, so the frame is 4:1 (维护者 2026-10-27).
import { net } from '../net.js';
import { loadPref, savePref } from '../store.js';
import { cropFile } from './imageCropper.js';
import { isAnimatedImage } from './imageSniff.js';
import { DEFAULT_NAMECARD } from './namecards.js';
import { t } from '../../../shared/i18n.js';

/** Sent to the server at most this wide; the ladder in imageCropper keeps it under one 64KB WS frame. */
const WIDTH = 720;
/** Every place that draws a 名片 is 4:1 (维护者 2026-10-27): 720×180 out of the cropper, and the CSS plates are all
 *  `.has-nc { --nc-ar: 4 / 1 }`, so one upload keeps its shape from the picker to the room seat. */
export const NAMECARD_ASPECT = 4;
const MAX_RAW = 30 * 1024 * 1024;

/** `/namecard/<id>` — the URL of an uploaded 名片底图 (id = 16 hex, server/namecards.js). */
export function namecardImgSrc(id) {
  return typeof id === 'string' && /^[0-9a-f]{16}$/.test(id) ? `/namecard/${id}` : '';
}

/** Where a big (animated) picture goes: one throwaway ticket, then a POST of the raw bytes. */
export async function uploadBigImage(blob, kind) {
  const ticket = await new Promise((resolve) => {
    const offs = [];
    const done = (v) => { while (offs.length) { try { offs.pop()(); } catch { /* ignore */ } } clearTimeout(timer); resolve(v); };
    const onTicket = (msg) => { if (typeof msg?.ticket === 'string') done(msg.ticket); };
    const timer = setTimeout(() => done(''), 10000);
    offs.push(net.on(`me.${kind}.ticket`, onTicket), net.on('error', () => done('')), net.on('helloError', () => done('')));
    net.send(`me.${kind}.ticket`, {});
  });
  if (!ticket) return '';
  try {
    const res = await fetch(`/upload/${kind}?ticket=${encodeURIComponent(ticket)}`, {
      method: 'POST',
      headers: { 'content-type': blob.type || 'image/gif' },
      body: blob,
    });
    if (!res.ok) return '';
    const out = await res.json().catch(() => null);
    return typeof out?.id === 'string' && /^[0-9a-f]{16}$/.test(out.id) ? out.id : '';
  } catch { return ''; }
}

/** base64 of a Blob (the protocol carries the picture as base64 text). */
async function toBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

/**
 * Let the user frame a picked picture and upload it as this browser's 名片底图.
 * Resolves to `{ ok: true, id }` or `{ ok: false, err }`.
 * @param {File} file
 */
export async function uploadNamecard(file) {
  if (!file || !/^image\//.test(file.type || '') || file.size > MAX_RAW) {
    return { ok: false, err: t('请选择一张 30MB 以内的图片（PNG/JPEG/WEBP/GIF）') };
  }
  // 动图：裁不了（会丢帧），也不适合塞进 WS 帧——原样走 HTTP 上传，浏览器按 4:1 铺满（object-fit: cover）。
  const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  if (isAnimatedImage(head)) {
    if (file.size > 8 * 1024 * 1024) return { ok: false, err: t('动图请控制在 8MB 以内') };
    const gid = await uploadBigImage(file, 'namecard');
    return gid ? { ok: true, id: gid } : { ok: false, err: t('上传失败，换一张图片再试') };
  }
  const blob = await cropFile(file, { aspect: NAMECARD_ASPECT, outWidth: WIDTH, title: t('调整名片底图'), maxBytes: Math.floor(64 * 1024 * 0.72) });
  if (!blob) return { ok: false, err: t('已取消') };
  const data = await toBase64(blob);
  const id = await new Promise((resolve) => {
    const offs = [];
    const done = (v) => { while (offs.length) { try { offs.pop()(); } catch { /* ignore */ } } clearTimeout(timer); resolve(v); };
    const onTaken = (msg) => {
      const got = msg?.id;
      if (typeof got === 'string' && /^[0-9a-f]{16}$/.test(got)) done(got);
    };
    const onErr = () => done('');
    const timer = setTimeout(() => done(''), 10000);
    offs.push(net.on('me.namecard', onTaken), net.on('error', onErr), net.on('helloError', onErr));
    net.send('me.namecard', { data });
  });
  return id ? { ok: true, id } : { ok: false, err: t('上传失败，换一张图片再试') };
}

const NAMECARD_PREF = 'room.namecard';

/** The uploaded id stored as this browser's card, if the current pick is one (`custom:<id>`). */
export function storedNamecardId() {
  const bg = loadPref(NAMECARD_PREF, '');
  const m = typeof bg === 'string' ? /^custom:([0-9a-f]{16})$/.exec(bg) : null;
  return m ? m[1] : '';
}

/** Re-claim this browser's uploaded 名片底图 after a reload (the server keeps it per owner; only the owner's id is accepted). */
export function claimNamecard(id = storedNamecardId()) {
  if (typeof id !== 'string' || !/^[0-9a-f]{16}$/.test(id)) return;
  // `{ id: '' }` = this upload no longer exists on the server (deleted by hand); clear the pick so the card falls back
  // to the preset background instead of warning on every reload.
  const off = net.on('me.namecard', (msg) => {
    if (msg && msg.id === '') {
      off();
      savePref(NAMECARD_PREF, '');
      // 动态 import：playerCard 依赖 namecards，静态导入会形成 namecards→customNamecard→playerCard→namecards 的环。
      import('./playerCard.js').then(({ cardStore }) => cardStore.set({ bg: DEFAULT_NAMECARD })).catch(() => {});
    }
  });
  net.send('me.namecard', { id });
}
