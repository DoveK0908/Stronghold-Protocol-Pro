import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { ELITE_RECRUITS, eliteCard } from '../shared/eliteAi.js';
import { seatPick, seatIllust, seatPortrait, seatOperator } from '../public/js/ui/seatArt.js';

test('each elite uses its corresponding E2 avatar and illustration, ignoring stale player art', () => {
  const m = { chars: Object.fromEntries(ELITE_RECRUITS.map(r => [r.char, {
    avatar: `/${r.id}/e1.png`, avatarE2: `/${r.id}/e2.png`, portrait: `/${r.id}/e1.webp`, portraitE2: `/${r.id}/e2.webp`, illust: `/${r.id}/illust.webp`,
  }])) };
  const ctx = { m, pool: [], byChar: new Map(), myId: 'human', myCard: ELITE_RECRUITS[0].char };
  for (const r of ELITE_RECRUITS) {
    const seat = { playerId: r.id, isBot: true, botPersona: r.id, card: { charId: 'wrong', look: 'skin' } };
    const card = eliteCard(seat);
    assert.equal(card.avatar, r.char);
    assert.equal(card.avatarLook, '');
    assert.equal(seatPick(seat, ctx).charId, r.char);
    assert.equal(seatOperator(seat, ctx).chess.charId, r.char);
    assert.equal(seatPortrait(seat, ctx), `/${r.id}/e2.webp`);
    assert.equal(seatIllust(seat, ctx), `/${r.id}/illust.webp`);
  }
  const ordinary = { playerId: 'ordinary', isBot: true };
  assert.equal(eliteCard(ordinary), null);
  assert.equal(seatPortrait(ordinary, ctx), null);
  assert.equal(seatIllust(ordinary, ctx), null);
  assert.equal(eliteCard({ isBot: false, botPersona: 'zumama' }), null);
});

test('vendored policy and compatibility bytes retain the released hashes', () => {
  for (const mount of ['arturia', 'lavinia', 'aiAddons/zumama']) {
    const dir = new URL(`../server/match/${mount}/`, import.meta.url);
    const metadata = JSON.parse(fs.readFileSync(new URL('upstream.json', dir)));
    for (const [file, expected] of Object.entries(metadata.files)) {
      if (!file.startsWith('policy/') && !file.startsWith('compat/') && file !== 'runtime.js') continue;
      assert.equal(createHash('sha256').update(fs.readFileSync(new URL(file, dir))).digest('hex'), expected, `${mount}/${file}`);
    }
    for (const [file, expected] of Object.entries(metadata.sharedRuntime.files)) {
      const bytes = fs.readFileSync(new URL(`../server/match/aiCompute/${file}`, import.meta.url));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `shared forecast runtime: ${file}`);
    }
  }
});
