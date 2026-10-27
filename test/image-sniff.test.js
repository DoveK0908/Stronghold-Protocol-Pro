// 动图判定只看文件头（public/js/ui/imageSniff.js）：GIF / APNG / 动态 WebP。
// 名片与头像的动图上传、大厅背景的动图都由它分岔，判错一边会把动图裁成一帧、另一边会让静止图静止。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAnimatedImage } from '../public/js/ui/imageSniff.js';

// typed array 不会被 Array#flat 展平，先统一成普通数组
const bytes = (...parts) => Uint8Array.from(parts.flatMap((p) => Array.from(p)));
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

// GIF89a + 一点体
const gif = bytes(ascii('GIF89a'), [0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x3b]);
// PNG 签名 + IHDR + IDAT：静止 PNG
function pngChunk(type, body = []) {
  const len = body.length;
  return bytes([0, 0, 0, len], ascii(type), body, [0, 0, 0, 0]);
}
const staticPng = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], pngChunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6]), pngChunk('IDAT', [1, 2, 3]), pngChunk('IEND'));
// 同样的 PNG，但 IHDR 后面有 acTL（APNG）
const apng = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], pngChunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6]), pngChunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]), pngChunk('IDAT', [1, 2, 3]), pngChunk('IEND'));
// WebP：RIFF + 8 字节长度 + WEBP + VP8X + 4 字节 chunk 长度 + 1 字节 flags
const webp = (flags) => bytes(ascii('RIFF'), [0, 0, 0, 0], ascii('WEBP'), ascii('VP8X'), [0, 0, 0, 0], [flags], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

test('GIF 一律算动图', () => {
  assert.equal(isAnimatedImage(gif), true);
});

test('静止 PNG 不是动图；带 acTL 的 APNG 是', () => {
  assert.equal(isAnimatedImage(staticPng), false);
  assert.equal(isAnimatedImage(apng), true);
});

test('WebP 只看 VP8X 的动画位', () => {
  assert.equal(isAnimatedImage(webp(0x02)), true);
  assert.equal(isAnimatedImage(webp(0x00)), false);
  assert.equal(isAnimatedImage(webp(0x10)), false);
});

test('太短 / 空 / 别的格式都不算', () => {
  assert.equal(isAnimatedImage(null), false);
  assert.equal(isAnimatedImage(new Uint8Array(0)), false);
  assert.equal(isAnimatedImage(new Uint8Array(8)), false);
  assert.equal(isAnimatedImage(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), false);
});
