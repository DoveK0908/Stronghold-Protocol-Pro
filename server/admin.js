// Owner-only administrative service. No arbitrary file, SQL, client-pref or game-state access.
import { randomBytes } from 'node:crypto';
import { ownerKey, isTag } from './tags.js';

export const ADMIN_PATH = '/api/admin';
export const ADMIN_LIMITS = Object.freeze({ bodyBytes: 64 * 1024, batch: 50, page: 100,
  sessionMs: 10 * 60 * 1000, requestsPerMinute: 120, loginsPerMinute: 5 });
const COOKIE = 'sp_admin';
const OWNER_RE = /^[0-9a-f]{32}$/;
class AdminError extends Error {
  constructor(error, status = 400) { super(error); this.error = error; this.status = status; }
}
const bad = (error, status) => { throw new AdminError(error, status); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function fields(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) bad('BAD_SCHEMA');
}
function pair(item) {
  if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 12
    || /[\p{Cc}\p{Cf}]/u.test(item.name) || !isTag(item.tag)) bad('BAD_PAIR');
}
function page(list, params) {
  const integer = (key, fallback, max) => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    if (!/^\d{1,9}$/.test(raw) || Number(raw) > max) bad('BAD_PAGE');
    return Number(raw);
  };
  const offset = integer('offset', 0, 100000000), limit = integer('limit', 50, ADMIN_LIMITS.page);
  if (!limit) bad('BAD_PAGE');
  const q = params.get('q') || '';
  if (q.length > 100) bad('BAD_SEARCH');
  const filtered = q ? list.filter(item => JSON.stringify(item).toLowerCase().includes(q.toLowerCase())) : list;
  return { items: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit };
}
async function readJson(req) {
  if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') bad('BAD_CONTENT_TYPE', 415);
  if (Number(req.headers['content-length']) > ADMIN_LIMITS.bodyBytes) { req.resume(); bad('TOO_LARGE', 413); }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > ADMIN_LIMITS.bodyBytes) bad('TOO_LARGE', 413);
    chunks.push(chunk);
  }
  let result;
  try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { bad('BAD_JSON'); }
  if (!object(result)) bad('BAD_SCHEMA');
  return result;
}

/** Inject only whitelisted service objects. Keys/cookies stay in memory and never enter audit/logs. */
export function createAdminApi({ ownerFile, tags, avatars, namecards, board, registry, lobby, now = Date.now,
  origin = process.env.SP_ADMIN_ORIGIN || null }) {
  // Reverse TLS proxies must explicitly pin the browser origin; never trust forwarded headers here.
  if (origin) {
    let parsed;
    try { parsed = new URL(origin); } catch { throw new TypeError('Invalid SP_ADMIN_ORIGIN'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new TypeError('Invalid SP_ADMIN_ORIGIN');
  }
  const sessions = new Map(), rates = new Map(), audit = [];
  let globalWindow = 0, globalCount = 0;
  function spend(ip, login = false) {
    const t = now(), window = Math.floor(t / 60000);
    if (window !== globalWindow) { globalWindow = window; globalCount = 0; }
    if (++globalCount > 2000) bad('RATE_LIMIT', 429);
    for (const [key, value] of rates) if (value.window !== window) rates.delete(key);
    const key = `${login ? 'login:' : 'request:'}${ip}`;
    if (!rates.has(key) && rates.size >= 1024) bad('RATE_LIMIT', 429);
    const value = rates.get(key) || { window, count: 0 };
    rates.set(key, value);
    if (++value.count > (login ? ADMIN_LIMITS.loginsPerMinute : ADMIN_LIMITS.requestsPerMinute)) bad('RATE_LIMIT', 429);
  }
  function boundary(req) {
    if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin'
      && req.headers['sec-fetch-site'] !== 'none') bad('CROSS_ORIGIN', 403);
    const givenOrigin = req.headers.origin;
    if (req.method === 'POST' && !givenOrigin) bad('ORIGIN_REQUIRED', 403);
    const expectedOrigin = origin || `${req.socket?.encrypted ? 'https' : 'http'}://${req.headers.host}`;
    if (givenOrigin && givenOrigin !== expectedOrigin) bad('CROSS_ORIGIN', 403);
  }
  function cookie(req) {
    const values = String(req.headers.cookie || '').split(';').map(v => v.trim()).filter(v => v.startsWith(`${COOKIE}=`));
    return values.length === 1 ? values[0].slice(COOKIE.length + 1) : '';
  }
  function setCookie(res, token, secure, maxAge = 600) {
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=${ADMIN_PATH}; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
  }
  async function auth(req) {
    await ownerFile?.refresh?.();
    for (const [token, session] of sessions) {
      if (now() >= session.expiresAt || !ownerFile?.active?.() || ownerFile.generation?.() !== session.generation) sessions.delete(token);
    }
    const session = sessions.get(cookie(req));
    if (!session) bad('UNAUTHORIZED', 401);
    if (req.method === 'POST' && req.headers['x-sp-csrf'] !== session.csrf) bad('CSRF', 403);
    return session;
  }
  function players() {
    const map = new Map();
    const get = owner => {
      if (!map.has(owner)) map.set(owner, { owner, claims: [], sessions: [], avatar: null, namecard: null });
      return map.get(owner);
    };
    for (const claim of tags?.adminList() || []) get(claim.owner).claims.push(claim);
    for (const [kind, store] of [['avatar', avatars], ['namecard', namecards]]) {
      for (const item of store?.adminList() || []) for (const owner of item.owners) get(owner)[kind] = item.id;
    }
    for (const session of registry?.all() || []) {
      if (!session.uid) continue;
      get(ownerKey(session.uid)).sessions.push({ playerId: session.playerId, name: session.name, tag: session.tag || '',
        connected: session.connected === true, inRoom: !!session.roomCode,
        // Only server-held profile settings, never reconnect credentials, uid, address or match snapshots.
        card: session.card || null, loadout: session.loadout || null, ops: session.ops || null,
        notOwned: session.notOwned || null, diy: session.diy || null, skins: session.skins || null });
    }
    return [...map.values()].sort((a, b) => a.owner.localeCompare(b.owner));
  }
  function deleteMedia(kind, id) {
    const result = (kind === 'avatars' ? avatars : namecards)?.adminDelete(id);
    if (!result?.ok) bad(result?.error || 'UNAVAILABLE', 409);
    lobby?.adminClearMedia(kind, id);
    return { ok: true };
  }
  function checkClaimSnapshot(item) {
    if (!Object.hasOwn(item, 'expectedOwner') && !Object.hasOwn(item, 'expectedAt')) return;
    if (!OWNER_RE.test(item.expectedOwner || '') || !Number.isFinite(item.expectedAt)) bad('BAD_SCHEMA');
    const claim = tags?.adminList().find(value => value.name === item.name && value.tag === item.tag);
    if (!claim || claim.owner !== item.expectedOwner || claim.at !== item.expectedAt) bad('CONFLICT', 409);
  }
  function apply(action, item) {
    if (action === 'claims.release') {
      fields(item, ['name', 'tag', 'expectedOwner', 'expectedAt']); pair(item); checkClaimSnapshot(item);
      const owner = tags?.owner(item.name, item.tag);
      if (owner && players().some(p => p.owner === owner && p.sessions.some(s => s.inRoom))) bad('PLAYER_IN_ROOM', 409);
      if (!tags?.adminRelease(item.name, item.tag)) bad('NOT_FOUND', 404);
    } else if (action === 'claims.reassign') {
      fields(item, ['name', 'tag', 'targetOwner', 'expectedOwner', 'expectedAt']); pair(item); checkClaimSnapshot(item);
      if (!OWNER_RE.test(item.targetOwner || '') || !players().some(p => p.owner === item.targetOwner)) bad('UNKNOWN_OWNER');
      // Do not rewrite a live actor's identity mid-room; it may re-hello after leaving.
      const affected = new Set([item.targetOwner, tags.owner(item.name, item.tag)]);
      if (players().some(p => affected.has(p.owner) && p.sessions.some(s => s.inRoom))) bad('PLAYER_IN_ROOM', 409);
      if (!tags.adminReassign(item.name, item.tag, item.targetOwner)) bad('BAD_PAIR');
    } else if (action === 'avatars.delete' || action === 'namecards.delete') {
      fields(item, ['id']);
      return deleteMedia(action.split('.')[0], item.id);
    } else if (action.startsWith('feedback.')) {
      fields(item, action === 'feedback.status' ? ['id', 'status'] : action === 'feedback.reply' ? ['id', 'body'] : ['id']);
      if (typeof item.id !== 'string' || item.id.length > 100) bad('BAD_ID');
      if (!board) bad('UNAVAILABLE', 503);
      return board.adminModerate(action.slice(9), item);
    } else if (action === 'players.reset') {
      fields(item, ['owner']);
      if (!OWNER_RE.test(item.owner || '')) bad('BAD_OWNER');
      const player = players().find(p => p.owner === item.owner);
      if (!player) bad('NOT_FOUND', 404);
      if (player.sessions.some(s => s.inRoom)) bad('PLAYER_IN_ROOM', 409);
      // Deleting a shared hash would remove another owner's image: refuse rather than over-delete.
      for (const store of [avatars, namecards]) {
        if (store?.adminList().some(media => media.owners.includes(item.owner) && media.owners.length > 1)) bad('SHARED_MEDIA', 409);
      }
      const removed = [];
      for (const [kind, id] of [['avatars', player.avatar], ['namecards', player.namecard]]) if (id) {
        try { deleteMedia(kind, id); removed.push(kind); }
        catch (error) {
          // Filesystem deletion cannot be rolled back. Report partial progress rather than implying atomic reset.
          return { ok: false, error: error instanceof AdminError ? error.error : 'INTERNAL', partial: removed.length > 0, removed };
        }
      }
      for (const claim of player.claims) tags.adminRelease(claim.name, claim.tag);
      for (const session of registry?.all() || []) if (session.uid && ownerKey(session.uid) === item.owner) {
        session.card = null; session.avatarImg = ''; session.namecard = '';
        session.loadout = null; session.ops = null; session.notOwned = null; session.diy = null; session.skins = Object.freeze({});
      }
    } else bad('BAD_ACTION');
    return { ok: true };
  }
  const actions = ['claims.release', 'claims.reassign', 'avatars.delete', 'namecards.delete',
    'feedback.status', 'feedback.reply', 'feedback.delete', 'players.reset'];
  return {
    handles: path => path === ADMIN_PATH || path.startsWith(`${ADMIN_PATH}/`),
    async handle(req, res, path, query = '', ip = '') {
      const send = (status, data) => {
        const body = JSON.stringify(data);
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff', 'Content-Length': Buffer.byteLength(body) });
        res.end(body);
      };
      try {
        boundary(req); spend(ip);
        if (path !== ADMIN_PATH) bad('NOT_FOUND', 404);
        if (!['GET', 'POST'].includes(req.method)) bad('METHOD', 405);
        if (req.method === 'GET') {
          const session = await auth(req), params = new URLSearchParams(query);
          if ([...params.keys()].some(key => !['resource', 'offset', 'limit', 'q'].includes(key))) bad('BAD_QUERY');
          const resource = params.get('resource') || 'session';
          if (resource === 'session') { send(200, { ok: true, csrf: session.csrf, expiresAt: session.expiresAt, limits: ADMIN_LIMITS,
            scope: 'server-held claims, uploads and online profiles only; browser-local preferences and match history are not managed' }); return; }
          const lists = { players, claims: () => tags?.adminList() || [], avatars: () => avatars?.adminList() || [],
            namecards: () => namecards?.adminList() || [], feedback: () => board?.list().posts || [], audit: () => audit.slice().reverse() };
          if (!Object.hasOwn(lists, resource)) bad('BAD_RESOURCE');
          send(200, { ok: true, ...page(lists[resource](), params) }); return;
        }
        const body = await readJson(req);
        if (body.action === 'login') {
          fields(body, ['action', 'key']); spend(ip, true);
          await ownerFile?.refresh?.();
          if (typeof body.key !== 'string' || body.key.length > 1024 || !ownerFile?.active?.()
            || typeof ownerFile.generation?.() !== 'symbol' || !ownerFile.verify(body.key)) bad('UNAUTHORIZED', 401);
          for (const [token, session] of sessions) if (now() >= session.expiresAt) sessions.delete(token);
          if (sessions.size >= 128) bad('SESSION_LIMIT', 429);
          sessions.delete(cookie(req));
          const token = randomBytes(32).toString('hex'), csrf = randomBytes(24).toString('hex'), expiresAt = now() + ADMIN_LIMITS.sessionMs;
          // Bind the service's opaque reload epoch; never retain the plaintext owner key.
          sessions.set(token, { generation: ownerFile.generation(), csrf, expiresAt });
          setCookie(res, token, req.headers.origin.startsWith('https:'));
          send(200, { ok: true, csrf, expiresAt }); return;
        }
        await auth(req);
        if (body.action === 'logout') {
          fields(body, ['action']); sessions.delete(cookie(req)); setCookie(res, '', req.headers.origin.startsWith('https:'), 0);
          send(200, { ok: true }); return;
        }
        fields(body, ['action', 'confirm', 'items']);
        if (!actions.includes(body.action)) bad('BAD_ACTION');
        if (body.confirm !== 'CONFIRM') bad('CONFIRM_REQUIRED');
        if (!Array.isArray(body.items) || !body.items.length || body.items.length > ADMIN_LIMITS.batch) bad('BAD_BATCH');
        const results = body.items.map((item, index) => {
          try { return { index, ...apply(body.action, item) }; }
          catch (error) { return { index, ok: false, error: error instanceof AdminError || typeof error?.error === 'string' ? error.error : 'INTERNAL' }; }
        });
        audit.push({ at: now(), action: body.action, count: results.length, succeeded: results.filter(r => r.ok).length });
        if (audit.length > 500) audit.shift();
        send(200, { ok: true, results });
      } catch (error) {
        send(error instanceof AdminError ? error.status : 500, { ok: false, error: error instanceof AdminError ? error.error : 'INTERNAL' });
      }
    },
    close() { sessions.clear(); rates.clear(); },
  };
}
