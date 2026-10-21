// 自传头像的存储（server/avatars.js）与大厅的 me.avatar 入口。
//
// 为什么单独测：这层决定「房间里别人看到的图」是不是玩家自己上传的那张 —— 只认 PNG/JPEG/WEBP 的魔数、
// 一个浏览器只留一张（ownerKey）、换图时旧图没人引用就删掉、重启后还能按 owner 认领。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAvatarStore, sniffImage, isAvatarId, MAX_BYTES } from '../server/avatars.js';

/** A minimal valid PNG (1×1, transparent) — the magic bytes are what the store sniffs. */
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300050001a5f645400000000049454e44ae426082', 'hex');
const JPG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffdb004300', 'hex');
const WEBP = Buffer.from('52494646240000005745425056503820', 'hex');
const TEXT = Buffer.from('this is not an image at all, really', 'utf8');

const tmp = () => mkdtempSync(join(tmpdir(), 'sp-avatar-'));

test('sniffImage recognizes the three formats and refuses everything else', () => {
  assert.equal(sniffImage(PNG), 'png');
  assert.equal(sniffImage(JPG), 'jpg');
  assert.equal(sniffImage(WEBP), 'webp');
  assert.equal(sniffImage(TEXT), null);
  assert.equal(sniffImage(Buffer.alloc(4)), null);
  assert.equal(isAvatarId('0123456789abcdef'), true);
  assert.equal(isAvatarId('../etc/passwd'), false);
  assert.equal(isAvatarId('0123456789ABCDEF'), false);
});

test('put writes <id>.<ext> under the dir and reports the id', () => {
  const dir = tmp();
  try {
    const store = createAvatarStore({ dir, indexFile: null, log: { warn() {}, error() {} } });
    const res = store.put(PNG, 'owner-a');
    assert.equal(res.ok, true);
    assert.match(res.id, /^[0-9a-f]{16}$/);
    assert.ok(existsSync(join(dir, `${res.id}.png`)));
    assert.equal(store.owns(res.id, 'owner-a'), true);
    assert.equal(store.owns(res.id, 'owner-b'), false);
    assert.equal(store.idOf('owner-a'), res.id);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('put refuses non-images and oversized uploads without writing anything', () => {
  const dir = tmp();
  try {
    const store = createAvatarStore({ dir, indexFile: null, log: { warn() {}, error() {} } });
    assert.deepEqual(store.put(TEXT, 'o1'), { ok: false, err: 'bad-type' });
    assert.deepEqual(store.put(PNG, 'o1'), store.put(PNG, 'o1')); // the same bytes: one file, same id
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_BYTES)]);
    assert.deepEqual(store.put(big, 'o2'), { ok: false, err: 'too-large' });
    assert.equal(readdirSync(dir).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('one browser keeps one avatar: a new upload replaces (and drops) the old file', () => {
  const dir = tmp();
  try {
    const store = createAvatarStore({ dir, indexFile: null, log: { warn() {}, error() {} } });
    const a = store.put(PNG, 'owner-a');
    assert.equal(a.ok, true);
    const b = store.put(JPG, 'owner-a');
    assert.equal(b.ok, true);
    assert.notEqual(a.id, b.id);
    assert.equal(store.owns(a.id, 'owner-a'), false, 'the replaced file is no longer this owner\'s');
    assert.equal(store.get(a.id), null, 'and it is gone when nobody else points at it');
    assert.deepEqual(readdirSync(dir), [`${b.id}.jpg`]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a restart keeps both the files and the owner claim (index file)', () => {
  const dir = tmp();
  const indexFile = join(dir, 'avatars.json');
  try {
    const first = createAvatarStore({ dir, indexFile, log: { warn() {}, error() {} } });
    const res = first.put(WEBP, 'owner-a');
    assert.equal(res.ok, true);
    first.flush?.();
    // the index is written lazily: force it, then read it back with a fresh store
    writeFileSync(indexFile, JSON.stringify({ items: { [res.id]: { ext: 'webp', bytes: WEBP.length, at: 1, owner: 'owner-a' } }, byOwner: { 'owner-a': res.id } }));
    const again = createAvatarStore({ dir, indexFile, log: { warn() {}, error() {} } });
    assert.equal(again.owns(res.id, 'owner-a'), true);
    assert.equal(again.idOf('owner-a'), res.id);
    assert.equal(again.get(res.id)?.ext, 'webp');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
