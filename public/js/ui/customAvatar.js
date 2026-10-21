// 自传头像 (维护者需求 2026-10-21): a player uploads one square image, the server keeps it (server/avatars.js) and
// the room shows it to everyone through the seat card's `avatarImg` (GET /avatar/<id>). The image never leaves this
// machine's server, and a re-upload replaces the browser's previous one.
import { net } from '../net.js';
import { cardStore } from './playerCard.js';
import { t } from '../../../shared/i18n.js';

/** Longest side sent to the server: 256px square is bigger than every place an avatar shows (seat card sm, 名片). */
const SIDE = 256;
/** The server's limit (server/avatars.js put): refuse here first so the user gets a message instead of a silent drop. */
const MAX_RAW = 4 * 1024 * 1024;

/** `/avatar/<id>` — the URL of an uploaded avatar (id = 16 hex, server/avatars.js). */
export function avatarSrc(id) {
  return typeof id === 'string' && /^[0-9a-f]{16}$/.test(id) ? `/avatar/${id}` : '';
}

/** The uploadable image of a picked file: null when it is not an image this browser can decode. */
async function shrink(file) {
  if (!file || !/^image\//.test(file.type || '')) return null;
  if (file.size > MAX_RAW) return null;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = SIDE; canvas.height = SIDE;
  const cx = canvas.getContext('2d');
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIDE, SIDE);
  bitmap.close?.();
  const webp = canvas.toDataURL('image/webp', 0.9);
  const url = webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
  return url.slice(url.indexOf(',') + 1);
}

/**
 * Upload one file as this browser's avatar. Resolves to `{ ok: true, id }` or `{ ok: false, err }`.
 * The caller saves the id (setCustomAvatar) once the server took it.
 * @param {File} file
 * @returns {Promise<{ ok: boolean, id?: string, err?: string }>}
 */
export async function uploadAvatar(file) {
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
  if (typeof id === 'string' && /^[0-9a-f]{16}$/.test(id)) net.send('me.avatar', { id });
}
