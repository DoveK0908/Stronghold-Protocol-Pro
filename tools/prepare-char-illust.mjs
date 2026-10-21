// Point data/assets.json's chars[].illust at the E2 illustrations tools/local-extract/chararts.py extracted.
// The pictures themselves live under public/assets/char/illust (git-ignored, per-machine); the manifest only carries
// the URL, docs/ASSETS.md "chars[].illust".
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentHash } from './assets/manifest.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'data/assets.json');
const illustDir = join(root, 'public/assets/char/illust');
const URL_PREFIX = '/assets/char/illust/';

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const chars = manifest.chars || {};
const onDisk = new Set(existsSync(illustDir)
  ? readdirSync(illustDir).filter((n) => n.endsWith('.webp')).map((n) => n.slice(0, -5))
  : []);

let added = 0, kept = 0, dropped = 0;
for (const [charId, rec] of Object.entries(chars)) {
  if (!rec || typeof rec !== 'object') continue;
  if (onDisk.has(charId)) {
    const url = `${URL_PREFIX}${charId}.webp`;
    if (rec.illust === url) kept += 1; else { rec.illust = url; added += 1; }
  } else if (rec.illust) { delete rec.illust; dropped += 1; }
}

const body = { ...manifest };
delete body.hash;
body.hash = contentHash(body);
// 清单在仓库里是单行紧凑 JSON，保持同样序列化方式，别让一次重写把 diff 撑成十几万行
await writeFile(manifestPath, `${JSON.stringify(body)}
`, 'utf8');
console.log(`[char-illust] set ${added}, already ${kept}, removed ${dropped}, on disk ${onDisk.size}, hash ${body.hash}`);
