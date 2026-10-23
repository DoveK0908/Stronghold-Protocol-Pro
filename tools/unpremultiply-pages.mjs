#!/usr/bin/env node
// 把「预乘 alpha」的 Spine 页面转回直通 alpha（RGB = RGB / (A/255)，A>0），并从旁边 atlas 里删掉 `pma:` 行。
//
// 背景：pixi-spine 4.0.6 在 PIXI.Assets 这条加载路径上**从不**把 atlas 的 `pma: true` 传到 baseTexture
// （`l.pma=()=>{h.pma=r[1]=="true"}` 只写在 atlas 的 page 包装对象上，`h.pma && (f.alphaMode = PMA)` 那段在
// PIXI.Assets 不走的加载器里），实测 alphaMode 恒为 1 = PREMULTIPLY_ON_UPLOAD。于是**预乘页面会被再乘一次
// alpha**：所有半透明边缘被压暗，眼睛周围那圈半透明的眼影/睫毛就变成灰黑色的「黑眼圈」。
// 客户端 skinpack 的 Spine 页面恰好是预乘的（`max(RGB) <= A` 对全部半透明像素成立），而我们按字节直发、
// atlas 不写 pma —— 所以补 `pma: true` 无用（见上），唯一有效的做法是把页面除回直通 alpha。
// 注意**不能一刀切**：这批页面里直通与预乘混着（实测 553 页里 233 预乘 / 320 直通，分布是干净的双峰），
// 对本来就是直通的页面做除法会把亮部烧白，所以逐页分类，只处理预乘页。
//
// 用法：
//   node tools/unpremultiply-pages.mjs [--write] [public/assets/skins]
// 默认只报告；--write 才改盘（PNG 重编码 + atlas 删 pma）。
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
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

// Premultiplied data cannot have max(RGB) > A: alpha was multiplied into the colour, so every channel is ≤ A. Straight
// data hits it constantly on soft edges. The survey of the shipped skin pages is cleanly bimodal (517 pages with a
// negative mean(max(RGB) − A) against 29 above it), so a small allowance only has to absorb rounding.
function classify({ width, height, data }) {
  const step = Math.max(1, Math.floor(Math.min(width, height) / 200));
  let semi = 0, over = 0, over8 = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4, a = data[i + 3];
      if (a >= 250 || a === 0) continue;
      semi++;
      const m = Math.max(data[i], data[i + 1], data[i + 2]);
      if (m > a) over++;
      if (m > a + 8) over8++;
    }
  }
  return { semi, over, over8, premultiplied: semi >= 200 && over / semi <= 0.01 && over8 / semi <= 0.002 };
}

// tools/local-extract/skinspines.py used to rewrite line 0 of a client atlas, but a client atlas begins with a blank
// line, so the shipped file starts with two page names: ours and the client's `<skeleton>#<n>.png`. pixi-spine reads
// the second as a region, which also drops the page's `size:`/`format:`/`filter:` fields. Drop the stray line.
function strayPageLine(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length < 3) return -1;
  const bare = (l) => !!l.trim() && !l.includes(':') && !/^\s/.test(l) && /\.(png|webp)\s*$/i.test(l);
  return bare(lines[0]) && bare(lines[1]) ? 1 : -1;
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

let pages = 0, premul = 0, straight = 0, strayFixed = 0, stripped = 0;
const report = [];
for (const atlas of atlases) {
  const dir = dirname(atlas);
  const text = readFileSync(atlas, 'utf8');
  const lines = text.split('\n');
  const at = strayPageLine(text);
  if (at >= 0) {
    strayFixed++;
    if (write) { lines.splice(at, 1); writeFileSync(atlas, lines.join('\n')); }
  }
  const pageNames = lines.filter((l) => /\.(png|webp)\s*$/i.test(l)).map((l) => l.trim()).filter((n) => existsSync(join(dir, n)));
  for (const pn of pageNames) {
    if (!pn.toLowerCase().endsWith('.png')) continue;
    pages++;
    const file = join(dir, pn);
    let img, stat;
    try { img = readPng(file); stat = classify(img); } catch (e) { console.log('skip', file, e.message); continue; }
    if (!stat.premultiplied) { straight++; continue; }
    premul++;
    report.push(`${pn} semi=${stat.semi} over=${stat.over} over8=${stat.over8}`);
    if (write) { unpremultiply(img); writePng(file, img); }
  }
  if (write && lines.some((l) => /^\s*pma\s*:/i.test(l))) {
    const out = lines.filter((l) => !/^\s*pma\s*:/i.test(l)).join('\n');
    if (out !== text) { writeFileSync(atlas, out); stripped++; }
  }
}
console.log(`[unpremultiply] atlases ${atlases.length}, stray page lines ${strayFixed}, pages ${pages}, premultiplied ${premul}, straight ${straight}, pma lines stripped ${stripped}${write ? ' (written)' : ' (dry run: pass --write)'}`);
for (const r of report.slice(0, 12)) console.log('  premul', r);
if (report.length > 12) console.log(`  … ${report.length - 12} more`);
