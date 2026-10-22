// 自传名片底图 (维护者需求 2026-10-22): one picture per browser, kept by the server (server/namecards.js) and shared
// with the room through seats[].card.bg = `custom:<id>` (GET /namecard/<id>). The crop / zoom / pan dialog is
// ui/imageCropper.js; the card is drawn tall behind a name plate, so the frame is 1:2.
import { net } from '../net.js';
import { loadPref } from '../store.js';
import { cropFile } from './imageCropper.js';
import { t } from '../../../shared/i18n.js';

/** Sent to the server at most this wide (a 720×1440 WebP is ~120–250KB; the server caps 400KB). */
const WIDTH = 720;
/** The frame of a seat card's art well (~340×720): a name card is drawn behind the plate. */
export const NAMECARD_ASPECT = 0.5;
const MAX_RAW = 30 * 1024 * 1024;

/** `/namecard/<id>` — the URL of an uploaded 名片底图 (id = 16 hex, server/namecards.js). */
export function namecardImgSrc(id) {
  return typeof id === 'string' && /^[0-9a-f]{16}$/.test(id) ? `/namecard/${id}` : '';
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
    return { ok: false, err: t('请选择一张 30MB 以内的图片（PNG/JPEG/WEBP）') };
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
  if (typeof id === 'string' && /^[0-9a-f]{16}$/.test(id)) net.send('me.namecard', { id });
}
