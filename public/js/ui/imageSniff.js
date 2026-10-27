// 动图判定（只看文件头字节）：GIF、APNG（首个 IDAT 前有 acTL）、动态 WebP（VP8X 动画位）、AVIF 序列（avis brand）。
//
// 两个调用点：ui/lobbyMedia.js 判玩家自己的大厅背景（本地 IndexedDB，不上传）；ui/customNamecard.js 判名片/头像
// （要传给其他玩家，走 server/uploads.js 的 HTTP 通道）。判错的后果不同——大厅那边是「该动的不动」，
// 名片那边是「把动图当静止图裁成一帧」——所以只认字节，不认扩展名。

/**
 * @param {Uint8Array | null | undefined} b 文件前若干字节（建议 >= 4 KB；PNG 需要读到第一个 IDAT）
 */
export function isAnimatedImage(b) {
  if (!b || b.length < 12) return false;
  const str = (o, n) => String.fromCharCode(...b.subarray(o, o + n));
  const u32 = (o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  if (str(0, 3) === 'GIF') return true;
  if (b[0] === 0x89 && str(1, 3) === 'PNG') {
    let o = 8;
    while (o + 8 <= b.length) { // loop-cap: one pass per PNG chunk header within the sniffed bytes (each pass moves >= 12 bytes)
      const type = str(o + 4, 4);
      if (type === 'acTL') return true;
      if (type === 'IDAT' || type === 'IEND') return false;
      o += 12 + u32(o);
    }
    return false;
  }
  if (str(0, 4) === 'RIFF' && str(8, 4) === 'WEBP') return str(12, 4) === 'VP8X' && b.length > 20 && (b[20] & 0x02) !== 0;
  if (str(4, 4) === 'ftyp') {
    const end = Math.min(u32(0), b.length);
    for (let o = 8; o + 4 <= end; o += 4) if (o !== 12 && str(o, 4) === 'avis') return true; // brands; 12 is the minor version
  }
  return false;
}
