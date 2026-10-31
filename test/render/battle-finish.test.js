import test from 'node:test';
import assert from 'node:assert/strict';
import { BattlePresentation } from '../../public/js/render/battlePresentation.js';
import { ANIM, UF } from '../../shared/constants.js';

test('completion plays the finish out, then idles and advances only presentation time', () => {
  const p = new BattlePresentation();
  p.finish();
  // the render clock may cross the newest snapshot while the finish plays (render/app.js, the extrapolation guard), but
  // the settle is the quiet window: the caller's clock reaching the snapshot is not the end any more. The window is game
  // seconds converted at the running rate (1.2 game s ⇒ 0.6 s real at 2×); quarter-second steps make the boundary exact.
  for (let i = 0; i < 3; i++) assert.equal(p.update(10, 10, 0.25, 2), false, 'the finish is still playing');
  assert.equal(p.ended, false, '0.5 s of quiet is not an end yet at 2×');
  assert.equal(p.update(10, 10, 0.25, 2), true, 'a feed that stopped growing is this field`s end');
  assert.equal(p.ended, true);
  const sample = { hp: 10, anim: ANIM.SKILL, flags: UF.SKILL | UF.FROZEN, vx: 1, vy: 1, x: 4, y: 5 };
  assert.deepEqual(p.sample(sample), { ...sample, anim: ANIM.IDLE, flags: 0, vx: 0, vy: 0 });
  p.update(10, 10, 0.1);
  assert.equal(p.tail, 0.35); // the settle frame's own 0.25 s plus this one
  const dead = { ...sample, hp: 0, anim: ANIM.DIE };
  assert.equal(p.sample(dead), dead, 'death poses are preserved');
  p.reset();
  assert.equal(p.ended, false);
  assert.equal(p.sample(sample), sample);
});

test('the settle window is a game-time length, clamped in real seconds', () => {
  const p = new BattlePresentation();
  assert.equal(p.settleWindow(1), 1.2, '1×: the full 1.2 game seconds of finish');
  assert.equal(p.settleWindow(2), 0.6, '2×: the same game seconds in half the real time');
  assert.equal(p.settleWindow(0.5), 1.6, 'slower than 1× is clamped to the ceiling');
  assert.equal(p.settleWindow(8), 0.6, 'a fast rate is clamped to the floor, not to a shorter flicker');
  assert.equal(p.settleWindow(0), 1.6);
  assert.equal(p.settleWindow(NaN), 1.6);
  // the same field at 1× must play the finish for twice the real time of 2×
  const slow = new BattlePresentation();
  slow.finish();
  for (let i = 0; i < 5; i++) assert.equal(slow.update(10, 10, 0.25, 1), false, '1 s of quiet is still playing at 1×');
  assert.equal(slow.update(10, 10, 0.25, 1), true, '1.25 s of quiet ends it at 1×');
});

test('a paused or stalled feed never implies completion; studio zero steps do not run the tail', () => {
  const p = new BattlePresentation();
  for (let i = 0; i < 100; i++) p.update(10, 10, 0.1);
  assert.equal(p.ended, false);
  p.finish();
  p.update(10, 10, 0);
  for (let i = 0; i < 100; i++) p.update(10, 10, 0);
  assert.equal(p.tail, 0);
});

test('a finished field whose feed stops growing still ends the presentation, after the finish played out', () => {
  const p = new BattlePresentation();
  p.finish();
  // the render clock settles `delay × rate` = 0.14 game s behind the newest snapshot and stays there: that trail is not a
  // lag, so the quiet window still ends the finish (public/js/render/battlePresentation.js `settleWindow`)
  for (let i = 0; i < 3; i++) assert.equal(p.update(9.86, 10, 0.25, 2, 0.14), false, 'the settle is still playing');
  assert.equal(p.ended, false, '0.5 s of quiet is not an end yet at 2×');
  assert.equal(p.update(9.86, 10, 0.25, 2, 0.14), true, 'a feed that stopped growing is this field`s end');
  assert.equal(p.ended, true);
  // a growing feed that was never finished never ends, however long it runs
  const q = new BattlePresentation();
  for (let i = 0; i < 100; i++) q.update(9 + i, 10 + i, 0.1);
  assert.equal(q.ended, false);
});

test('a picture left seconds behind by a catch-up burst plays that tail out before the finish ends it', () => {
  // 2× catch-up: the local sim runs ahead in one frame (battle/runner.js CATCHUP_TICKS), so the newest snapshot jumps to
  // 20 while the render clock is still at 12 — ending on the quiet window here froze the last seconds of the fight
  // (reported 2026-10-30: 「击杀最后一个怪的前几秒钟，声音和动作会突然停止」).
  const p = new BattlePresentation();
  p.finish();
  for (let i = 0; i < 10; i++) assert.equal(p.update(12, 20, 0.25, 2, 0.14), false, 'the tail is still unplayed');
  assert.equal(p.ended, false);
  // once the clock closes the gap (interp snaps it forward when the error is large), the quiet window runs and ends it
  for (let i = 0; i < 2; i++) assert.equal(p.update(19.9, 20, 0.25, 2, 0.14), false, 'the settle is still playing');
  assert.equal(p.update(19.9, 20, 0.25, 2, 0.14), true, 'the picture reached the feed, so the finish ends');
  assert.equal(p.ended, true);
  // a clock that never reaches the feed is the backstop (SETTLE_MAX × 2 real s): a stalled picture must still settle
  const stuck = new BattlePresentation();
  stuck.finish();
  for (let i = 0; i < 12; i++) assert.equal(stuck.update(0, 100, 0.25, 2, 0.14), false, 'the backstop has not elapsed');
  assert.equal(stuck.update(0, 100, 0.25, 2, 0.14), true, 'a picture that cannot catch up settles anyway');
});

test('an actual frozen unit leaves its held pose and keeps animating idle after completion', async () => {
  const { installFakePixi, fakeViewCtx } = await import('./fakepixi.js');
  const fake = installFakePixi();
  try {
    const { UnitView, syncView } = await import('../../public/js/render/units.js');
    const { SpineActor } = await import('../../public/js/render/spine.js');
    const v = new UnitView(fakeViewCtx(fake.P), { id: 1, side: 'ally', kind: 'chess', x: 4, y: 5, maxHp: 100 });
    const a = new SpineActor({ animations: [{ name: 'Idle' }] }, { anims: { idle: 'Idle' }, animations: { Idle: 1 } });
    v.actor = a;
    const s = { x: 4, y: 5, hp: 100, maxHp: 100, sp: 0, spMax: 10, flags: UF.FROZEN | UF.SKILL, anim: ANIM.STUN, vx: 0, vy: 0 };
    syncView(v, s, 10);
    assert.equal(a.frozen, true);
    const p = new BattlePresentation(); p.finish();
    for (let i = 0; i < 4; i++) p.update(10, 10, 0.25, 2); // the finish plays out for its settle window first
    syncView(v, p.sample(s), 10);
    a.update(0.1);
    assert.equal(a.frozen, false);
    assert.equal(a.skillOn, false);
    assert.equal(a.current, 'Idle');
    assert.equal(v.flags, 0);
    v.destroy();
  } finally { fake.restore(); }
});

test('official completion cancels late loads and persistent loops but lets a hit finish', async () => {
  const { OfficialFx } = await import('../../public/js/render/vfx/system.js');
  let stopped = 0;
  const pending = { cancelled: false };
  const sys = Object.create(OfficialFx.prototype);
  sys.pending = [pending]; sys.timers = [{ fn() { throw new Error('must not run'); } }];
  sys.effects = [
    { def: {}, handle: { opts: { loop: true } }, stop() { stopped++; } },
    { def: { isLoop: false, loops: true }, stop() { stopped++; } },
    { def: {}, stop() { throw new Error('one-shot must finish naturally'); } },
  ];
  sys.finish();
  assert.equal(stopped, 2);
  assert.equal(pending.cancelled, true);
  assert.equal(sys.pending.length, 0);
  assert.equal(sys.timers.length, 0);
});


test('the official clock advances outside a battle too, so a prep-spawned flash plays out instead of freezing', async () => {
  const { OfficialFx } = await import('../../public/js/render/vfx/system.js');
  const { tickEffectClock } = await import('../../public/js/render/app/playback.js');
  // an OfficialFx as the view builds it, minus the Pixi renderer: the clock is what update() owns
  const layer = (tier) => Object.assign(Object.create(OfficialFx.prototype), {
    time: 0, frameNo: 0, effects: [], pending: [], warmQueue: [], pool: new Map(), particles: 0,
    tier, unsupported: false, lib: { available: true }, glr: null,
  });
  const prep = layer('full');
  // 休整期买到干员、或巫恋「替身娃娃」换人时的 wiring.arrive spawns here; nothing else in prep advances the layer
  assert.equal(tickEffectClock(prep, 0.2, false), true);
  assert.equal(prep.time, 0.2);
  assert.equal(tickEffectClock(prep, 1.6, true), true, 'a seekable (playback) clock keeps the whole delta');
  assert.equal(Number(prep.time.toFixed(3)), 1.8);
  const live = layer('full');
  tickEffectClock(live, 1.6, false);
  assert.equal(live.time, 0.25, 'a live frame keeps the layer\'s own 0.25 s cap');
  const off = layer('off');
  assert.equal(tickEffectClock(off, 1, false), false);
  assert.equal(off.time, 0, 'a disabled layer is not ticked — nothing of it can be on screen');
});

test('completion preserves flight and the stealth-driven enemy form while releasing crowd control', async () => {
  const { installFakePixi, fakeViewCtx } = await import('./fakepixi.js');
  const fake = installFakePixi();
  try {
    const { UnitView, syncView } = await import('../../public/js/render/units.js');
    const v = new UnitView(fakeViewCtx(fake.P), { id: 2, side: 'enemy', kind: 'enemy', defId: 'enemy_9008_acbunn', x: 4, y: 5, maxHp: 100 });
    const sample = { x: 4, y: 5, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: UF.FLYING | UF.STEALTH | UF.FROZEN | UF.SKILL | UF.SHIELD | UF.INVULN, anim: ANIM.STUN, vx: 1, vy: 0 };
    syncView(v, sample, 10);
    assert.equal(v.flying, true);
    assert.equal(v.form, null);
    const p = new BattlePresentation(); p.finish();
    for (let i = 0; i < 4; i++) p.update(10, 10, 0.25, 2); // the finish plays out for its settle window first
    syncView(v, p.sample(sample), 10);
    assert.equal(v.flying, true, 'a snapshot-only flyer stays aloft after completion');
    assert.equal(v.form, null, 'the stealth-driven three-head form stays unchanged');
    assert.equal(v.flags, UF.FLYING | UF.STEALTH | UF.SHIELD | UF.INVULN);
    assert.equal(v.anim, ANIM.IDLE);
    v.destroy();
  } finally { fake.restore(); }
});

test('enemies still drawn when the battle is decided fade out; the own board stays', async () => {
  const { dismissEnemies } = await import('../../public/js/render/units.js');
  const views = new Map([
    [7, { alive: true, dying: 0 }],   // a summon / split child the round's count never included (§14)
    [8, { alive: true, dying: 0 }],   // an operator on the own board
    [9, { alive: false, dying: 0.3 }], // already falling
  ]);
  const sides = new Map([[7, 'enemy'], [8, 'ally'], [9, 'enemy']]);
  assert.equal(dismissEnemies(views, (id) => sides.get(id) ?? null), 1);
  assert.deepEqual(views.get(7), { alive: false, dying: 0.25, dieDur: 0.25 }, 'fades with the presentation');
  assert.deepEqual(views.get(8), { alive: true, dying: 0 }, 'the settle still shows the player’s own units');
  assert.equal(views.get(9).dying, 0.3, 'a death already running keeps its own timing');
});
