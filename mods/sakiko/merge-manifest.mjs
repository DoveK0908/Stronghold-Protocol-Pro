#!/usr/bin/env node
/**
 * sakiko overlay — keep the committed asset manifest as the base.
 *
 * WHY THIS EXISTS
 *   `data/assets.json` is a *generated* file, but it is also checked in, and the committed copy
 *   describes trees this machine cannot rebuild:
 *     - `skins` (271 entries) come from `tools/prepare-operator-skins.mjs`, a separate pipeline
 *       that was never run here; `fetch-assets` can only retain skins whose files are already on
 *       disk (`retainInstalledSkins`), so a rebuild on this machine drops the whole tree.
 *     - `audio.voiceByLang.en` (182 operators) is only fetched with `--voice-all`; the default
 *       `voiceLang` is `cn`, so a rebuild drops the English dub tree too.
 *   Running `node tools/fetch-assets.mjs --offline --allow-shrink` to pick up 丰川祥子 therefore
 *   silently deleted both trees — ~650 KB of `skins` and the whole `en` voice map. That is what
 *   broke `test/render/spine-first-pose.test.js` (it reads `manifest.skins.char_332_archet_sale_14`).
 *
 * WHAT IT DOES
 *   Deep-unions the committed manifest (base) with the freshly generated one (add):
 *     - object  -> per-key union; keys only in base survive (skins, voiceByLang.en),
 *                  keys only in add are added (the operator, `audio.sfx.proj`).
 *     - array   -> the longer one wins.
 *     - scalar  -> `add` wins (regenerated is authoritative for anything it did produce).
 *   Then it recomputes `hash` and `stats` from the merged body. `stats.files` / `stats.bytes`
 *   keep the *regenerated* values on purpose: they describe what is actually on disk here,
 *   while the restored `skins` count describes manifest entries.
 *
 * USAGE (from the repository root, after running fetch-assets)
 *   node mods/sakiko/merge-manifest.mjs            # merge and write data/assets.json
 *   node mods/sakiko/merge-manifest.mjs --check    # report the diff, write nothing
 *   node mods/sakiko/merge-manifest.mjs --base <file>   # use another base instead of HEAD
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentHash, MANIFEST_VERSION } from '../../tools/assets/manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const MANIFEST = join(ROOT, 'data', 'assets.json');

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const baseArg = argv.indexOf('--base');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Deep union: base keeps what only it has, add wins wherever it produced something. */
function union(base, add) {
  if (add === undefined) return base;
  if (base === undefined) return add;
  if (Array.isArray(base) && Array.isArray(add)) return add.length >= base.length ? add : base;
  if (isObj(base) && isObj(add)) {
    const out = { ...base };
    for (const k of Object.keys(add)) out[k] = union(base[k], add[k]);
    return out;
  }
  return add;
}

/** Copy of fetch-assets.mjs `countStats` (it is not exported from a safe-to-import module). */
function countStats(m, bytes, files) {
  const vals = (o) => Object.values(o || {});
  const spines = new Set();
  for (const c of vals(m.chars)) for (const s of vals(c.spine)) spines.add(s.skel);
  for (const e of vals(m.enemies)) if (e.spine) spines.add(e.spine.skel);
  for (const t of vals(m.tokens)) if (t.spine) spines.add(t.spine.skel);
  return {
    files,
    bytes,
    chars: Object.keys(m.chars || {}).length,
    charsWithBack: vals(m.chars).filter((c) => c.spine?.back).length,
    enemies: Object.keys(m.enemies || {}).length,
    enemiesWithSpine: vals(m.enemies).filter((e) => e.spine).length,
    tokens: Object.keys(m.tokens || {}).length,
    tokensWithSpine: vals(m.tokens).filter((t) => t.spine).length,
    spineModels: spines.size,
    bonds: Object.keys(m.bonds || {}).length,
    items: Object.keys(m.items || {}).length,
    bands: Object.keys(m.bands || {}).length,
    skills: Object.keys(m.skills || {}).length,
    modules: Object.keys(m.modules || {}).length,
    ui: Object.keys(m.ui || {}).length,
    sfxUnits: Object.keys(m.audio?.sfx?.units || {}).length,
    voiceChars: Object.keys(m.audio?.voice || {}).length,
    voiceJpChars: Object.keys(m.audio?.voiceJp || {}).length,
  };
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

// --- inputs ---------------------------------------------------------------------------------
const add = readJson(MANIFEST);
let base;
if (baseArg !== -1) {
  base = readJson(resolve(argv[baseArg + 1]));
} else {
  base = JSON.parse(execFileSync('git', ['show', 'HEAD:data/assets.json'], { cwd: ROOT, maxBuffer: 1 << 28 }).toString('utf8'));
}

// --- merge ----------------------------------------------------------------------------------
const { version, hash: _h, stats: _s, generator: _g, ...baseBody } = base;
const { version: _v2, hash: _h2, stats: _s2, generator: _g2, ...addBody } = add;
const body = union(baseBody, addBody);
const skinsCount = Object.keys(body.skins || {}).length;

const manifest = {
  version: MANIFEST_VERSION,
  hash: contentHash(body),
  generator: add.generator || base.generator,
  stats: { ...countStats(body, add.stats.bytes, add.stats.files), ...(skinsCount ? { skins: skinsCount } : {}) },
  ...body,
};

// --- report ---------------------------------------------------------------------------------
const keys = [...new Set([...Object.keys(base), ...Object.keys(add), ...Object.keys(manifest)])].sort();
const n = (o, k) => {
  const v = o[k];
  if (v === undefined) return '-';
  if (v && typeof v === 'object') return String(Object.keys(v).length);
  return String(v);
};
console.log('key'.padEnd(16), 'HEAD'.padStart(9), 'now'.padStart(9), 'merged'.padStart(9));
for (const k of keys) {
  if (k === 'stats') continue;
  console.log(k.padEnd(16), n(base, k).padStart(9), n(add, k).padStart(9), n(manifest, k).padStart(9));
}
console.log('\nHEAD stats   =', JSON.stringify(base.stats));
console.log('now  stats   =', JSON.stringify(add.stats));
console.log('merged stats =', JSON.stringify(manifest.stats));

const restored = [];
for (const [label, a, b, c] of [
  ['skins', base.skins, add.skins, manifest.skins],
  ['audio.voiceByLang.en', base.audio?.voiceByLang?.en, add.audio?.voiceByLang?.en, manifest.audio?.voiceByLang?.en],
]) {
  const na = a ? Object.keys(a).length : 0, nb = b ? Object.keys(b).length : 0, nc = c ? Object.keys(c).length : 0;
  if (nc > nb) restored.push(`${label}: ${nb} -> ${nc} (HEAD ${na})`);
}
console.log('\nrestored by the merge:');
for (const r of restored.length ? restored : ['(nothing — the regenerated manifest already had them)']) console.log('  -', r);

if (CHECK) {
  console.log('\n--check: nothing written.');
  process.exit(0);
}
const tmp = `${MANIFEST}.tmp`;
writeFileSync(tmp, `${JSON.stringify(manifest, null, 1)}\n`);
renameSync(tmp, MANIFEST);
console.log(`\nwrote ${MANIFEST} (${JSON.stringify(manifest).length} B)`);
