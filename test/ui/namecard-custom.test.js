// 自传名片底图 (ui/namecards.js `custom:<id>`): the id resolves to a /namecard/<id> picture and nothing else does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { namecardOf, namecardSrc, DEFAULT_NAMECARD } from '../../public/js/ui/namecards.js';

const M = { ui: {} };

test('namecardOf: custom:<16 hex> is a card, anything else custom is not', () => {
  const c = namecardOf('custom:0123456789abcdef');
  assert.equal(c.kind, 'custom');
  assert.equal(namecardSrc(c, M), '/namecard/0123456789abcdef');
  assert.equal(namecardOf('custom:xyz'), null);
  assert.equal(namecardOf('custom:0123456789ABCDEF'), null);
  assert.equal(namecardOf('loading:abyss').kind, 'loading');
  assert.equal(namecardOf(''), null);
});

test('the default card is still a preset', () => {
  assert.equal(namecardOf(DEFAULT_NAMECARD).kind, 'loading');
});

test('the name card crop is wide (the plate is 600 / 186), never a portrait frame', async () => {
  const { NAMECARD_ASPECT } = await import('../../public/js/ui/customNamecard.js');
  assert.ok(Math.abs(NAMECARD_ASPECT - 600 / 186) < 1e-9, `expected 600/186, got ${NAMECARD_ASPECT}`);
});
