// 名字#四位 (the owner's decision of 2026-10-20, 界面#10): a player shows `名字#1234` instead of `Doctor #NNNN`.
// The four digits are chosen by the player (initially random) and **claimed**: two players may share a name, and two
// may share a tag, but the same `name#tag` pair belongs to whoever claimed it first. The claim is kept on this server
// (a JSON file) so it survives restarts, and is bound to the browser that claimed it (`uid`, a random id kept in
// localStorage) so a returning browser gets its pair back while another one is refused.
//
// WHAT IS SAVED: {"名字#1234": { u: "<hash of uid>", t: <ms> }} — the hash, never the uid itself. A claim whose owner
// has not used it for CLAIM_TTL_MS is dropped the next time the file is written, so a lost browser does not reserve a
// pair forever.
//
// The file is written lazily (a few times a second at most) and never blocks a hello: a write failure is logged once
// and the claims stay in memory for this process.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** A claim nobody used for this long may be taken by somebody else. */
export const CLAIM_TTL_MS = 180 * 24 * 3600 * 1000;
/** The digits of a tag: exactly four of them. */
export const TAG_RE = /^\d{4}$/;
const WRITE_MS = 250;

/** @param {unknown} tag */
export const isTag = (tag) => typeof tag === 'string' && TAG_RE.test(tag);

/** A stable, non-reversible owner key from the browser's uid. @param {string} uid */
export function ownerKey(uid) {
  return createHash('sha256').update(String(uid)).digest('hex').slice(0, 32);
}

/** `名字#1234` — the pair, exactly as saved. @param {string} name @param {string} tag */
export const pairKey = (name, tag) => `${name}#${tag}`;

/**
 * The claim registry.
 * @param {{ file?: string | null, log?: object, now?: () => number }} [opts] `file` null: keep it in memory only
 */
export function createTagRegistry({ file = defaultFile(), log = console, now = Date.now } = {}) {
  /** @type {Map<string, { u: string, t: number }>} */
  const claims = new Map();
  let timer = null;
  let warned = false;

  if (file) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      for (const [key, val] of Object.entries(raw || {})) {
        if (typeof key !== 'string' || !val || typeof val !== 'object') continue;
        if (typeof val.u !== 'string') continue;
        claims.set(key, { u: val.u, t: Number(val.t) || 0 });
      }
    } catch (e) {
      if (e && e.code !== 'ENOENT') log.warn?.(`[tags] ${file}: ${e.message}`);
    }
  }

  const prune = (t) => {
    for (const [key, val] of claims) if (t - val.t > CLAIM_TTL_MS) claims.delete(key);
  };

  const flush = () => {
    timer = null;
    if (!file) return;
    const t = now();
    prune(t);
    const out = {};
    for (const [key, val] of claims) out[key] = val;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(out));
      renameSync(tmp, file);
    } catch (e) {
      if (!warned) { warned = true; log.warn?.(`[tags] cannot write ${file}: ${e.message}`); }
    }
  };
  const schedule = () => {
    if (!file || timer) return;
    timer = setTimeout(flush, WRITE_MS);
    timer.unref?.();
  };

  return {
    file,
    /** @param {string} name @param {string} tag */
    owner(name, tag) { return claims.get(pairKey(name, tag))?.u ?? null; },
    /**
     * Claim `name#tag` for `uid`.
     * @returns {{ ok: true } | { ok: false, reason: 'taken' }}
     */
    claim(name, tag, uid) {
      const key = pairKey(name, tag);
      const u = ownerKey(uid);
      const held = claims.get(key);
      if (held && held.u !== u && now() - held.t <= CLAIM_TTL_MS) return { ok: false, reason: 'taken' };
      claims.set(key, { u, t: now() });
      schedule();
      return { ok: true };
    },
    /** Give up a pair this uid holds (a rename moved the player elsewhere). */
    release(name, tag, uid) {
      const key = pairKey(name, tag);
      const held = claims.get(key);
      if (!held || held.u !== ownerKey(uid)) return false;
      claims.delete(key);
      schedule();
      return true;
    },
    /** Drop every pair this uid holds except `name#tag` (one browser owns one pair, 界面#10). */
    releaseOthers(uid, name, tag) {
      const u = ownerKey(uid);
      const keep = pairKey(name, tag);
      let dropped = 0;
      for (const [key, val] of claims) if (val.u === u && key !== keep) { claims.delete(key); dropped++; }
      if (dropped) schedule();
      return dropped;
    },
    /** The first free tag for `name` in [1000, 10000), random, falling back to a scan. */
    pick(name, rand = Math.random) {
      for (let i = 0; i < 24; i++) {
        const tag = String(1000 + Math.floor(rand() * 9000));
        if (!claims.has(pairKey(name, tag))) return tag;
      }
      for (let n = 1000; n < 10000; n++) {
        const tag = String(n);
        if (!claims.has(pairKey(name, tag))) return tag;
      }
      return null;
    },
    /** Write now (tests, shutdown). */
    flush,
    /** How many claims are held (tests). */
    get size() { return claims.size; },
  };
}

/** `SP_TAGS_FILE`, or `state/name-tags.json` under the working directory. */
export function defaultFile() {
  const env = process.env.SP_TAGS_FILE;
  if (env === '') return null;
  return env || join(process.cwd(), 'state', 'name-tags.json');
}
