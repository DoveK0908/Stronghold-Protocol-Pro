// The lobby's anonymous feedback board (the maintainer's request of 2026-10-26): players post feedback without a name,
// discuss each other's posts, and the maintainer — after typing the board password — replies and moves a post between
// the four columns 未读 / 无计划 / 已计划 / 已完成.
//
// WHY A FILE OF ITS OWN: the board is the one piece of this server's state that is not a match, a claim or a plugin, and
// it is small (a few hundred posts). It lives in `state/feedback-board.json` beside the name-tag claims (server/tags.js),
// written atomically on a short delay, so a restart keeps the board and a lost write costs one post's edit at worst.
//
// ANONYMITY: a post carries no player id, name or address — the server never stores the address it came from. What it does
// keep is a SHA-256 of the random secret handed to the browser that wrote the post, so that browser alone can edit or
// withdraw it later; nothing in the public payload can be traced back to a player.
//
// The maintainer password is checked HERE and never ships to the client: the client sends what was typed, this module
// compares it to `SP_FEEDBACK_PASSWORD` (default 09081314) and returns an in-memory session token, which expires.

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FEEDBACK_LIMITS, FEEDBACK_PATH, FEEDBACK_STATUSES } from '../shared/feedback.js';

export { FEEDBACK_LIMITS, FEEDBACK_PATH, FEEDBACK_STATUSES };

/** `SP_FEEDBACK_FILE`, or `state/feedback-board.json` under the working directory (`''` keeps the board in memory). */
export function defaultFile() {
  const env = process.env.SP_FEEDBACK_FILE;
  if (env === '') return null;
  return env || join(process.cwd(), 'state', 'feedback-board.json');
}

/** `SP_FEEDBACK_PASSWORD`, or the maintainer's password of 2026-10-26. */
export function defaultPassword() {
  return process.env.SP_FEEDBACK_PASSWORD || '09081314';
}

/** A refusal the HTTP layer turns into `{ ok: false, error, detail }` with `status`. */
export class FeedbackError extends Error {
  /** @param {string} error @param {number} status @param {Record<string, any>} [detail] */
  constructor(error, status, detail = {}) {
    super(error);
    this.name = 'FeedbackError';
    this.error = error;
    this.status = status;
    this.detail = detail;
  }
}

/** One line of text: trimmed, no control characters, at most `max` characters. @param {unknown} v @param {number} max */
function text(v, max) {
  if (typeof v !== 'string') throw new FeedbackError('BAD_TEXT', 400, { field: 'text' });
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (!s) throw new FeedbackError('EMPTY', 400, { field: 'text' });
  if (s.length > max) throw new FeedbackError('TOO_LONG', 400, { max });
  return s;
}

/** @param {string} secret */
const secretKey = (secret) => createHash('sha256').update(String(secret)).digest('hex');

/** The public shape of a post: no secret, no address, nothing about who wrote it. @param {any} post */
function publicPost(post) {
  return {
    id: post.id,
    status: post.status,
    title: post.title,
    body: post.body,
    t: post.t,
    u: post.u,
    replies: post.replies.map((r) => ({ t: r.t, body: r.body, maintainer: r.m === true })),
  };
}

/**
 * The board.
 * @param {{ file?: string | null, log?: object, now?: () => number, password?: string | null,
 *           random?: (n: number) => Buffer }} [opts] `file` null: memory only (tests); `password` null: no maintainer
 *   session can be opened (a board whose password is unset is read/write for players but never moderated)
 */
export function createFeedbackBoard({ file = defaultFile(), log = console, now = Date.now, password = defaultPassword(), random = randomBytes } = {}) {
  /** @type {Array<any>} newest last */
  let posts = [];
  /** @type {Map<string, number>} session token → when it expires */
  const sessions = new Map();
  /** @type {Map<string, number[]>} client address → the write times still inside the window */
  const writes = new Map();
  let timer = null;
  let warned = false;

  if (file) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      const list = Array.isArray(raw?.posts) ? raw.posts : [];
      posts = list.filter((p) => p && typeof p.id === 'string' && typeof p.title === 'string'
        && typeof p.body === 'string' && FEEDBACK_STATUSES.includes(p.status)
        && Array.isArray(p.replies)).map((p) => ({
        id: p.id,
        status: p.status,
        title: String(p.title).slice(0, FEEDBACK_LIMITS.title),
        body: String(p.body).slice(0, FEEDBACK_LIMITS.body),
        t: Number(p.t) || 0,
        u: Number(p.u) || Number(p.t) || 0,
        key: typeof p.key === 'string' ? p.key : '',
        replies: p.replies.filter((r) => r && typeof r.body === 'string').map((r) => ({
          t: Number(r.t) || 0,
          body: String(r.body).slice(0, FEEDBACK_LIMITS.reply),
          ...(r.m === true ? { m: true } : {}),
        })),
      }));
    } catch (e) {
      if (e && e.code !== 'ENOENT') log.warn?.(`[feedback] ${file}: ${e.message}`);
    }
  }

  const flush = () => {
    timer = null;
    if (!file) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, posts }));
      renameSync(tmp, file);
    } catch (e) {
      if (!warned) { warned = true; log.warn?.(`[feedback] cannot write ${file}: ${e.message}`); }
    }
  };
  const schedule = () => {
    if (!file || timer) return;
    timer = setTimeout(flush, 250);
    timer.unref?.();
  };

  /** @param {any} post */
  const save = (post) => {
    post.u = now();
    const i = posts.indexOf(post);
    if (i >= 0) posts[i] = post;
    schedule();
  };

  /** @param {string} id */
  const find = (id) => posts.find((p) => p.id === id) || null;

  /** The write gate: every post / reply / edit counts against one address's minute. @param {string} ip */
  const spend = (ip) => {
    const t = now();
    const list = (writes.get(ip) || []).filter((at) => t - at < FEEDBACK_LIMITS.writeWindowMs);
    if (list.length >= FEEDBACK_LIMITS.writesPerMinute) throw new FeedbackError('RATE_LIMIT', 429, { retryAfter: 60 });
    list.push(t);
    writes.set(ip, list);
    // the map is small (one entry per address that wrote in the last minute); drop stale entries on the way
    if (writes.size > 512) for (const [k, v] of writes) if (!v.some((at) => t - at < FEEDBACK_LIMITS.writeWindowMs)) writes.delete(k);
  };

  /** The sessions prune themselves on use: a token past its expiry is a refusal, not a memory leak. */
  const sessionLive = (token) => {
    const t = now();
    const until = sessions.get(String(token));
    if (!until || t >= until) { if (until) sessions.delete(String(token)); return false; }
    return true;
  };

  const board = {
    file,
    /** The public board: newest first, as the panel draws it. */
    list() {
      return { ok: true, posts: posts.slice().reverse().map(publicPost), limits: { ...FEEDBACK_LIMITS } };
    },
    /**
     * A new post. The returned `secret` is the only proof of authorship: the browser keeps it, the board keeps its hash.
     * @param {{ title?: unknown, body?: unknown }} input @param {string} ip
     */
    create(input, ip) {
      spend(ip);
      if (posts.length >= FEEDBACK_LIMITS.posts) throw new FeedbackError('BOARD_FULL', 409, { max: FEEDBACK_LIMITS.posts });
      const title = text(input?.title, FEEDBACK_LIMITS.title);
      const body = text(input?.body, FEEDBACK_LIMITS.body);
      const secret = random(18).toString('hex');
      const t = now();
      const post = { id: `f${t.toString(36)}${random(3).toString('hex')}`, status: 'open', title, body, t, u: t, key: secretKey(secret), replies: [] };
      posts.push(post);
      schedule();
      return { ok: true, post: publicPost(post), secret };
    },
    /**
     * A discussion entry under a post — the author, the maintainer and every other player all take this path; only the
     * maintainer's replies are marked.
     * @param {string} id @param {{ body?: unknown, secret?: string, token?: string }} input @param {string} ip
     */
    reply(id, input, ip) {
      spend(ip);
      const post = find(id);
      if (!post) throw new FeedbackError('NOT_FOUND', 404, {});
      const body = text(input?.body, FEEDBACK_LIMITS.reply);
      const maintainer = sessionLive(input?.token);
      post.replies.push({ t: now(), body, ...(maintainer ? { m: true } : {}) });
      save(post);
      return { ok: true, post: publicPost(post) };
    },
    /** Rewrite a post this browser wrote — the secret it was handed at creation, nothing else. */
    edit(id, input, { secret } = {}) {
      const post = find(id);
      if (!post) throw new FeedbackError('NOT_FOUND', 404, {});
      if (!post.key || post.key !== secretKey(String(secret || ''))) throw new FeedbackError('NOT_YOURS', 403, {});
      if (input?.title !== undefined) post.title = text(input.title, FEEDBACK_LIMITS.title);
      if (input?.body !== undefined) post.body = text(input.body, FEEDBACK_LIMITS.body);
      save(post);
      return { ok: true, post: publicPost(post) };
    },
    /** Withdraw a post: its author (by secret) or the maintainer clearing the board — gone for everyone. */
    withdraw(id, { secret, token } = {}) {
      const i = posts.findIndex((p) => p.id === id);
      if (i < 0) throw new FeedbackError('NOT_FOUND', 404, {});
      const post = posts[i];
      if (!sessionLive(token) && (!post.key || post.key !== secretKey(String(secret || '')))) throw new FeedbackError('NOT_YOURS', 403, {});
      posts.splice(i, 1);
      schedule();
      return { ok: true };
    },
    /** The maintainer's column change: one of FEEDBACK_STATUSES. */
    setStatus(id, status, { token } = {}) {
      if (!sessionLive(token)) throw new FeedbackError('NOT_MAINTAINER', 403, {});
      if (!FEEDBACK_STATUSES.includes(status)) throw new FeedbackError('BAD_STATUS', 400, { statuses: [...FEEDBACK_STATUSES] });
      const post = find(id);
      if (!post) throw new FeedbackError('NOT_FOUND', 404, {});
      post.status = status;
      save(post);
      return { ok: true, post: publicPost(post) };
    },
    /**
     * The maintainer's password → a session token. Nothing about the password comes back; a wrong one is refused the
     * same way whether it was close or not, and the refusal costs a write slot so guessing is bounded.
     * @param {unknown} given @param {string} ip
     */
    login(given, ip) {
      spend(ip);
      if (!password || typeof given !== 'string' || given !== password) throw new FeedbackError('BAD_PASSWORD', 403, {});
      const token = random(24).toString('hex');
      sessions.set(token, now() + FEEDBACK_LIMITS.sessionMs);
      return { ok: true, token, expiresAt: now() + FEEDBACK_LIMITS.sessionMs };
    },
    /** Does this session still hold? (the panel asks on open, so a stale tab shows the player view again) */
    session(token) {
      return { ok: true, maintainer: sessionLive(token) };
    },
    /** Write now (tests, shutdown). */
    flush,
    /** The raw entries (tests). */
    get posts() { return posts; },
    /** Forget expired sessions and clients (tests). */
    prune() {
      const t = now();
      for (const [k, until] of sessions) if (t >= until) sessions.delete(k);
      for (const [k, v] of writes) if (!v.some((at) => t - at < FEEDBACK_LIMITS.writeWindowMs)) writes.delete(k);
    },
  };

  return board;
}

/** The one path the board answers. */

/**
 * The board's HTTP surface: one GET (the whole board) and one POST (every action, `{ action, … }`), so a page never needs
 * a second route and every write passes the same body limit, the same JSON check and the same rate limit.
 * Cross-site writes are refused by construction: the POST is JSON-only (a cross-origin `fetch` with this content type
 * needs a preflight the server never answers) and no CORS header is ever set.
 * @param {{ board: ReturnType<typeof createFeedbackBoard>, log?: object }} opts
 */
export function createFeedbackApi({ board, log = console }) {
  /** @param {import('node:http').IncomingMessage} req @param {number} limit */
  const readJson = async (req, limit) => {
    const len = Number(req.headers['content-length']);
    if (Number.isFinite(len) && len > limit) { req.resume(); throw new FeedbackError('TOO_LARGE', 413, {}); }
    const chunks = [];
    let n = 0;
    for await (const chunk of req) {
      n += chunk.length;
      if (n > limit) throw new FeedbackError('TOO_LARGE', 413, {});
      chunks.push(chunk);
    }
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new FeedbackError('BAD_JSON', 400, {}); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FeedbackError('BAD_JSON', 400, {});
    return value;
  };

  const send = (res, status, body) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  };

  return {
    /** @param {string} rawPath */
    handles: (rawPath) => rawPath === FEEDBACK_PATH,
    /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {string} rawPath @param {string} [_query] @param {string} [ip] */
    async handle(req, res, rawPath, _query, ip = '') {
      try {
        if (rawPath !== FEEDBACK_PATH) throw new FeedbackError('NOT_FOUND', 404, {});
        if (req.method === 'GET' || req.method === 'HEAD') { send(res, 200, board.list()); return; }
        if (req.method !== 'POST') { res.setHeader('Allow', 'GET, HEAD, POST'); throw new FeedbackError('METHOD', 405, {}); }
        const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (type !== 'application/json') throw new FeedbackError('BAD_CONTENT_TYPE', 415, {});
        const body = await readJson(req, FEEDBACK_LIMITS.bodyBytes);
        const action = String(body.action || '');
        switch (action) {
          case 'create': send(res, 200, board.create(body, ip)); return;
          case 'reply': send(res, 200, board.reply(String(body.id || ''), body, ip)); return;
          case 'edit': send(res, 200, board.edit(String(body.id || ''), body, { secret: body.secret })); return;
          case 'withdraw': send(res, 200, board.withdraw(String(body.id || ''), { secret: body.secret, token: body.token })); return;
          case 'status': send(res, 200, board.setStatus(String(body.id || ''), body.status, { token: body.token })); return;
          case 'login': send(res, 200, board.login(body.password, ip)); return;
          case 'session': send(res, 200, board.session(body.token)); return;
          default: throw new FeedbackError('BAD_ACTION', 400, {});
        }
      } catch (e) {
        const err = e instanceof FeedbackError ? e : new FeedbackError('INTERNAL', 500, {});
        if (!(e instanceof FeedbackError)) log.error?.('[feedback] request failed', e);
        send(res, err.status, { ok: false, error: err.error, ...err.detail });
      }
    },
  };
}
