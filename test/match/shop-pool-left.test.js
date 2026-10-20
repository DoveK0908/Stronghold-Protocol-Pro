// U07 界面#07 卡池剩余: m.private shop slots carry how many copies of a chess are left in the pool this player draws
// from — the shared pool, a 分卡池 group's pool (m.playerPools) or the own 自选 stock (player/diy.js poolOf). The shop
// card prints it bottom-right; this test pins the server half of the contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';

const independent = { revivalEnabled: false, disableSharedPool: true };
const chessSlots = (ps) => ps.privateView().shop.slots.filter((s) => s && s.kind === 'chess');
// privateView() rebuilds the slot objects, so address the slot through the live shop (id + unsold)
const slotIdx = (ps, id) => ps.shop.slots.findIndex((s) => s && s.id === id && !s.sold);

test('a chess slot reports the copies left in the shared pool; buying one lowers it for the whole table', () => {
  const h = makeMatch({ humans: 2, fake: true, seed: 5 }).start();
  h.toPrep(1);
  const [a, b] = h.m.order;
  for (const ps of [a, b]) {
    for (const s of chessSlots(ps)) {
      assert.equal(s.left, h.m.pool.left(s.id), `${ps.playerId} ${s.id}`);
      assert.equal(s.left, ps.poolOf(s.id).left(s.id));
    }
  }
  const slot = chessSlots(a)[0];
  const before = h.m.pool.left(slot.id);
  a.funds = 999;
  assert.equal(a.buy(slotIdx(a, slot.id)).ok, true);
  assert.equal(h.m.pool.left(slot.id), before - 1, 'the bought copy left the pool');
  const mirror = chessSlots(b).find((s) => s.id === slot.id);
  if (mirror) assert.equal(mirror.left, before - 1, 'the partner sees the same shared count');
});

test('item slots carry no count (the pool accounting is per chess)', () => {
  const h = makeMatch({ humans: 1, fake: true, seed: 9 }).start();
  h.toPrep(1);
  const slots = h.m.order[0].privateView().shop.slots.filter(Boolean);
  assert.ok(slots.some((s) => s.kind !== 'chess'), 'the shop has item slots');
  for (const s of slots) if (s.kind !== 'chess') assert.equal('left' in s, false);
});

test('分卡池 (disableSharedPool): each seat reads its own pool, and one seat buying does not move the other', () => {
  const h = makeMatch({ humans: 2, fake: true, seed: 3, experimental: independent }).start();
  h.toPrep(1);
  const [a, b] = h.m.order;
  assert.equal(h.m.playerPools.size, 2, 'one pool per seat');
  for (const ps of [a, b]) {
    for (const s of chessSlots(ps)) assert.equal(s.left, ps.pool.left(s.id), `${ps.playerId} ${s.id}`);
  }
  const slot = chessSlots(a)[0];
  const id = slot.id;
  const ownBefore = a.pool.left(id);
  const otherBefore = b.pool.left(id);
  a.funds = 999;
  assert.equal(a.buy(slotIdx(a, slot.id)).ok, true);
  assert.equal(a.pool.left(id), ownBefore - 1, 'the buyer’s pool lost the copy');
  assert.equal(b.pool.left(id), otherBefore, 'the partner’s own pool did not');
  const mirror = chessSlots(b).find((s) => s.id === id);
  if (mirror) assert.equal(mirror.left, b.pool.left(id));
});

test('a sold slot keeps reporting the pool count (already displayed cards stay buyable, #498)', () => {
  const h = makeMatch({ humans: 1, fake: true, seed: 11 }).start();
  h.toPrep(1);
  const a = h.m.order[0];
  const slot = chessSlots(a)[0];
  a.funds = 999;
  assert.equal(a.buy(slotIdx(a, slot.id)).ok, true);
  const again = a.privateView().shop.slots.find((s) => s && s.id === slot.id);
  if (again) {
    assert.equal(again.sold, true);
    assert.equal(again.left, a.pool.left(slot.id), 'still the pool count, not a hard 0');
  }
});
