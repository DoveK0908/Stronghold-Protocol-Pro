// 玩家自传头像（维护者需求 2026-10-21）：房间里共享的方形头像。
//
// WHAT IS SAVED: state/avatars/<id>.<png|jpg|webp> + state/avatars.json — { items: { <id>: { ext, bytes, at, owner } },
// byOwner: { <ownerKey>: id } }. `id` is sha256(bytes) 前 16 位，所以同一张图重复上传只占一份；`owner` 是 tags.js 的
// ownerKey（浏览器 uid 的哈希），一个浏览器只留一张，重传会替换旧图（旧图没人引用时删掉）。
//
// 校验：只收 PNG / JPEG / WEBP 的魔数（不信任 Content-Type），单张 ≤ MAX_BYTES；总量超上限按最久未用淘汰。
// 写文件与索引都是懒写 + rename（同 tags.js），失败只记一次日志、内存态继续可用。

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** One upload's decoded size cap (a 256px square webp is ~30KB; this leaves room for PNG). */
export const MAX_BYTES = 200 * 1024;
/** How many files the server keeps before evicting the least recently used. */
export const MAX_FILES = 400;
/** Total bytes kept. */
export const MAX_TOTAL = 48 * 1024 * 1024;
const WRITE_MS = 300;
const ID_RE = /^[0-9a-f]{16}$/;

/** @param {unknown} id */
export const isAvatarId = (id) => typeof id === 'string' && ID_RE.test(id);

/**
 * The image type from its magic bytes — null when it is not a PNG/JPEG/WEBP.
 * @param {Uint8Array} buf
 * @returns {'png'|'jpg'|'webp'|null}
 */
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
    && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';
  // GIF（含动图）：名片/头像要能动就靠它（HTTP 上传通道 server/uploads.js）。
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38
    && (buf[4] === 0x39 || buf[4] === 0x37) && buf[5] === 0x61) return 'gif';
  return null;
}

/**
 * @param {{ dir?: string, indexFile?: string, log?: object, now?: () => number,
 *           maxFiles?: number, maxTotal?: number }} [opts]
 */
export function createAvatarStore({ dir = defaultDir(), indexFile = defaultIndexFile(), log = console,
  now = Date.now, maxFiles = MAX_FILES, maxTotal = MAX_TOTAL, maxBytes = MAX_BYTES } = {}) {
  /** @type {Map<string, { ext: string, bytes: number, at: number, owner: string }>} */
  const items = new Map();
  /** @type {Map<string, string>} owner -> id */
  const byOwner = new Map();
  let timer = null;
  let warned = false;
  let seq = 0;

  if (indexFile && existsSync(indexFile)) {
    try {
      const raw = JSON.parse(readFileSync(indexFile, 'utf8'));
      for (const [id, it] of Object.entries(raw?.items || {})) {
        if (!isAvatarId(id) || !it || typeof it !== 'object') continue;
        const ext = it.ext === 'png' || it.ext === 'jpg' || it.ext === 'webp' || it.ext === 'gif' ? it.ext : null;
        if (!ext) continue;
        items.set(id, { ext, bytes: Number(it.bytes) || 0, at: Number(it.at) || 0, owner: String(it.owner || '') });
      }
      for (const [owner, id] of Object.entries(raw?.byOwner || {})) {
        if (typeof owner === 'string' && isAvatarId(id) && items.has(id)) byOwner.set(owner, id);
      }
    } catch (e) {
      if (e && e.code !== 'ENOENT') log.warn?.(`[avatars] ${indexFile}: ${e.message}`);
    }
  }

  const warnOnce = (msg) => { if (!warned) { warned = true; log.warn?.(msg); } };
  const fileOf = (id, ext) => join(dir, `${id}.${ext}`);

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!indexFile) return;
    try {
      mkdirSync(dirname(indexFile), { recursive: true });
      mkdirSync(dir, { recursive: true });
      const out = { items: {}, byOwner: {} };
      for (const [id, it] of items) out.items[id] = it;
      for (const [owner, id] of byOwner) out.byOwner[owner] = id;
      const tmp = `${indexFile}.${process.pid}.${++seq}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(out)}\n`);
      renameSync(tmp, indexFile);
    } catch (e) { warnOnce(`[avatars] write ${indexFile}: ${e?.message || e}`); }
  };
  const schedule = () => {
    if (!indexFile || timer) return;
    timer = setTimeout(flush, WRITE_MS);
    timer.unref?.();
  };

  const totalBytes = () => { let n = 0; for (const it of items.values()) n += it.bytes; return n; };

  const evict = () => {
    const order = [...items.entries()].sort((a, b) => a[1].at - b[1].at);
    while (order.length && (items.size > maxFiles || totalBytes() > maxTotal)) {
      const [id, it] = order.shift();
      items.delete(id);
      for (const [owner, held] of byOwner) if (held === id) byOwner.delete(owner);
      try { rmSync(fileOf(id, it.ext), { force: true }); } catch { /* best effort */ }
    }
  };

  return {
    /**
     * Store one uploaded image. Replaces the owner's previous avatar.
     * @param {Uint8Array} buf @param {string} owner
     * @returns {{ ok: true, id: string } | { ok: false, err: 'too-large'|'bad-type' }}
     */
    put(buf, owner) {
      if (!buf || buf.length > maxBytes) return { ok: false, err: 'too-large' };
      const ext = sniffImage(buf);
      if (!ext) return { ok: false, err: 'bad-type' };
      const id = createHash('sha256').update(buf).digest('hex').slice(0, 16);
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(fileOf(id, ext), buf);
      } catch (e) {
        warnOnce(`[avatars] write ${fileOf(id, ext)}: ${e?.message || e}`);
        return { ok: false, err: 'bad-type' };
      }
      const prev = byOwner.get(owner);
      items.set(id, { ext, bytes: buf.length, at: now(), owner });
      byOwner.set(owner, id);
      if (prev && prev !== id) {
        const it = items.get(prev);
        if (it && ![...byOwner.values()].includes(prev)) {
          items.delete(prev);
          try { rmSync(fileOf(prev, it.ext), { force: true }); } catch { /* best effort */ }
        }
      }
      evict();
      schedule();
      return { ok: true, id };
    },
    /** @param {string} id @param {string} owner */
    owns(id, owner) { return isAvatarId(id) && byOwner.get(owner) === id; },
    /** @param {string} id */
    get(id) {
      if (!isAvatarId(id)) return null;
      const it = items.get(id);
      return it ? { id, ...it, path: fileOf(id, it.ext) } : null;
    },
    /** @param {string} owner */
    idOf(owner) { return byOwner.get(owner) || null; },
    flush,
    get size() { return items.size; },
  };
}

/** `SP_AVATARS_DIR`, or `state/avatars` under the working directory (`''` = memory only). */
export function defaultDir() {
  const env = process.env.SP_AVATARS_DIR;
  if (env === '') return join(process.cwd(), 'state', 'avatars-memory');
  return env || join(process.cwd(), 'state', 'avatars');
}

/** `SP_AVATARS_INDEX`, or `state/avatars.json` (`''` = memory only). */
export function defaultIndexFile() {
  const env = process.env.SP_AVATARS_INDEX;
  if (env === '') return null;
  return env || join(process.cwd(), 'state', 'avatars.json');
}
