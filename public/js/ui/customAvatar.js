// 自传头像 (维护者需求 2026-10-21): a player uploads one square image, the server keeps it (server/avatars.js) and
// the room shows it to everyone through the seat card's `avatarImg` (GET /avatar/<id>). The image never leaves this
// machine's server, and a re-upload replaces the browser's previous one.
import { net } from '../net.js';
import { cardStore, setCustomAvatar } from './playerCard.js';
import { t } from '../../../shared/i18n.js';
import { cropFile } from './imageCropper.js';
import { uploadBigImage } from './customNamecard.js';
import { isAnimatedImage } from './imageSniff.js';

/** Longest side sent to the server: 256px square is bigger than every place an avatar shows (seat card sm, 名片). */
const SIDE = 256;
/** The server's limit (server/avatars.js put): refuse here first so the user gets a message instead of a silent drop. */
const MAX_RAW = 4 * 1024 * 1024;

/** `/avatar/<id>` — the URL of an uploaded avatar (id = 16 hex, server/avatars.js). */
export function avatarSrc(id) {
  return typeof id === 'string' && /^[0-9a-f]{16}$/.test(id) ? `/avatar/${id}` : '';
}

/** The uploadable image of a picked file: the user frames it in the cropper, then it is re-drawn at 256² (WebP). */
async function shrink(file) {
  if (!file || !/^image\//.test(file.type || '')) return null;
  if (file.size > MAX_RAW) return null;
  const blob = await cropFile(file, { aspect: 1, outWidth: SIDE, title: t('调整头像') });
  if (!blob) return null;
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

/**
 * Upload one file as this browser's avatar. Resolves to `{ ok: true, id }` or `{ ok: false, err }`.
 * The caller saves the id (setCustomAvatar) once the server took it.
 * @param {File} file
 * @returns {Promise<{ ok: boolean, id?: string, err?: string }>}
 */
export async function uploadAvatar(file) {
  // 动图头像：裁不了（会丢帧），原样走 HTTP 上传通道；CSS 那层是 object-fit: cover，方形裁切由显示端负责。
  if (file && /^image\//.test(file.type || '') && file.size <= 8 * 1024 * 1024) {
    const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
    if (isAnimatedImage(head)) {
      const gid = await uploadBigImage(file, 'avatar');
      return gid ? { ok: true, id: gid } : { ok: false, err: t('上传失败，换一张图片再试') };
    }
  }
  const data = await shrink(file);
  if (!data) return { ok: false, err: t('请选择一张 4MB 以内的图片（PNG/JPEG/WEBP）') };
  const id = await new Promise((resolve) => {
    const offs = [];
    const done = (v) => { while (offs.length) { try { offs.pop()(); } catch { /* ignore */ } } clearTimeout(timer); resolve(v); };
    const onTaken = (msg) => {
      const got = msg?.id;
      if (typeof got === 'string' && /^[0-9a-f]{16}$/.test(got)) done(got);
    };
    const onErr = () => done('');
    const timer = setTimeout(() => done(''), 8000);
    offs.push(net.on('me.avatar', onTaken), net.on('error', onErr), net.on('helloError', onErr));
    net.send('me.avatar', { data });
  });
  return id ? { ok: true, id } : { ok: false, err: t('上传失败，换一张图片再试') };
}

/** Re-claim this browser's uploaded avatar after a reload (the server keeps it per owner; only the owner's id is accepted). */
export function claimAvatar(id = cardStore.get().avatarImg) {
  if (typeof id !== 'string' || !/^[0-9a-f]{16}$/.test(id)) return;
  // The server answers `{ id: '' }` when this id no longer belongs to this browser (the file was deleted); drop the
  // stale preference instead of retrying it on every reload.
  const off = net.on('me.avatar', (msg) => { if (msg && msg.id === '') { off(); setCustomAvatar(''); } });
  net.send('me.avatar', { id });
}
