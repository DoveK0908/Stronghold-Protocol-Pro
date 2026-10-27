// test/sfx-makoto.test.js — 结城理's battle SFX (owner report 2026-10-26: 「结城理的攻击没有音效」). His attack / impact
// banks are his own — `battle.ON_ABILITY_START.char_4217_makoto.attack` → `p_atk_Pskptldr_n`,
// `battle.ON_ABILITY_HIT.char_4217_makoto.attack` → `p_imp_Pskptldr_n` — but the conventional pick does not reach them
// (his 傀儡师 class resolved to the generic `p_atk_blade_n`, which is not his sound and reads as silence next to it), so
// `tools/assets/audio.mjs UNIT_SFX_BANKS` pins the two roles and `data/assets.json` carries the pinned pair.
//
// Covered: the pin's shape, the resolver (with the official audio index when it is on disk), and the manifest / disk end
// of the committed pair.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNIT_SFX_BANKS, indexAudio, unitSfxBanks } from '../tools/assets/audio.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO_PATH = join(ROOT, '.cache', 'gamedata', 'excel', 'audio_data.json');
const audioData = existsSync(AUDIO_PATH) ? JSON.parse(readFileSync(AUDIO_PATH, 'utf8')) : null;
const audio = audioData ? indexAudio(audioData) : null;
const noAudio = !audioData && '.cache/gamedata/excel/audio_data.json missing';

const ATTACK = 'player/p_atk/p_atk_pskptldr_n.mp3';
const HIT = 'player/p_imp/p_imp_pskptldr_n.mp3';
/** The manifest's spelling of an official sound asset (`Audio/Sound_Beta_2/Player/p_atk/x` → `/assets/audio/sfx/Player/p_atk/x`,
 * lower case for the directory only — the file names on disk keep the official spelling). */
/** The manifest's spelling of a resolved sound path: `/assets/audio/sfx/<path>` (the index hands paths out relative to
 * `Audio/Sound_Beta_2`, already lower case — `p_atk_pskptldr_n.mp3`). */
const manifestPath = (path) => `/assets/audio/sfx/${path}`;

describe('UNIT_SFX_BANKS 结城理', () => {
  test('pins exactly his attack and impact banks', () => {
    const pin = UNIT_SFX_BANKS.char_4217_makoto;
    assert.ok(pin, 'char_4217_makoto is not pinned');
    assert.deepEqual([...pin.attack], ['battle.ON_ABILITY_START.char_4217_makoto.attack']);
    assert.deepEqual([...pin.hit], ['battle.ON_ABILITY_HIT.char_4217_makoto.attack']);
  });

  test('the pin resolves to his own files through the audio index', { skip: noAudio }, () => {
    const roles = unitSfxBanks(audio, 'char_4217_makoto');
    assert.ok(roles, 'the pin resolved nothing');
    assert.ok(roles.attack.includes(ATTACK), roles.attack.join(', '));
    assert.ok(roles.hit.includes(HIT), roles.hit.join(', '));
    // and it is not the generic blade the conventional pick produced
    for (const p of [...roles.attack, ...roles.hit]) assert.ok(!/_blade_/.test(p), p);
  });

  test('another unit is untouched by the pin', () => {
    assert.equal(unitSfxBanks(audio, 'char_002_amiya'), null);
    assert.equal(unitSfxBanks(null, 'char_4217_makoto'), null);
  });
});

describe('data/assets.json 结城理', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'data', 'assets.json'), 'utf8'));
  const entry = manifest?.audio?.sfx?.units?.char_4217_makoto;

  test('carries his own attack / impact sounds, not the generic blade', () => {
    assert.ok(entry, 'no sfx.units entry');
    assert.equal(entry.attack, manifestPath(ATTACK));
    assert.equal(entry.hit, manifestPath(HIT));
  });

  test('both files are on disk', { skip: !existsSync(join(ROOT, 'public', 'assets')) && 'public/assets missing' }, () => {
    for (const p of [entry.attack, entry.hit]) {
      assert.ok(existsSync(join(ROOT, 'public', p.replace(/^\//, ''))), `${p} is not on disk`);
    }
  });
});
