#!/usr/bin/env node
// WHY: the client's skin atlases are not all authored the same way. Some pages are premultiplied alpha (every channel
// <= alpha), others are straight alpha. pixi-spine only tells PIXI that a page is premultiplied when the atlas says
// `pma: true`; without it PIXI premultiplies the straight assumption on upload, and a page that already was
// premultiplied gets multiplied twice — its soft edges (the shading around an operator's eyes) turn into dark rings.
//
// This tool samples each skin page, decides the kind from the pixels and makes the atlas say so. Idempotent: it only
// inserts `pma: true` after `repeat: none` when the page is premultiplied and the line is missing, and never removes.
//
// USAGE
//   node tools/mark-skin-pma.mjs            # report only
//   node tools/mark-skin-pma.mjs --write    # edit the atlases in public/assets/skins/*/{front,back}/*.atlas
//
// A page is counted as premultiplied when it has enough semi-transparent pixels to sample (>= 500) and not a single
// one whose colour exceeds its alpha (the arithmetic identity of a premultiplied pixel; straight-alpha pages almost
// always have some, e.g. a soft white highlight at alpha 200 with value 240).
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'public', 'assets');
const ROOTS = [
  { dir: join(ASSETS, 'skins'), label: 'skins' },
  { dir: join(ASSETS, 'spine', 'op'), label: 'operators' },
  { dir: join(ASSETS, 'spine', 'token'), label: 'tokens' },
];
const write = process.argv.includes('--write');

/** A PNG decoded to RGBA8 (colour type 6; the skin pages are all RGBA8888) — no dependency, just zlib + the filters. */
function readPng(file) {
  const buf = readFileSync(file);
  let at = 8, width = 0, height = 0;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at); const type = buf.toString('ascii', at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      const depth = body[8], color = body[9];
      if (depth !== 8 || color !== 6) throw new Error(`unsupported PNG ${file}: depth ${depth} colour ${color}`);
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  return { width, height, data: out };
}

/** @returns {{ semi: number, over: number }} */
function samplePng(file) {
  const { width, height, data } = readPng(file);
  const step = Math.max(1, Math.floor(Math.min(width, height) / 160));
  let semi = 0, over = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      if (a >= 250) continue;
      semi++;
      if (Math.max(data[i], data[i + 1], data[i + 2]) > a + 2) over++;
    }
  }
  return { semi, over };
}

/** The atlas of one skin page, with `pma: true` when its image is premultiplied. */
function checkAtlas(atlasFile) {
  const text = readFileSync(atlasFile, 'utf8');
  const lines = text.split('\n');
  const page = (lines.find((l) => /\.(png|webp)\s*$/i.test(l.trim())) || '').trim();
  const img = page ? join(dirname(atlasFile), page) : null;
  if (!img) return { atlasFile, skip: 'no page line' };
  try { if (!statSync(img).isFile()) return { atlasFile, skip: 'page is a directory' }; } catch { return { atlasFile, skip: 'no image' }; }
  const { semi, over } = samplePng(img);
  const pma = semi >= 500 && over === 0;
  const declared = lines.some((l) => /^pma:\s*true\s*$/.test(l.trim()));
  return { atlasFile, pma, declared, semi, over, page };
}

const out = [];
for (const root of ROOTS) {
  let entries;
  try { entries = readdirSync(root.dir); } catch { continue; }
  for (const name of entries) {
    for (const dir of ['front', 'back', '']) {
      const d = dir ? join(root.dir, name, dir) : join(root.dir, name);
      let names;
      try { names = readdirSync(d); } catch { continue; }
      for (const n of names.filter((x) => x.endsWith('.atlas'))) {
        const r = checkAtlas(join(d, n));
        r.root = root.label;
        out.push(r);
      }
    }
  }
}

const need = out.filter((r) => r.pma && !r.declared);
const straight = out.filter((r) => !r.pma);
const flagged = out.filter((r) => !r.declared && !r.pma && r.semi >= 500 && r.over <= 2);

let changed = 0;
if (write) {
  for (const r of need) {
    const text = readFileSync(r.atlasFile, 'utf8');
    const lines = text.split('\n');
    if (lines.some((l) => /^pma:\s*true\s*$/.test(l.trim()))) continue;
    const at = lines.findIndex((l) => /^repeat:\s*none\s*$/.test(l.trim()));
    if (at < 0) continue;
    lines.splice(at + 1, 0, 'pma: true');
    writeFileSync(r.atlasFile, lines.join('\n'), 'utf8');
    changed++;
  }
}

console.log(`[skin-pma] atlases ${out.length}, premultiplied pages ${out.filter((r) => r.pma).length}, missing marker ${need.length}, straight ${straight.length}`);
if (write) console.log(`[skin-pma] wrote ${changed} atlas files`);
for (const r of need.slice(0, 10)) console.log(`  missing: ${r.atlasFile.replace(ROOT + '\\', '')}`);
if (flagged.length) {
  console.log(`[skin-pma] borderline pages (no colour above alpha but unsampled): ${flagged.length}`);
  for (const r of flagged.slice(0, 5)) console.log(`  borderline: ${basename(r.atlasFile)} semi ${r.semi} over ${r.over}`);
}
