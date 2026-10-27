// 动态位图（名片/头像）的上传通道：一次性 ticket + 一条只收位图的 POST。
//
// 为什么需要它：所有上传原本走 WS 帧，而 `WS_MAX_PAYLOAD` 是 64 KB——base64 后只剩约 48 KB 的图。
// 静止图够用，动图（GIF / 动态 WebP / APNG）远远不够。于是给「大一点的一次性上传」开一条 HTTP 口子：
// 客户端先用一条 WS 消息换 ticket，再 POST 原始字节，ticket 当场作废。
//
// 安全：路径、方法、ticket、content-type、体积、魔数五道门都在这里；ticket 只对签发它的 owner 有效，
// 过期即废，重放即废。收下的字节交给已有的 avatar/namecard store（落盘、索引、驱逐都由它管）。

import { createHash, randomBytes } from 'node:crypto';

export const UPLOAD_PREFIX = '/upload/';
/** 动图/视频的实际上限（静态图仍然走 WS，受 64 KB 帧限制）。 */
export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
/** ticket 有效期：够客户端把 blob 读出来立刻 POST。 */
export const TICKET_TTL_MS = 60_000;

const KINDS = new Set(['namecard', 'avatar']);
const TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/apng', 'png'],
]);

/** PNG 的 APNG 变体：魔数同 PNG，多一个 acTL 块——由 store 的魔数嗅探按 png 存，浏览器照样动。 */
function isApng(buf) {
  if (buf.length < 20 || buf.readUInt32BE(0) !== 0x89504e47) return false;
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    off += 12 + len;
    if (len > buf.length) return false;
  }
  return false;
}

/** 一次性上传凭证：`issue(owner)` 拿 ticket，`claim(ticket, owner?)` 取走并作废。 */
export function createUploadTickets({ now = Date.now, ttlMs = TICKET_TTL_MS } = {}) {
  /** @type {Map<string, { owner: string, at: number }>} */
  const live = new Map();
  const sweep = (t) => {
    for (const [k, v] of live) if (t - v.at > ttlMs) live.delete(k);
  };
  return {
    issue(owner) {
      const t = now();
      sweep(t);
      const ticket = randomBytes(16).toString('hex');
      live.set(ticket, { owner: String(owner ?? ''), at: t });
      return { ticket, expiresIn: ttlMs };
    },
    /** @returns {{ owner: string } | null} 一次性：取到即删。 */
    claim(ticket) {
      if (typeof ticket !== 'string' || !/^[0-9a-f]{32}$/.test(ticket)) return null;
      const hit = live.get(ticket);
      if (!hit) return null;
      live.delete(ticket);
      if (now() - hit.at > ttlMs) return null;
      return { owner: hit.owner };
    },
    get size() { return live.size; },
  };
}

/** 逐块读 body，超上限立刻中断（不把整包吃进内存）。 */
async function readBody(req, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) {
      const err = new Error('too-large');
      err.code = 'TOO_LARGE';
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

function send(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' });
  res.end(body);
}

/**
 * @param {object} o
 * @param {ReturnType<typeof createUploadTickets>} o.tickets
 * @param {object} o.namecards  createNamecardStore() 的返回值
 * @param {object} o.avatars    createAvatarStore() 的返回值
 * @param {number} [o.maxBytes]
 * @param {object} o.log
 */
export function createAnimatedUpload({ tickets, namecards, avatars, maxBytes = UPLOAD_MAX_BYTES, log }) {
  const storeOf = (kind) => (kind === 'avatar' ? avatars : namecards);

  const handles = (rawPath) => {
    if (!rawPath.startsWith(UPLOAD_PREFIX)) return false;
    return KINDS.has(rawPath.slice(UPLOAD_PREFIX.length).replace(/\/+$/, ''));
  };

  async function handle(req, res, rawPath, query) {
    const kind = rawPath.slice(UPLOAD_PREFIX.length).replace(/\/+$/, '');
    if (!KINDS.has(kind)) { send(res, 404, { err: 'not-found' }); return true; }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' });
      send(res, 405, { err: 'method' });
      return true;
    }
    const ticket = new URLSearchParams(query || '').get('ticket') || '';
    const claimed = tickets.claim(ticket);
    if (!claimed) { send(res, 403, { err: 'ticket' }); return true; }

    const type = String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!TYPES.has(type)) { send(res, 415, { err: 'type' }); return true; }

    const store = storeOf(kind);
    const limit = Math.min(maxBytes, store.maxBytes || maxBytes);
    let buf;
    try {
      buf = await readBody(req, limit);
    } catch (e) {
      if (e?.code === 'TOO_LARGE') { send(res, 413, { err: 'too-large' }); return true; }
      throw e;
    }
    if (!buf.length) { send(res, 400, { err: 'empty' }); return true; }
    // 魔数必须和 content-type 对得上，且 APNG 要认出 acTL（否则按静止 png 存也能显示，只是不动）
    const declared = TYPES.get(type);
    const gif = buf.length > 6 && buf.toString('latin1', 0, 6) === 'GIF89a';
    const png = buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;
    const jpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
    const webp = buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
    const magicOk = (declared === 'gif' && gif) || (declared === 'jpg' && jpg) || (declared === 'webp' && webp)
      || ((declared === 'png') && (png || isApng(buf)));
    if (!magicOk) { send(res, 415, { err: 'bad-bytes' }); return true; }

    const out = store.put(buf, claimed.owner);
    if (!out?.ok) {
      const code = out?.err === 'too-large' ? 413 : 415;
      send(res, code, { err: out?.err || 'bad-type' });
      return true;
    }
    log?.info?.(`[upload] ${kind} ${buf.length}B ${createHash('sha256').update(buf).digest('hex').slice(0, 8)}`);
    send(res, 201, { id: out.id });
    return true;
  }

  return { handles, handle };
}
