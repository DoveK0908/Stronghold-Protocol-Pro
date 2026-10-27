import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle } from '../helpers/battleHarness.js';
import { COLS } from '../../server/sim/constants.js';

function field(skillIndex = 0) {
  const h = makeBattle({ units: [{ diy: { slot: 6, charId: 'char_4182_oblvns', skillIndex }, row: 10, col: 5 }],
    enemies: [{ key: 'enemy_1422_lrsldr', time: 100 }], seed: 7 });
  h.runUntil(() => h.allies().length > 0, 5);
  const u = h.allies()[0];
  const e = h.spawn('enemy_1422_lrsldr');
  u.rangeKeySet = new Set([10 * COLS + 5]);
  e.x = 8; e.y = 10.6;
  u.mem.oblvns.cd = 999;
  const note = { x: 8, y: 10, angle: 0, origin: 0, age: 1, outside: 0, target: null, aimed: false, seen: new Set(),
    amount: 1000, type: 'arts', scale: 1, fever: false, pierce: false, pass: 0, seq: 1, speed: 1.7,
    projectile: 'projectile_chr_oblvns' };
  u.mem.oblvns.notes = [note];
  const tick = () => h.b.emit('tick', { dt: 1 / 30 });
  return { h, u, e, note, tick };
}

test('an outside note weakly turns toward a nearby enemy outside the caster range and can hit it', () => {
  const { u, e, note, tick } = field();
  const hp = e.hp;
  note.outside = 0.99;
  tick();
  assert.ok(note.target === e, 'the caster range must not exclude a nearby target of the note');
  assert.ok(note.angle > 0 && note.angle < Math.PI / 2, 'weak tracking turns gradually');
  assert.ok(u.mem.oblvns.notes.includes(note), 'acquiring a target resets the outside expiry timer');
  for (let i = 0; i < 40 && u.mem.oblvns.notes.length; i++) tick();
  assert.ok(e.hp < hp, 'a note may land outside its caster range');
});

test('all three skills seek a nearby outside foe instead of turning back to a remote in-range target', () => {
  for (const skillIndex of [0, 1, 2]) {
    const { h, u, e, note, tick } = field(skillIndex);
    const remote = h.spawn('enemy_1422_lrsldr');
    remote.x = 5; remote.y = 10;
    note.target = remote;
    note.pierce = skillIndex === 1;
    if (skillIndex === 2) u.skill.active = true;
    tick();
    assert.ok(note.target === e, `S${skillIndex + 1}: a close outside enemy is not masked by the remote caster-range list`);
    assert.ok(note.angle > 0 && note.angle < Math.PI / 2);
  }
});

test('S3 activates on an enemy in its expanded skill range before it enters the ordinary range', () => {
  const h = makeBattle({ units: [{ diy: { slot: 6, charId: 'char_4182_oblvns', skillIndex: 2 }, row: 10, col: 5 }],
    enemies: [{ key: 'enemy_1422_lrsldr', time: 100 }], autoOpCooldown: 0 });
  h.runUntil(() => h.allies().length > 0, 5);
  const u = h.allies()[0], e = h.spawn('enemy_1422_lrsldr');
  e.x = 9; e.y = 12;
  u.skill.gainSp(u.skill.spCost, 'test');
  h.b.emit('tick', { dt: 1 / 30 });
  assert.equal(u.skill.active, false, 'an enemy beyond the skill range does not trigger S3');
  e.x = 7; e.y = 11;
  u.mem.oblvns.cd = 0;
  assert.ok(!u.rangeKeySet.has(11 * COLS + 7), 'enemy is outside the ordinary range');
  h.b.emit('tick', { dt: 1 / 30 });
  assert.equal(u.skill.active, true, 'enemy in the S3 range is enough to cast');
  const volley = u.mem.oblvns.notes.filter(n => n.projectile.includes('_s3_'));
  assert.equal(volley.length, 4);
  assert.ok(volley.every(n => n.aimed), 'even the first S3 volley snapshots the newly expanded range');
});

test('an invalid target is released; aimed notes retain stronger steering regardless of current caster range', () => {
  const weak = field();
  weak.tick();
  weak.e.hidden = true;
  weak.tick();
  assert.equal(weak.note.target, null);
  const strong = field();
  strong.note.aimed = true;
  strong.tick();
  assert.ok(strong.note.angle > Math.PI / 12, 'aimed tracking uses the stronger turn cap even outside caster range');
});

test('ordinary and skill notes never turn back toward a distant or passed enemy in the caster range', () => {
  for (const skillIndex of [0, 1, 2]) for (const aimed of [false, true]) {
    const { u, e, note, tick } = field(skillIndex);
    note.aimed = aimed;
    note.target = e;
    e.x = 5; e.y = 10;
    let x = note.x;
    for (let i = 0; i < 20; i++) {
      tick();
      assert.equal(note.target, null, 'a caster-range target cannot override the local search');
      assert.ok(note.x >= x, 'the note continues forward');
      x = note.x;
    }
    // Even a close target that has already passed behind the note cannot make it loop back.
    u.mem.oblvns.notes = [note];
    note.outside = 0;
    e.x = note.x - 0.5; e.y = note.y;
    tick();
    assert.equal(note.target, null);
  }
});

test('outside notes do not seek distant or hidden enemies and still expire without a target', () => {
  for (const hidden of [false, true]) {
    const { u, e, note, tick } = field();
    e.hidden = hidden;
    if (!hidden) e.y = 13;
    tick();
    assert.equal(note.target, null);
    for (let i = 0; i < 40; i++) tick();
    assert.equal(u.mem.oblvns.notes.length, 0);
  }
});
