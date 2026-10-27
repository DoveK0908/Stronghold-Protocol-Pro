import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SakikoFx, SAKIKO } from '../../public/js/render/vfx/sakiko.js';

test('DIY notes use the official prefab without a comparison marker, including the blue outfit', () => {
  const view = { id: 1, alive: true, x: 5, y: 8, info: { defId: 'chess_char_6_diy1_a', diy: { charId: SAKIKO } } };
  const calls = [];
  const wiring = {
    unitKeyOf: () => null, view: () => view,
    ofx: { active: true, time: 0, lib: { has: () => true } },
    idx: { projectiles: { note: { main: 'oblvns_attack_01_trail' } } },
    playOn(key, carrier, opts) {
      const h = { alive: true, stop() { this.alive = false; }, kill() { this.alive = false; } };
      calls.push({ key, carrier, opts, h });
      return h;
    },
  };
  const fx = new SakikoFx(wiring);
  const event = { id: 1, note: 1, projectile: 'note' };
  assert.equal(fx.simFx('musicNote', 5, 8, event), true);
  assert.equal(calls[0].key, 'oblvns_attack_01_trail');
  const effect = { anchor: [-5, -1, -0.55], stop() {} };
  calls[0].opts.track(effect);
  fx.simFx('musicNote', 6, 9, event);
  calls[0].opts.track(effect);
  assert.deepEqual(effect.anchor, [-5, -1, -0.55], 'a new 10 Hz position does not jump on arrival');
  wiring.ofx.time = 0.05;
  calls[0].opts.track(effect);
  assert.deepEqual(effect.anchor, [-4.5, -0.5, -0.55], 'intermediate render frames move between sim samples');
  wiring.ofx.time = 0.1;
  calls[0].opts.track(effect);
  assert.deepEqual(effect.anchor, [-4, 0, -0.55], 'sim positions move the note without rotating its glyph');
  assert.equal(calls.length, 1, 'position updates reuse the same prefab');
  view.info.skin = 'char_4182_oblvns_avemujica_1';
  fx.simFx('musicNote', 5, 8, { ...event, note: 2 });
  assert.equal(calls[1].key, 'oblvns_attack_01_trail_avemujica#1');
  wiring.ofx.time = 1;
  fx.tick();
  assert.equal(fx.notes.size, 0, 'expired notes are stopped');
  assert.ok(calls.every(c => !c.h.alive));
});
