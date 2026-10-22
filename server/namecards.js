// 玩家自传名片底图（维护者需求 2026-10-22：名片也能自行上传，可裁剪/缩放/挪位置）。
//
// The same machinery as 自传头像 (server/avatars.js) with its own directory, index and size cap: `state/namecards/…`,
// `state/namecards.json`, one picture per browser (ownerKey), `id` = sha256 前 16 位, PNG/JPEG/WEBP magic bytes only.
// A room card names one as `custom:<id>` (ui/namecards.js), and `/namecard/<id>` serves the file (server/http/static.js).

import { createAvatarStore, MAX_BYTES as AVATAR_MAX_BYTES } from './avatars.js';
import { join } from 'node:path';

/** A name card is drawn large behind a name plate: allow 4× an avatar's bytes (a 720×1440 WebP is ~120–250KB). */
export const MAX_BYTES = Math.max(AVATAR_MAX_BYTES, 400 * 1024);

/** `SP_NAMECARDS_DIR`, or `state/namecards` under the working directory (`''` = memory only). */
export function defaultDir() {
  const env = process.env.SP_NAMECARDS_DIR;
  if (env === '') return join(process.cwd(), 'state', 'namecards-memory');
  return env || join(process.cwd(), 'state', 'namecards');
}

/** `SP_NAMECARDS_INDEX`, or `state/namecards.json` (`''` = memory only). */
export function defaultIndexFile() {
  const env = process.env.SP_NAMECARDS_INDEX;
  if (env === '') return null;
  return env || join(process.cwd(), 'state', 'namecards.json');
}

/** @param {{ dir?: string, indexFile?: string, log?: object, now?: () => number }} [opts] */
export function createNamecardStore({ dir = defaultDir(), indexFile = defaultIndexFile(), log = console, now } = {}) {
  return createAvatarStore({ dir, indexFile, log, now, maxBytes: MAX_BYTES });
}
