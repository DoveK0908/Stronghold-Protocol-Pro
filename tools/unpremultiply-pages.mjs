#!/usr/bin/env node
// 把「预乘 alpha」的 Spine 页面转回直通 alpha（RGB = RGB / (A/255)，A>0），并从旁边 atlas 里删掉 `pma:` 行。
//
// 背景：本地提取器（tools/local-extract/extract.py）现在写直通页、atlas 不写 pma（官方 PR #668 的口径）。
// 但皮肤页是从 PRTS 的 arknights-skin-plugin 产物下载的，那批页面是旧提取器写的：RGB 被 min(RGB, A) 钳过
// （预乘），颜色被压暗（眼睛周围发黑）。钳制不可逆，这里做的是近似还原：除以归一化 alpha。
//
// 用法：
//   node tools/unpremultiply-pages.mjs [--write] [public/assets/skins]
// 默认只报告；--write 才改盘（PNG 重编码 + atlas 删 pma）。
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { inflateSync, deflateSync } from 'node:zlib';

const write = process.argv.includes('--write');
const roots = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!roots.length) roots.push('public/assets/skins');

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
};

function readPng(file) {
  const buf = readFileSync(file);
  let off = 8, width = 0, height = 0, color = 0, depth = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; color = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || color !== 6) throw new Error(`${file}: depth ${depth} colour ${color} (only RGBA8)`);
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = width * bpp, out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, data: out };
}

function writePng(file, { width, height, data }) {
  const stride = width * 4, raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) { raw[y * (stride + 1)] = 0; data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]));
}

function unpremultiply(img) {
  const d = img.data; let changed = 0;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (!a) continue;
    if (a === 255) continue;
    const scale = 255 / a;
    for (let k = 0; k < 3; k++) { const v = Math.min(255, Math.round(d[i + k] * scale)); if (v !== d[i + k]) changed++; d[i + k] = v; }
  }
  return changed;
}

const atlases = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (name.endsWith('.atlas')) atlases.push(p);
  }
}
for (const r of roots) if (existsSync(r)) walk(r);

let pages = 0, touched = 0, stripped = 0;
for (const atlas of atlases) {
  const dir = dirname(atlas);
  const text = readFileSync(atlas, 'utf8');
  const lines = text.split('\n');
  const pageNames = lines.filter((l) => /\.(png|webp)\s*$/i.test(l)).map((l) => l.trim()).filter((n) => existsSync(join(dir, n)));
  for (const pn of pageNames) {
    if (!pn.toLowerCase().endsWith('.png')) continue;
    pages++;
    const file = join(dir, pn);
    let img, changed;
    try { img = readPng(file); changed = unpremultiply(img); } catch (e) { console.log('skip', file, e.message); continue; }
    if (!changed) continue;
    touched++;
    if (write) writePng(file, img);
  }
  if (write && lines.some((l) => /^\s*pma\s*:/i.test(l))) {
    const out = lines.filter((l) => !/^\s*pma\s*:/i.test(l)).join('\n');
    if (out !== text) { writeFileSync(atlas, out); stripped++; }
  }
}
console.log(`[unpremultiply] atlases ${atlases.length}, png pages ${pages}, changed ${touched}, pma lines stripped ${stripped}${write ? ' (written)' : ' (dry run: pass --write)'}`);
