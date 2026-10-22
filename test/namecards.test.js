// 自传名片底图的存储（server/namecards.js）：和自传头像同一套机器，独立的目录 / 索引 / 上限。
// 为什么单独测：名片底图比头像大（400KB 上限），如果沿用了头像的 200KB 就会把正常的名片图拒掉。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNamecardStore, MAX_BYTES } from '../server/namecards.js';

/** A minimal valid PNG (1×1) — the store only sniffs the magic bytes. */
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300050001a5f645400000000049454e44ae426082', 'hex');

test('the name card store takes a picture bigger than an avatar and keeps one per browser', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-namecard-'));
  try {
    const store = createNamecardStore({ dir, indexFile: null, log: { warn() {}, error() {} } });
    assert.equal(MAX_BYTES, 400 * 1024);
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_BYTES - PNG.length - 8)]);
    assert.ok(big.length <= MAX_BYTES);
    const a = store.put(big, 'owner-a');
    assert.equal(a.ok, true);
    assert.ok(existsSync(join(dir, `${a.id}.png`)));
    assert.equal(store.owns(a.id, 'owner-a'), true);
    assert.equal(store.owns(a.id, 'owner-b'), false);
    // over the cap is refused, not written
    const tooBig = Buffer.concat([PNG, Buffer.alloc(MAX_BYTES)]);
    const b = store.put(tooBig, 'owner-a');
    assert.deepEqual(b, { ok: false, err: 'too-large' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
