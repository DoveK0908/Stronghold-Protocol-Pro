import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { damageOperatorRecord, normalizeResult } from '../../public/js/ui/gameLogic/result.js';
import { buildRecord, recordToResult, normalizeRecord } from '../../public/js/ui/stats.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../../data/${name}.json`, import.meta.url), 'utf8'));
const data = { chess: load('chess'), backups: load('backups') };

test('Boss DIY resolves backup-only operator instead of the selection slot; old records use their own lineup', () => {
  const slot = Object.values(data.chess).find((c) => c.isDiy && !c.isGolden);
  const charId = 'char_4182_oblvns';
  const op = { defId: slot.chessId, charId };
  assert.equal(damageOperatorRecord(op, [], data).name, data.backups.units[charId].name);
  assert.equal(damageOperatorRecord(op, [], data).charId, charId);
  const pick = { charId, skillIndex: 0, uniEquipId: null };
  const lineup = [{ id: slot.chessId, diy: pick }];
  assert.equal(damageOperatorRecord({ defId: slot.chessId }, lineup, data).charId, charId);
  assert.notEqual(damageOperatorRecord({ defId: slot.chessId }, [], data)?.charId, charId,
    'never infer another owner’s missing selection');
});

test('match history round-trip retains each avatar and Boss operator identity', () => {
  const cards = [{ charId: 'char_002_amiya', avatar: 'char_002_amiya', avatarLook: '', avatarImg: '0123456789abcdef' },
    { charId: 'char_290_vigna', avatar: 'char_290_vigna', avatarLook: 'e1' }];
  const res = { victory: true, roundsPassed: 15, seed: 123,
    players: cards.map((card, seat) => ({ playerId: `p${seat}`, seat, name: `P${seat}`, card, alive: true, lineup: [], stats: {} })),
    bossDamage: { boss: { round: 15, owners: [{ playerId: 'p0', total: 7, operators: [
      { key: 'op', uid: 1, defId: 'slot', charId: 'char_4182_oblvns', damage: 7 },
    ] }] } } };
  const rec = buildRecord(res, { myId: 'p0' });
  assert.ok(rec);
  const restored = recordToResult(normalizeRecord(JSON.parse(JSON.stringify(rec))));
  const result = normalizeResult(restored);
  assert.equal(result.players[0].card.avatarImg, cards[0].avatarImg);
  assert.equal(result.players[1].card.avatar, cards[1].avatar);
  assert.equal(restored.bossDamage.boss.owners[0].operators[0].charId, 'char_4182_oblvns');
});
