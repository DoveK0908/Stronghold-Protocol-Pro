// Audio manager (public/js/audio.js): BGM selection, manifest resolution, SFX limiter, and the manager's
// never-throw behaviour with a fake Web Audio implementation.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SFX_PRI, bgmKeyFor, resolveBgm, SfxLimiter, AudioManager, normalAttackSfx, installAudio, audio, combatTrackFor, COMBAT_TRACK_SWITCH_ROUND, VoiceGate, resultSpeaker, resultVoiceSlot, VOICE_PRIORITY, VOICE_COOLDOWN_MS, voiceLine, VOICE_TREES } from '../../public/js/audio.js';
import { mediaUrl } from '../../public/js/media.js';
import { pickedBgm, bgmChoiceKind, sanitizeBgmChoice, BGM_CHOICES, MAJOR_BGM_URL } from '../../public/js/bgmChoice.js';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../../public/js/ui/gameLogic.js';
import { PHASE } from '../../shared/constants.js';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'data', 'assets.json'), 'utf8'));

// audio.js 取音频时**先请求无扩展名的 /media/…**（正是为了躲开下载管理器对 .mp3 后缀的嗅探），
// 原路径失败先尝试同版本 OpenI；/media/ 两边都缺失才兼容 manifest 原始地址。「某个音效响了没有」不能拿原始地址去比对——
// 那样断言的是一个客户端永远不会请求的 URL。下面两个助手把比对放到同一条换算上。
/** 这个 manifest 地址被请求过吗（/media/ 形式或 404 后的原始形式）。 */
const asked = (urls, raw) => urls.includes(mediaUrl(raw)) || urls.includes(raw);
/** 这个 manifest 地址被请求了几次。 */
const askedCount = (urls, raw) => urls.filter((u) => u === mediaUrl(raw) || u === raw).length;

describe('bgm selection', () => {
  test('route and phase → key', () => {
    assert.equal(bgmKeyFor('title', null), 'lobby');
    assert.equal(bgmKeyFor('room', null), 'lobby');
    assert.equal(bgmKeyFor('game', null), 'lobby');
    assert.equal(bgmKeyFor('game', { phase: PHASE.INFO_CHECK }), 'lobby');
    assert.equal(bgmKeyFor('game', { phase: PHASE.PREP }), 'prep');
    assert.equal(bgmKeyFor('game', { phase: PHASE.SP_DRAFT }), 'prep');
    assert.equal(bgmKeyFor('game', { phase: PHASE.COMBAT }), 'combat');
    // 联防 has its own track: the official escaped_single / escaped_multi levels declare bgmEvent = corrosion
    assert.equal(bgmKeyFor('game', { phase: PHASE.UNITE }), 'unite');
    // 开战 BGM: the round's own track (combatTrackFor) indexes the manifest's `bgm.combatAlts`
    assert.equal(bgmKeyFor('game', { phase: PHASE.COMBAT }, 0), 'combat:0');
    assert.equal(bgmKeyFor('game', { phase: PHASE.COMBAT }, 1), 'combat:1');
    assert.equal(bgmKeyFor('game', { phase: PHASE.UNITE }, 1), 'unite', '联防 keeps its own track, not the round index');
    assert.equal(bgmKeyFor('game', { phase: PHASE.PREP }, 1), 'prep');
    assert.equal(bgmKeyFor('game', { phase: PHASE.FINAL_ASSAULT, bossId: 'boss_4' }, 1), 'boss:boss_4');
    assert.equal(bgmKeyFor('game', { phase: PHASE.FINAL_ASSAULT, bossId: 'boss_4' }), 'boss:boss_4');
    assert.equal(bgmKeyFor('game', { phase: PHASE.FINAL_ASSAULT }), 'boss');
    assert.equal(bgmKeyFor('game', { phase: PHASE.HIDDEN_CORE, bossId: 'boss_1', hiddenBossId: 'boss_9' }, 1), 'boss:boss_9');
    assert.equal(bgmKeyFor('game', { phase: PHASE.RESULT }), 'lobby');
    assert.equal(bgmKeyFor('weird', null), null);
  });
  test('开战 BGM: the track is fixed per round, not drawn (无畏者 1–7, 骑士之日 8–13)', () => {
    // The mode does not draw its battle theme: the official schedule plays 无畏者 through the early rounds and
    // 骑士之日 from round 8 on (reviewer note — review had this as a per-match 0.5 draw before).
    for (const r of [1, 2, 3, 4, 5, 6, 7]) assert.equal(combatTrackFor(r), 1, `round ${r} plays 无畏者`);
    for (const r of [8, 9, 10, 11, 12, 13]) assert.equal(combatTrackFor(r), 0, `round ${r} plays 骑士之日`);
    assert.equal(COMBAT_TRACK_SWITCH_ROUND, 7, 'the switch sits between round 7 and 8');
    // the boss rounds (14 最终攻势 / 15 隐秘核心) have their own tracks and never ask for combat:<i>
    assert.equal(bgmKeyFor('game', { phase: PHASE.FINAL_ASSAULT, round: 14 }, combatTrackFor(14)), 'boss');
    // an unknown round falls back to the manifest's plain combat track (older manifest / no round yet)
    for (const bad of [null, undefined, 0, -1, NaN, 'x']) assert.equal(combatTrackFor(bad), null, `${bad} ⇒ no index`);
    assert.equal(bgmKeyFor('game', { phase: PHASE.COMBAT, round: 3 }, combatTrackFor(null)), 'combat');
    // both ends of a real run: a solo 标准 match is 9 rounds, so it hears 无畏者 and then 骑士之日
    assert.equal(bgmKeyFor('game', { phase: PHASE.COMBAT, round: 7 }, combatTrackFor(7)), 'combat:1');
    assert.equal(bgmKeyFor('game', { phase: PHASE.COMBAT, round: 8 }, combatTrackFor(8)), 'combat:0');
    // the index↔track mapping this table assumes, from docs/ASSETS.md: combatAlts[0] = m_bat_kazimierz2_1 骑士之日,
    // combatAlts[1] = m_bat_kazimierz2_2 无畏者 (a reordering upstream breaks this test, not the players' ears)
    const alt = manifest.audio.bgm.combatAlts;
    assert.ok(alt[0].loop.includes('m_bat_kazimierz2_1'), `combatAlts[0] is 骑士之日: ${alt[0].loop}`);
    assert.ok(alt[1].loop.includes('m_bat_kazimierz2_2'), `combatAlts[1] is 无畏者: ${alt[1].loop}`);
  });
  test('resolveBgm uses the manifest (boss fallback, intro optional)', () => {
    const lobby = resolveBgm(manifest, 'lobby');
    assert.ok(lobby && typeof lobby.loop === 'string');
    const b4 = resolveBgm(manifest, 'boss:boss_4');
    assert.equal(b4.loop, manifest.audio.bossBgm.boss_4.loop);
    assert.equal(resolveBgm(manifest, 'boss:nope').loop, manifest.audio.bgm.boss.loop);
    // 开战 BGM: combat:<i> → bgm.combatAlts[i], and back to the default combat track when the index (or the whole
    // array, e.g. an older manifest) is missing
    const alts = manifest.audio.bgm.combatAlts;
    assert.ok(Array.isArray(alts) && alts.length >= 2, 'manifest carries the mode’s own battle tracks');
    assert.equal(resolveBgm(manifest, 'combat:0').loop, alts[0].loop);
    assert.equal(resolveBgm(manifest, 'combat:1').loop, alts[1].loop);
    assert.notEqual(alts[0].loop, manifest.audio.bgm.combat.loop, 'a real battle track, not the shop loop');
    assert.equal(resolveBgm(manifest, 'combat:9').loop, manifest.audio.bgm.combat.loop);
    assert.equal(resolveBgm({ audio: { bgm: { combat: { loop: '/shop.mp3' } } } }, 'combat:0').loop, '/shop.mp3');
    assert.equal(resolveBgm(manifest, 'prep').intro, manifest.audio.bgm.prep.intro ?? null);
    // 联防's own track (bgm.unite = corrosion, the official escaped levels' bgmEvent), and the fallback for an older
    // manifest that has no `unite` entry (the music must not go silent)
    const unite = manifest.audio.bgm.unite;
    assert.ok(unite && typeof unite.loop === 'string', 'the manifest carries 联防’s own track');
    assert.equal(resolveBgm(manifest, 'unite').loop, unite.loop);
    assert.equal(resolveBgm(manifest, 'unite').intro, unite.intro ?? null);
    assert.notEqual(unite.loop, manifest.audio.bgm.combat.loop, 'not the shop / default combat loop');
    assert.equal(resolveBgm({ audio: { bgm: { combat: { loop: '/shop.mp3' } } } }, 'unite').loop, '/shop.mp3');
    assert.equal(resolveBgm(null, 'lobby'), null);
    assert.equal(resolveBgm(manifest, null), null);
    assert.equal(resolveBgm(manifest, 'nope'), null);
  });
  test('installAudio: the round\'s own 开战 track, fixed per round and the same on every client', () => {
    const calls = [];
    const origPlay = audio.playBgm;
    audio.playBgm = (k) => { calls.push(k); };
    try {
      const pub = (o) => ({ phase: PHASE.PREP, round: 1, stageId: 'st1', players: [{ playerId: 'p1' }], ...o });
      const state = { route: 'game', match: { public: pub({}) } };
      let fire = null;
      /** One client: its own store subscription (the expected keys below are what its own round yields — the point of
       * the test is that the track follows the round, never moves inside a battle and never differs between clients). */
      const wire = () => installAudio({
        getManifest: () => manifest, getState: () => state, selectRoute: (s) => s.route,
        subscribe: (fn) => { fire = fn; return () => {}; },
      });
      wire();
      assert.equal(calls.at(-1), 'prep', 'the prep keeps the shop track');
      // round 1 ⇒ 无畏者 (combatAlts[1])
      state.match.public = pub({ phase: PHASE.COMBAT });
      fire(state, {}); assert.equal(calls.at(-1), 'combat:1');
      // a re-render / teammate view inside the same battle never moves
      fire(state, {}); assert.equal(calls.at(-1), 'combat:1');
      // 联防 has its OWN track (#110, the official escaped levels' `bgmEvent = corrosion`) — it does not inherit the
      // round's 开战 track
      state.match.public = pub({ phase: PHASE.UNITE });
      fire(state, {}); assert.equal(calls.at(-1), 'unite');
      // …and back to the round's own track in the 作战
      state.match.public = pub({ phase: PHASE.COMBAT });
      fire(state, {}); assert.equal(calls.at(-1), 'combat:1', "back to the round's own track");
      // a second client of the same room hears the same track (its own installAudio, same round)
      calls.length = 0; wire();
      assert.deepEqual(calls, ['combat:1'], 'every client of the match hears the same track');
      // round 7 is the last on 无畏者, round 8 switches to 骑士之日 (combatAlts[0]) — whoever sits in seat 1
      state.match.public = pub({ round: 7, phase: PHASE.COMBAT });
      fire(state, {}); assert.equal(calls.at(-1), 'combat:1');
      state.match.public = pub({ round: 8, phase: PHASE.COMBAT });
      fire(state, {}); assert.equal(calls.at(-1), 'combat:0');
      state.match.public = pub({ round: 8, phase: PHASE.COMBAT, players: [{ playerId: 'p2' }] });
      fire(state, {}); assert.equal(calls.at(-1), 'combat:0', 'the track does not depend on the seats');
      // the boss rounds keep their own tracks
      state.match.public = pub({ phase: PHASE.FINAL_ASSAULT, bossId: 'boss_4' });
      fire(state, {}); assert.equal(calls.at(-1), 'boss:boss_4');
    } finally { audio.playBgm = origPlay; }
  });
});

describe('SfxLimiter', () => {
  test('caps concurrent voices', () => {
    const l = new SfxLimiter({ maxVoices: 3, unitCooldownMs: 0, urlGapMs: 0 });
    assert.ok(l.tryAcquire(0, 1, 'a'));
    assert.ok(l.tryAcquire(0, 2, 'b'));
    assert.ok(l.tryAcquire(0, 3, 'c'));
    assert.equal(l.tryAcquire(0, 4, 'd'), false);
    l.release();
    assert.ok(l.tryAcquire(0, 4, 'd'));
    l.release(); l.release(); l.release(); l.release(); l.release();
    assert.equal(l.active, 0, 'never negative');
  });
  test('per-unit cooldown and per-url gap', () => {
    const l = new SfxLimiter({ maxVoices: 99, unitCooldownMs: 100, urlGapMs: 30 });
    assert.ok(l.tryAcquire(0, 'u1', 'x'));
    assert.equal(l.tryAcquire(50, 'u1', 'y'), false, 'same unit too soon');
    assert.equal(l.tryAcquire(10, 'u2', 'x'), false, 'same url too soon');
    assert.ok(l.tryAcquire(40, 'u2', 'x'));
    assert.ok(l.tryAcquire(120, 'u1', 'z'));
    assert.ok(l.tryAcquire(121, null, 'w'), 'no unit key ⇒ only url gap');
  });
  test('the per-url gap is GLOBAL, not per unit (dust 0.2.5 contract — a deliberate divergence)', () => {
    // sakiko 0.1.4 keyed this map per unit (`${unitKey}\0${url}`), so two 丰川祥子 could each start the identical file
    // in the same tick — the owner report 「场上有两只丰川祥子时，似乎只播放其中一只的音效」 was answered by that change.
    // dust 0.2.5 spells the gap the other way: `SfxLimiter.lastByUrl` is ONE map for every caller, and dust's own
    // `per-unit cooldown and per-url gap` test above pins that reading (`tryAcquire(10, 'u2', 'x') === false`).
    // The mod keeps dust's contract — a second unit does NOT get its own copy inside the gap — because the hard
    // requirement is that neither the official base nor this fork has to merge around us. See mods/sakiko/README.md.
    const l = new SfxLimiter({ maxVoices: 99, unitCooldownMs: 160, urlGapMs: 45 });
    assert.ok(l.tryAcquire(1000, '1:attack', 'her.mp3'), 'unit 1 starts it');
    assert.equal(l.tryAcquire(1000, '5:attack', 'her.mp3'), false, 'unit 5, the very same timestamp: the global gap refuses it');
    assert.equal(l.lastByUrl.get('her.mp3'), 1000, 'the gap is keyed by url alone');
    assert.equal(l.lastByUnit.get('5:attack'), undefined, 'unit 5 was never admitted, so it has no per-unit state');
    assert.equal(l.tryAcquire(1044, '5:attack', 'her.mp3'), false, '44 ms on: still inside the gap');
    assert.ok(l.tryAcquire(1045, '5:attack', 'her.mp3'), '45 ms on: the file may start again');
    assert.equal(l.lastByUnit.get('5:attack'), 1045);
    // the per-unit cooldown is a separate, narrower rule: one unit never flams with itself
    assert.ok(l.tryAcquire(1200, '1:attack', 'other.mp3'), 'unit 1, a different file, past its 160 ms cooldown');
    assert.equal(l.tryAcquire(1250, '1:attack', 'third.mp3'), false, 'unit 1 again, its own cooldown not yet spent');
    assert.ok(l.active <= l.maxVoices);
  });
  test('at most 2 overlapping copies of one sound (official banks: maxSoundAllowed 2)', () => {
    const l = new SfxLimiter({ maxVoices: 99, unitCooldownMs: 0, urlGapMs: 0 });
    assert.equal(l.maxPerUrl, 2);
    assert.ok(l.tryAcquire(0, 'a', 'heal'));
    assert.ok(l.tryAcquire(1, 'b', 'heal'));
    assert.equal(l.tryAcquire(2, 'c', 'heal'), false, 'a third copy waits');
    assert.ok(l.tryAcquire(2, 'c', 'other'), 'other sounds are not affected');
    l.release('heal');
    assert.ok(l.tryAcquire(3, 'c', 'heal'), 'one ended: room again');
  });
});

// ---- operator battle voice (manifest audio.voice; official priorities, audio_data.json battleVoice) ---------

describe('operator battle voice', () => {
  test('resultVoiceSlot: 完美作战 / 高难 / 漏怪 / 全灭', () => {
    assert.equal(resultVoiceSlot({ perfect: true }), 'resultThree');
    assert.equal(resultVoiceSlot({ perfect: true, hard: true }), 'resultFour', '绝境 / 终极 报 完成高难行动');
    assert.equal(resultVoiceSlot({ perfect: false, leaked: 2, killed: 10, total: 12 }), 'resultTwo');
    assert.equal(resultVoiceSlot({ perfect: false, leaked: 0, killed: 0, total: 12 }), 'resultLose');
    assert.equal(resultVoiceSlot({ perfect: false, leaked: 0, killed: 5, total: 5 }), 'resultThree', 'no leak ⇒ the 完美 line');
    assert.equal(resultVoiceSlot(), 'resultThree');
  });

  test('resultSpeaker: the operators of THAT battle (survivors first), never the field on screen', () => {
    // `mine.unitsEnd` of the finished own battle: operators (char_*) and the board's summon pieces (token_*, no voice)
    const mine = { unitsEnd: [
      { defId: 'char_fallen', alive: false },
      { defId: 'token_1001', alive: true },
      { defId: 'char_a', alive: true },
      { defId: 'char_b', alive: true },
    ] };
    assert.equal(resultSpeaker(mine, () => 0), 'char_a');
    assert.equal(resultSpeaker(mine, () => 0.999), 'char_b', 'a drawn operator, still only the ones standing');
    assert.equal(resultSpeaker(mine, () => 0.4), 'char_a');
    const drawn = new Set([0, 0.2, 0.4, 0.6, 0.8, 1].map((r) => resultSpeaker(mine, () => r)));
    assert.deepEqual([...drawn].sort(), ['char_a', 'char_b'], 'a fallen operator or a summon never speaks');
    // the whole squad fell: only then does a fallen operator report the result
    const wiped = { unitsEnd: [{ defId: 'char_fallen', alive: false }, { defId: 'char_also', alive: false }] };
    assert.equal(resultSpeaker(wiped, () => 0), 'char_fallen');
    assert.equal(resultSpeaker(wiped, () => 0.999), 'char_also');
    // no operator on that field at all — summons only, an empty list, or a payload without `unitsEnd` (an older
    // server): no line. There is deliberately NO fallback to the operators currently tracked for the field on screen —
    // that fallback is what made a watched team-mate's operator say the viewer's line (review on #73).
    assert.equal(resultSpeaker({ unitsEnd: [{ defId: 'token_1', alive: true }] }, () => 0), null);
    assert.equal(resultSpeaker({ unitsEnd: [] }), null);
    assert.equal(resultSpeaker({}), null);
    assert.equal(resultSpeaker(null), null);
    assert.equal(resultSpeaker(undefined), null);
    assert.equal(resultSpeaker({ unitsEnd: [{ alive: true }] }, () => 0), null, 'a unit without a defId');
    assert.equal(resultSpeaker({ unitsEnd: [{ defId: 'enemy_1007_slime', alive: true }] }, () => 0), null, 'an enemy');
  });

  test('resultSpeaker on a real battle result: unitsEnd names the chess, the chess record gives the speaking operator', () => {
    // the sim reports each unit by its chess id (sim/Battle.js unitsEnd defId = the chess record's id), so the line needs
    // the chess → charId step the game screen passes (data.lookup('chess', id).charId); without it no battle ever spoke
    const chessTable = JSON.parse(readFileSync(path.join(ROOT, 'data', 'chess.json'), 'utf8'));
    const id = 'chess_char_1_01_a';
    assert.equal(chessTable[id]?.charId, 'char_498_inside');
    const h = makeBattle({ defs: { chess: { [id]: chessRec({ id }) } }, units: [{ chessId: id, row: 10, col: 4 }], content: 'none' });
    const mine = Object.values(h.runToEnd(30).perPlayer)[0];
    assert.equal(mine.unitsEnd[0].defId, id, 'the result carries the chess id, not the charId');
    assert.equal(resultSpeaker(mine, () => 0), null, 'no chess → charId step: silent (the 0.1.4 bug)');
    assert.equal(resultSpeaker(mine, () => 0, (defId) => chessTable[defId]?.charId ?? null), 'char_498_inside');
  });

  test('VoiceGate: one line at a time, a global gap, per-unit cooldowns, higher priority takes over', () => {
    assert.ok(VOICE_PRIORITY.start > VOICE_PRIORITY.skill1 && VOICE_PRIORITY.skill1 > VOICE_PRIORITY.place, 'the official order');
    assert.ok(VOICE_PRIORITY.resultThree > VOICE_PRIORITY.skill1 && VOICE_PRIORITY.resultThree < VOICE_PRIORITY.faceEnemy);
    assert.equal(VOICE_COOLDOWN_MS.skill1, 10000, 'official SKILL_ACTIVE 10 s');
    const g = new VoiceGate({ gapMs: 1000 });
    assert.equal(g.request('start', 1, 0), 'play');
    g.start('start', 1, 0);
    assert.equal(g.request('skill1', 2, 500), 'drop', 'one voice at a time (a lower priority waits)');
    assert.equal(g.request('start', 3, 500), 'drop', 'the same priority does not interrupt');
    assert.equal(g.request('faceEnemy', 3, 500), 'drop', '90 < 100 + margin');
    g.release();
    assert.equal(g.request('place', 1, 900), 'drop', 'the global gap is not over');
    assert.equal(g.request('place', 1, 1000), 'play');
    g.release();
    const g2 = new VoiceGate({ gapMs: 0 });
    assert.equal(g2.request('skill1', 'u1', 0), 'play');
    g2.start('skill1', 'u1', 0);
    g2.release();
    assert.equal(g2.request('skill1', 'u1', 5000), 'drop', 'the unit cooldown');
    assert.equal(g2.request('skill1', 'u2', 5000), 'play', 'another unit is unaffected');
    g2.release();
    assert.equal(g2.request('skill1', 'u1', 10000), 'play', 'cooldown over');
    g2.release();
    g2.reset();
    assert.equal(g2.request('skill1', 'u1', 10001), 'play', 'a new battle inherits no cooldown');
  });

  test('选中干员 on every tap (0.2.2; official FOCUS_CHAR: priority 10, cooldown 0): the prep speaks too, an idle channel always answers, a newer tap replaces it, a higher line is never interrupted', async () => {
    // the owner's request of 2026-10-08 「添加一下干员点击上去的语气一样的语音」: the game screen lets the detail panel speak
    // in every phase — a tap on a piece in the field / hand, a shop card — not only while a battle runs
    const game = readFileSync(path.join(ROOT, 'public/js/screens/game.js'), 'utf8');
    assert.match(game, /<\$\{DetailPanel\}[^`]*?voice=\$\{true\}/, 'the detail panel speaks outside battle too');
    assert.doesNotMatch(game, /voice=\$\{combat\}/);
    assert.equal(VOICE_PRIORITY.select, 10, 'official FOCUS_CHAR priority');
    assert.equal(VOICE_COOLDOWN_MS.select, 0, 'official FOCUS_CHAR cooldown 0');
    const g = new VoiceGate();                     // the real 1.2 s global gap
    assert.equal(g.request('select', null, 0), 'play');
    g.start('select', null, 0); g.release();       // tap A, its line ended
    assert.equal(g.request('select', null, 300), 'play', 'an idle channel: the global gap never drops a tap');
    g.start('select', 'u1', 300); g.release();
    assert.equal(g.request('select', 'u1', 400), 'play', 'no cooldown either, keyed or not');
    g.start('select', null, 400);
    assert.equal(g.request('select', null, 600), 'preempt', 'a newer tap replaces the 选中 line on air (overlapIfSamePriority)');
    g.start('select', null, 600);
    assert.equal(g.request('place', 'u2', 700), 'preempt', '部署 (20) still takes the channel from 选中 (10)');
    g.start('place', 'u2', 700);
    assert.equal(g.request('select', null, 800), 'drop', 'a tap never interrupts a higher-priority line');
    g.reset();
    g.start('skill1', 'u3', 0);
    assert.equal(g.request('select', null, 100), 'drop', '… nor a 作战中 line');
    g.reset();
    // a tap starts no gap of its own (review of fb7-voices): a 部署 at 0 holds the battle lines until 1200; a tap at 500
    // answers, its short line ends at 944, and a 作战中 the battle asks for once at 1300 still plays (it was dropped: the
    // tap had moved the gap's start to 500)
    g.start('place', 'u4', 0); g.release();
    assert.equal(g.request('select', null, 500), 'play');
    g.start('select', null, 500); g.release();
    assert.equal(g.request('skill1', 'u5', 1100), 'drop', 'inside the 部署 gap a battle line still waits');
    assert.equal(g.request('skill1', 'u5', 1300), 'play', 'the gap ends where the 部署 put it: the tap did not restart it');
    g.reset();
    g.start('select', null, 0); g.release();
    assert.equal(g.request('place', 'u6', 100), 'play', 'a battle line right after a tap: no gap behind a 选中 line');
    g.reset();
    // the manager: two taps 0.3 s apart in the prep (no battle, the real gate) both speak, the second replacing the first
    const fw = fakeWindow();
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    try {
      const vm = { audio: { sfx: { ui: {}, battle: {}, units: {} }, voice: { char_a: { select: '/v/a_sel.mp3' }, char_b: { select: '/v/b_sel.mp3' } } } };
      const a = new AudioManager({ win: fw.win, getManifest: () => vm });
      a.install();
      fw.fire('pointerdown');
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(a.voice('char_a', 'select'), true, 'tap A');
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(a.voiceNode?.url, '/v/a_sel.mp3');
      assert.equal(a.voice('char_b', 'select'), true, 'tap B while A still speaks');
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(a.voiceNode?.url, '/v/b_sel.mp3', 'B replaced A');
      a._stopVoice();                              // B ended
      assert.equal(a.voice('char_a', 'select'), true, 'tap A again right after: no gap');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('语音语言 (0.2.2): 日本語 plays audio.voiceJp — the same slots and file names — and falls back to the Chinese line per slot and per line', async () => {
    const audioM = {
      voice: { char_a: { select: ['/a/voice/cn/char_a/cn_021.mp3', '/a/voice/cn/char_a/cn_022.mp3'], place: '/a/voice/cn/char_a/cn_023.mp3', start: '/a/voice/cn/char_a/cn_019.mp3' } },
      voiceJp: { char_a: { select: ['/a/voice/jp/char_a/cn_021.mp3', '/a/voice/jp/char_a/cn_022.mp3'], place: '/a/voice/jp/char_a/cn_023.mp3' } },
    };
    assert.deepEqual(voiceLine(audioM, 'char_a', 'place'), { url: '/a/voice/cn/char_a/cn_023.mp3', fallback: null }, '中文 by default');
    assert.deepEqual(voiceLine(audioM, 'char_a', 'place', 'cn'), { url: '/a/voice/cn/char_a/cn_023.mp3', fallback: null });
    assert.deepEqual(voiceLine(audioM, 'char_a', 'place', 'jp'), { url: '/a/voice/jp/char_a/cn_023.mp3', fallback: '/a/voice/cn/char_a/cn_023.mp3' });
    // a drawn line keeps its Chinese twin as the fallback (选中干员2 ⇒ 选中干员2)
    assert.deepEqual(voiceLine(audioM, 'char_a', 'select', 'jp', () => 0.99), { url: '/a/voice/jp/char_a/cn_022.mp3', fallback: '/a/voice/cn/char_a/cn_022.mp3' });
    assert.deepEqual(voiceLine(audioM, 'char_a', 'select', 'jp', () => 0), { url: '/a/voice/jp/char_a/cn_021.mp3', fallback: '/a/voice/cn/char_a/cn_021.mp3' });
    assert.deepEqual(voiceLine(audioM, 'char_a', 'start', 'jp'), { url: '/a/voice/cn/char_a/cn_019.mp3', fallback: null }, 'a slot the JP tree lacks: the Chinese line');
    assert.equal(voiceLine(audioM, 'char_zz', 'select', 'jp'), null, 'an operator no dub voices (stand-ins, 盟约·辅助干员, summons) stays silent');
    assert.equal(voiceLine({ voice: {} }, 'char_a', 'select', 'jp'), null);
    assert.equal(voiceLine(null, 'char_a', 'select', 'jp'), null);
    assert.deepEqual(voiceLine({ voice: audioM.voice }, 'char_a', 'place', 'jp'), { url: '/a/voice/cn/char_a/cn_023.mp3', fallback: null }, 'a manifest without voiceJp');
    // the real manifest: every operator with a Chinese line has its Japanese twin
    const real = voiceLine(manifest.audio, 'char_263_skadi', 'select', 'jp', () => 0);
    assert.match(real.url, /^\/assets\/audio\/voice\/jp\/char_263_skadi\/cn_021\.mp3$/);
    assert.equal(real.fallback, '/assets/audio/voice/cn/char_263_skadi/cn_021.mp3');

    // the manager: the setting picks the tree; a JP file the host lacks (404) plays the Chinese one, holding the channel
    const fw = fakeWindow();
    const origFetch = globalThis.fetch;
    const urls = [];
    const missing = new Set(['/a/voice/jp/char_a/cn_023.mp3', mediaUrl('/a/voice/jp/char_a/cn_023.mp3')]);
    globalThis.fetch = async (u) => { urls.push(u); return missing.has(u) ? { ok: false, status: 404 } : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
    const tick = () => new Promise((r) => setTimeout(r, 10));
    try {
      const a = new AudioManager({ win: fw.win, getManifest: () => ({ audio: { sfx: { ui: {}, battle: {}, units: {} }, ...audioM } }) });
      a.voiceGate = new VoiceGate({ gapMs: 0 });   // the gap itself is covered above
      a.install();
      fw.fire('pointerdown');
      await tick();
      assert.equal(a.voiceLang, 'cn');
      a.setVoiceLang('jp');
      assert.equal(a.voiceLang, 'jp');
      assert.equal(a.voice('char_a', 'select'), true);
      await tick();
      assert.match(a.voiceNode?.url ?? '', /^\/a\/voice\/jp\/char_a\/cn_02[12]\.mp3$/, '日本語: the JP line');
      a._stopVoice();
      assert.equal(a.voice('char_a', 'place', { unitKey: 1 }), true);
      await tick(); await tick();
      assert.ok(asked(urls, '/a/voice/jp/char_a/cn_023.mp3'), 'the JP file was asked for first');
      assert.equal(a.voiceNode?.url, '/a/voice/cn/char_a/cn_023.mp3', 'the host lacks it: the Chinese line of the same name plays');
      assert.equal(a.voice('char_a', 'place', { unitKey: 2 }), false, 'the fallback holds the channel like any line');
      a._stopVoice();
      a.setVoiceLang('cn');
      assert.equal(a.voice('char_a', 'select'), true);
      await tick();
      assert.match(a.voiceNode?.url ?? '', /^\/a\/voice\/cn\/char_a\/cn_02[12]\.mp3$/, '中文 again');
      a._stopVoice();
      a.setVoiceLang('kr');
      assert.equal(a.voiceLang, 'kr', '한국어 is a dub');
      a.setVoiceLang('xx');
      assert.equal(a.voiceLang, 'cn', 'an unknown value stays 中文');
      // the settings store hands the choice over (installAudio and ui/settings.js)
      const settings = readFileSync(path.join(ROOT, 'public/js/ui/settings.js'), 'utf8');
      const control = readFileSync(path.join(ROOT, 'public/js/ui/languageSettings.js'), 'utf8');
      assert.match(settings, /voiceLanguageStore\.subscribe\(/);
      assert.match(settings, /setVoiceLanguage\(next\.voiceLang\)/);
      assert.doesNotMatch(settings, /audio\.setVoiceLang\(s\.voiceLang\)/, 'a volume edit must not reset the selected dub');
      assert.match(settings, /audio\.setVoiceLang\(s\.voiceLang, s\.voiceOverrides\)/);
      // 界面#17 (81507063): the official settings layout — 界面语言 above 背景音乐, 语音语言 right under 干员语音; the
      // rows themselves are the shared controls of ui/languageSettings.js, and the lobby's dialog keeps the whole
      // section (LanguageSettings) around both.
      assert.match(settings, /<\$\{LanguageSelect\} \/>/);
      assert.match(settings, /<\$\{VoiceLanguageRow\} \/>/);
      assert.ok(settings.indexOf('<${LanguageSelect} />') < settings.indexOf('value=${s.bgm}'), '界面语言 sits at the top');
      assert.ok(settings.indexOf('<${VoiceLanguageRow} />') > settings.indexOf('value=${s.voice}'), '语音语言 under 干员语音');
      assert.match(control, /<\$\{LanguageSettings\}/, 'the lobby dialog keeps the section');
      assert.match(control, /t\('语音语言'\)/);
      assert.match(control, /setVoiceLanguage\(option\.code\)/);
      assert.match(settings, /audio\.setVoiceNative\(s\.voiceNative\)/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('English, Korean and the own-language dub use the same fallback as 日本語; 试听 skips the gate', async () => {
    assert.deepEqual(VOICE_TREES, { jp: 'voiceJp', en: 'voiceEn', kr: 'voiceKr', native: 'voiceNative' });
    const id = 'char_102_texas';
    const audioM = {
      voice: { [id]: { select: '/a/voice/cn/char_a/cn_021.mp3', place: '/a/voice/cn/char_a/cn_023.mp3' } },
      voiceEn: { [id]: { select: '/a/voice/en/char_a/cn_021.mp3' } },
      voiceKr: { [id]: { place: '/a/voice/kr/char_a/cn_023.mp3' } },
      voiceNative: { [id]: { select: '/a/voice/native/char_a_ita/cn_021.mp3' } },
    };
    assert.deepEqual(voiceLine(audioM, id, 'select', 'en'), { url: '/a/voice/en/char_a/cn_021.mp3', fallback: '/a/voice/cn/char_a/cn_021.mp3' });
    assert.deepEqual(voiceLine(audioM, id, 'place', 'kr'), { url: '/a/voice/kr/char_a/cn_023.mp3', fallback: '/a/voice/cn/char_a/cn_023.mp3' });
    assert.deepEqual(voiceLine(audioM, id, 'select', 'native'), { url: '/a/voice/native/char_a_ita/cn_021.mp3', fallback: '/a/voice/cn/char_a/cn_021.mp3' });
    assert.deepEqual(voiceLine(audioM, id, 'place', 'en'), { url: '/a/voice/cn/char_a/cn_023.mp3', fallback: null }, 'a slot the EN tree lacks: the Chinese line');
    assert.deepEqual(voiceLine(audioM, id, 'place', 'native'), { url: '/a/voice/cn/char_a/cn_023.mp3', fallback: null });

    const fw = fakeWindow();
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    const tick = () => new Promise((r) => setTimeout(r, 10));
    try {
      const a = new AudioManager({ win: fw.win, getManifest: () => ({ audio: { sfx: { ui: {}, battle: {}, units: {} }, ...audioM } }) });
      a.voiceGate = new VoiceGate({ gapMs: 60_000 });
      a.install();
      fw.fire('pointerdown');
      await tick();
      assert.equal(a.voice(id, 'place', { unitKey: 1 }), true);
      await tick();
      assert.equal(a.voice(id, 'place', { unitKey: 1 }), false, 'the battle line is on cooldown');
      assert.equal(a.previewVoice(id, 'en'), true, '试听 takes the channel and skips the cooldown');
      await tick();
      assert.equal(a.voiceNode?.url, '/a/voice/en/char_a/cn_021.mp3');
      a.setVoiceLang('cn', { [id]: 'native' });
      a.setVoiceNative(false);
      assert.equal(a.previewVoice(id), true, 'no lang: the operator\'s own choice');
      await tick();
      assert.equal(a.voiceNode?.url, '/a/voice/native/char_a_ita/cn_021.mp3');
      a.setVoiceLang('kr', {});
      a.setVoiceNative(true);
      assert.equal(a.voice(id, 'select'), true, '本土语言 wins over the global KR dub');
      await tick();
      assert.equal(a.voiceNode?.url, '/a/voice/native/char_a_ita/cn_021.mp3');
      a.volumes.muted = true;
      assert.equal(a.previewVoice(id, 'en'), false, 'muted stays silent');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('AudioManager.voice: manifest slots (a drawn array), the gate, and the battle events that drive them', async () => {
    const fw = fakeWindow();
    const origFetch = globalThis.fetch;
    const urls = [];
    globalThis.fetch = async (u) => { urls.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
    try {
      const vm = { audio: { sfx: { ui: {}, battle: {}, units: {} }, voice: {
        char_a: { start: '/v/a_start.mp3', place: ['/v/a_p1.mp3', '/v/a_p2.mp3'], skill3: '/v/a_s3.mp3', faceEnemy: '/v/a_face.mp3' },
        char_b: { place: '/v/b_p1.mp3', skill1: '/v/b_s1.mp3' },
      } } };
      const a = new AudioManager({ win: fw.win, getManifest: () => vm });
      a.voiceGate = new VoiceGate({ gapMs: 0 });   // the gap itself is covered above
      a.install();
      assert.equal(a.voice('char_a', 'place'), false, 'locked: nothing is requested');
      assert.equal(urls.length, 0);
      fw.fire('pointerdown');
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(a.voice('char_a', 'start', { unitKey: 1 }), true);
      await new Promise((r) => setTimeout(r, 10));
      assert.ok(asked(urls, '/v/a_start.mp3'));
      assert.equal(a.voice('char_b', 'place', { unitKey: 2 }), false, '部署 cannot interrupt 行动出发');
      assert.equal(a.voice('char_a', 'faceEnemy', { unitKey: 3 }), false, '接敌 cannot either');
      a._stopVoice();
      assert.equal(a.voice('char_a', 'place', { unitKey: 1 }), true, 'the channel is free again');
      await new Promise((r) => setTimeout(r, 10));
      assert.ok(asked(urls, '/v/a_p1.mp3') || asked(urls, '/v/a_p2.mp3'), 'a drawn 部署 line');
      assert.equal(a.voice('char_a', 'nope', { unitKey: 1 }), false, 'unknown slot');
      assert.equal(a.voice('char_zz', 'place', { unitKey: 1 }), false, 'unknown operator');
      a._stopVoice(); a.voiceGate.reset();
      // the battle events drive the lines: 行动出发 (the first deploy), 部署 (the rest), 行动开始, 作战中N
      a.setFieldUnits([{ id: 11, side: 'ally', spine: 'model_other', voice: 'char_a', kind: 'op', skillIndex: 2 }, { id: 12, side: 'ally', spine: 'char_b', kind: 'op' }]);
      a.handleBattleEvents([['deploy', 11]]);
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(a.voiceNode?.url, '/v/a_start.mp3', 'the first operator deployed says 行动出发');
      a.handleBattleEvents([['deploy', 12]]);
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(a.voiceNode?.url, '/v/a_start.mp3', 'a 部署 line never interrupts it (lower priority)');
      a._stopVoice(); a.voiceGate.reset();
      a.handleBattleEvents([['engage', 11], ['skill', 12, 1]]);
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(a.voiceNode?.url, '/v/a_face.mp3', '首次接敌 ⇒ 行动开始 (a 作战中 line never interrupts it)');
      a._stopVoice(); a.voiceGate.reset();
      a.handleBattleEvents([['skill', 11, 1]]);
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(a.voiceNode?.url, '/v/a_s3.mp3', '作战中N follows the unit skillIndex (2 ⇒ 作战中3)');
      a._stopVoice(); a.voiceGate.reset();
      a.handleBattleEvents([['skill', 12, 1]]);
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(a.voiceNode?.url, '/v/b_s1.mp3', 'a unit without skillIndex falls back to 作战中1');
      a._stopVoice(); a.voiceGate.reset();
      a.setFieldUnits([{ id: 21, side: 'ally', spine: 'char_a', kind: 'op' }]);
      a.handleBattleEvents([['deploy', 21]]);
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(a.voiceNode?.url, '/v/a_start.mp3', 'a new battle starts with 行动出发 again');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  for (const language of ['cn', 'jp', 'en']) test(`listener voice language ${language} selects its own URL without changing unit identity`, async () => {
    const fw = fakeWindow(), vm = { audio: { voice: { char_a: { place: '/cn/line.mp3' } }, voiceByLang: {
      cn: { char_a: { place: '/cn/line.mp3' } }, jp: { char_a: { place: '/jp/line.mp3' } }, en: { char_a: { place: '/en/line.mp3' } },
    } } };
    const a = new AudioManager({ win: fw.win, getManifest: () => vm });
    a.install(); fw.fire('pointerdown'); a.setVoiceLanguage(language);
    a._buffer = async () => ({ duration: 1.5 });
    assert.equal(a.voice('char_a', 'place', { unitKey: 1 }), true);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(a.voiceNode.url, `/${language}/line.mp3`);
    const bgm = { loopUrl: '/bgm.mp3' }; a.bgm = bgm;
    const volumes = { ...a.volumes }, token = a.voiceToken;
    assert.equal(a.setVoiceLanguage(language), false); assert.equal(a.voiceToken, token, 'same preference does not interrupt');
    a.setVoiceLanguage(language === 'cn' ? 'jp' : 'cn');
    assert.equal(a.voiceNode, null); assert.equal(a.bgm, bgm); assert.deepEqual(a.volumes, volumes);
  });

  test('missing or failed listener-language lines fall back to Chinese without freeing the voice gate early', async () => {
    const fw = fakeWindow(), vm = { audio: { voice: { char_a: { place: '/cn/line.mp3', skill1: '/cn/skill.mp3' } },
      voiceByLang: { jp: { char_a: { place: '/jp/line.mp3' } } } } };
    const a = new AudioManager({ win: fw.win, getManifest: () => vm });
    a.install(); fw.fire('pointerdown'); a.setVoiceLanguage('jp'); a.voiceGate = new VoiceGate({ gapMs: 0 });
    const asked = [];
    a._buffer = async url => { asked.push(url); return url.startsWith('/jp/') ? null : { duration: 1.5 }; };
    assert.equal(a.voice('char_a', 'place', { unitKey: 1 }), true);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(asked, ['/jp/line.mp3', '/cn/line.mp3']); assert.equal(a.voiceNode.url, '/cn/line.mp3');
    a._stopVoice(); a.voiceGate.reset(); asked.length = 0;
    assert.equal(a.voice('char_a', 'skill1', { unitKey: 1 }), true);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(asked, ['/cn/skill.mp3']);
    a._stopVoice(); a.voiceGate.reset(); asked.length = 0;
    a._buffer = async url => { asked.push(url); return null; };
    assert.equal(a.voice('char_a', 'place', { unitKey: 2 }), true);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(asked, ['/jp/line.mp3', '/cn/line.mp3']); assert.equal(a.voiceGate.playing, null);
  });

  test('changing language during decoding prevents the old line and its fallback from taking the new channel', async () => {
    const fw = fakeWindow(), vm = { audio: { voice: { char_a: { place: '/cn/line.mp3' } }, voiceByLang: {
      jp: { char_a: { place: '/jp/line.mp3' } }, en: { char_a: { place: '/en/line.mp3' } },
    } } };
    const a = new AudioManager({ win: fw.win, getManifest: () => vm });
    a.install(); fw.fire('pointerdown'); a.voiceGate = new VoiceGate({ gapMs: 0 });
    const urls = []; let releaseOld;
    a._buffer = url => {
      urls.push(url);
      return url.startsWith('/jp/') ? new Promise(resolve => { releaseOld = resolve; }) : Promise.resolve({ duration: 1.5 });
    };
    a.setVoiceLanguage('jp'); assert(a.voice('char_a', 'place', { unitKey: 1 }));
    a.setVoiceLanguage('en'); assert(a.voice('char_a', 'place', { unitKey: 2 }));
    await new Promise(resolve => setTimeout(resolve, 10));
    const gate = a.voiceGate.playing, node = a.voiceNode;
    releaseOld(null); await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(urls, ['/jp/line.mp3', '/en/line.mp3']);
    assert.equal(a.voiceNode, node); assert.equal(a.voiceNode.url, '/en/line.mp3'); assert.equal(a.voiceGate.playing, gate);
  });

  test('voice: a stale callback never frees the channel the newest line holds (review on #73)', async () => {
    const fw = fakeWindow();
    const origFetch = globalThis.fetch;
    // holds named URLs open: the first request for one waits on the promise in `held`, later ones (the manager caches a
    // decoded URL) do not. `fail` answers 404, i.e. `_buffer` resolves null.
    const held = new Map();
    const fail = new Set();
    globalThis.fetch = async (u) => {
      if (fail.has(u)) return { ok: false, status: 404 };
      const h = held.get(u);
      if (h) { held.delete(u); await h; }   // the manager caches per URL, so only the first call waits
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    };
    const tick = () => new Promise((r) => setTimeout(r, 10));
    try {
      const vm = { audio: { sfx: { ui: {}, battle: {}, units: {} }, voice: {
        char_a: { place: '/v/a_p1.mp3', start: '/v/a_start.mp3', faceEnemy: '/v/a_face.mp3', select: '/v/a_sel.mp3' },
      } } };
      const a = new AudioManager({ win: fw.win, getManifest: () => vm });
      a.voiceGate = new VoiceGate({ gapMs: 0 });   // the gap itself is covered above
      a.install();
      fw.fire('pointerdown');
      await tick();
      // 部署 (20) starts with its LOAD HELD OPEN, so 行动出发 (100) takes the channel over while it is still loading
      let openA;
      held.set('/v/a_p1.mp3', new Promise((r) => { openA = r; }));
      assert.equal(a.voice('char_a', 'place', { unitKey: 1 }), true);
      assert.equal(a.voice('char_a', 'start', { unitKey: 2 }), true, 'a higher priority line takes the channel over');
      await tick();
      assert.equal(a.voiceNode?.url, '/v/a_start.mp3', 'the replacement is on air');
      openA();                                     // the preempted line's load finally finishes
      await tick();
      assert.equal(a.voiceNode?.url, '/v/a_start.mp3', 'a stale callback never starts its own line');
      assert.equal(a.voice('char_a', 'place', { unitKey: 3 }), false, 'and never freed the channel it lost');

      // the safety timer / onended of a line that was STOPPED must not free the line that replaced it either
      const ringing = a.voiceNode;                 // 行动出发 on air
      a._stopVoice();                              // the stop path releases the gate itself and moves the token on
      assert.equal(a.voice('char_a', 'place', { unitKey: 4 }), true, 'the channel is free again');
      await tick();
      const now = a.voiceNode;
      assert.equal(now?.url, '/v/a_p1.mp3');
      ringing.src.onended?.();                     // the stopped line's own end lands late (or its safety timer fires)
      ringing.src.onended?.();                     // …and a second time, like timer + onended both firing
      await tick();
      assert.equal(a.voiceNode, now, 'the line on air is untouched');
      assert.equal(a.voice('char_a', 'place', { unitKey: 5 }), false, 'and its channel is still held');

      // a load that FAILS after the takeover (404 ⇒ null buffer): same rule
      fail.add('/v/a_sel.mp3');
      a._stopVoice();
      assert.equal(a.voice('char_a', 'select', { unitKey: 6 }), true);
      assert.equal(a.voice('char_a', 'place', { unitKey: 7 }), true, 'a higher priority line takes over while it loads');
      await tick();
      assert.equal(a.voiceNode?.url, '/v/a_p1.mp3');
      await tick();
      assert.equal(a.voice('char_a', 'place', { unitKey: 8 }), false, 'the failed load kept out of the newest line\'s way');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

// ---- fake Web Audio -------------------------------------------------------------------------------------

function fakeWindow() {
  const listeners = new Map();
  const made = { sources: 0, started: 0, stopped: 0 };
  class Param { constructor() { this.value = 1; } setValueAtTime(v) { this.value = v; } linearRampToValueAtTime(v) { this.value = v; } setTargetAtTime(v) { this.value = v; } cancelScheduledValues() {} }
  class Node { connect() {} disconnect() {} }
  class Gain extends Node { constructor() { super(); this.gain = new Param(); } }
  class Src extends Node { constructor() { super(); this.playbackRate = new Param(); made.sources++; } start() { made.started++; } stop() { made.stopped++; } }
  class Ctx {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = new Node(); }
    createGain() { return new Gain(); }
    createBufferSource() { return new Src(); }
    decodeAudioData(ab, ok) { ok({ duration: 1.5 }); }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
  }
  return {
    made,
    win: {
      AudioContext: Ctx,
      document: { hidden: false, addEventListener() {} },
      addEventListener(t, fn) { listeners.set(t, fn); },
      removeEventListener(t) { listeners.delete(t); },
    },
    fire(t) { listeners.get(t)?.(); },
  };
}

describe('AudioManager', () => {
  test('no AudioContext / no manifest: every call is a silent no-op', () => {
    const a = new AudioManager({ win: null, getManifest: () => null });
    a.install();
    a.playBgm('prep');
    a.sfx('buy');
    a.battle('enemyDie');
    assert.equal(a.unit('char_x', 'attack', 1), false);
    a.handleBattleEvents([['atk', 1, 2, 'arrow'], 'junk', null]);
    a.setVolumes({ bgm: 5, sfx: -1, muted: true });
    assert.deepEqual(a.volumes, { bgm: 1, sfx: 0, voice: 0.8, lobby: 1, muted: true });
    assert.equal(a.unlocked, false);
  });
  test('the manager has no `play`: the projectile entry point is `playProj` (render/fx/notes.js asks for it)', () => {
    // The manager's battle surface is playProj / unit / battle / sfx / voice — `play` is NOT one of them. notes.js
    // `_noteFired` used to call `api.play(k, …)` and bail on a `typeof api.play` guard, so every 音符 launch was silent
    // in a real client while a `play`-only test fake kept the render suite green (owner report 「天赋发射的音符没有诞生音效」;
    // measured in a browser: 21 talent notes born, 0 launch requests). Pin the surface: this test fails the moment
    // someone renames/removes playProj or adds a `play` that would re-open the divergence.
    assert.equal(typeof AudioManager.prototype.play, 'undefined', 'no generic `play` — notes.js must ask for playProj');
    assert.equal(typeof AudioManager.prototype.playProj, 'function', 'the projectile launch entry point');
    const a = new AudioManager({ win: null, getManifest: () => manifest });
    a.ctx = {};
    const played = [];
    a._play = (url, o) => { played.push([url, o.unitKey]); };
    assert.equal(a.playProj('note', { unitId: 1, unit: 'char_4182_oblvns' }), true);
    assert.deepEqual(played, [[manifest.audio.sfx.proj.note.born, 'proj:note:1']], 'playProj is what the renderer must reach');
  });
  test('unlocks on the first gesture, then plays BGM and SFX from the manifest', async () => {
    const fw = fakeWindow();
    const origFetch = globalThis.fetch;
    const urls = [];
    globalThis.fetch = async (u) => { urls.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
    try {
      const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
      a.install();
      a.playBgm('prep'); // remembered while locked
      assert.equal(urls.length, 0);
      fw.fire('pointerdown');
      assert.equal(a.unlocked, true);
      await new Promise((r) => setTimeout(r, 10));
      assert.ok(asked(urls, manifest.audio.bgm.prep.loop), 'BGM fetched after unlock');
      a.sfx('buy');
      a.sfx('nonexistent');
      await new Promise((r) => setTimeout(r, 10));
      assert.ok(asked(urls, manifest.audio.sfx.ui.buy));
      // same loop URL ⇒ no restart
      const before = fw.made.started;
      a.playBgm('combat');
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(fw.made.started, before, 'prep → combat shares the loop');
      // battle events map to unit sounds (UnitInfo.spine = char id)
      const charId = Object.keys(manifest.audio.sfx.units).find((k) => k.startsWith('char_') && normalAttackSfx(k, manifest.audio.sfx.units[k].attack));
      a.setFieldUnits([{ id: 1, side: 'ally', spine: charId }, { id: 2, side: 'enemy', spine: 'enemy_nope' }]);
      a.handleBattleEvents([['atk', 1, 2, 'arrow'], ['dmg', 2, 100, 'phys'], ['die', 2], ['spawn', { id: 3, side: 'enemy', spine: 'x' }], ['bounty', 'p', 1]]);
      await new Promise((r) => setTimeout(r, 10));
      assert.ok(asked(urls, manifest.audio.sfx.units[charId].attack));
      assert.ok(asked(urls, manifest.audio.sfx.battle.enemyDie), 'fallback death sound');
      assert.ok(a.limiter.active <= a.limiter.maxVoices);
      a.setVolumes({ muted: true });
      const n = urls.length;
      a.sfx('refresh');
      assert.equal(urls.length, n, 'muted ⇒ nothing requested');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
  test('休整期 / 作战 picks (bgmChoice.js): which keys follow a pick, the picked track, official otherwise', () => {
    const b = manifest.audio.bgm;
    assert.deepEqual([bgmChoiceKind('prep'), bgmChoiceKind('combat'), bgmChoiceKind('combat:0'), bgmChoiceKind('combat:1')], ['prep', 'combat', 'combat', 'combat']);
    for (const k of ['lobby', 'unite', 'boss', 'boss:boss_4', null]) assert.equal(bgmChoiceKind(k), null, String(k));
    assert.equal(pickedBgm(manifest, 'prep', { prep: 'official' }), null, 'official: the manifest track (resolveBgm)');
    assert.equal(pickedBgm(manifest, 'prep', null), null);
    const local = { prep: 'blob:prep-file', combat: null };
    assert.deepEqual(pickedBgm(manifest, 'prep', { prep: 'custom' }, null, local), { intro: null, loop: 'blob:prep-file', choice: 'blob:prep-file', local: true });
    // 对局音乐 lists the same local library as 大厅音乐 (owner, 2026-10-20): the pick is `custom:<id>` and setBgmLocal
    // carries that id, so only the entry the kind actually picked plays
    const lib = { prep: { id: 'abc', url: 'blob:lib-a' }, combat: { id: 'def', url: 'blob:lib-b' } };
    assert.match(sanitizeBgmChoice('custom:abc'), /^custom:abc$/);
    assert.equal(sanitizeBgmChoice('custom:'), 'official');
    assert.deepEqual(pickedBgm(manifest, 'prep', { prep: 'custom:abc' }, null, lib), { intro: null, loop: 'blob:lib-a', choice: 'blob:lib-a', local: true });
    assert.equal(pickedBgm(manifest, 'prep', { prep: 'custom:zzz' }, null, lib), null, 'another entry: official');
    assert.deepEqual(pickedBgm(manifest, 'combat:0', { combat: 'custom:def' }, null, lib)?.loop, 'blob:lib-b');
    assert.equal(pickedBgm(manifest, 'combat:0', { combat: 'custom' }, null, local), null, '自选曲 without a file: official');
    assert.equal(pickedBgm(manifest, 'prep', { prep: 'custom' }), null);
    assert.equal(pickedBgm(manifest, 'prep', { prep: 'custom' }, new Set(['blob:prep-file']), local), null, 'a file that did not decode: official');
    assert.deepEqual(pickedBgm(manifest, 'combat:1', { prep: 'custom', combat: 'knight' }, null, local), { intro: b.combatAlts[0].intro ?? null, loop: b.combatAlts[0].loop, choice: 'knight' });
    assert.equal(pickedBgm(manifest, 'combat:1', { prep: 'knight' }), null, 'the 作战 pick, not the 休整期 one');
    assert.equal(pickedBgm(manifest, 'unite', { prep: 'knight', combat: 'custom' }, null, { prep: 'blob:a', combat: 'blob:b' }), null, '联防 keeps its own track');
    assert.equal(pickedBgm(manifest, 'boss:boss_4', { combat: 'knight' }), null, 'so do the boss phases');
    assert.equal(pickedBgm(manifest, 'prep', { prep: 'knight' }, new Set(['knight'])), null, 'a pick that failed to load: official');
    assert.equal(pickedBgm(manifest, 'prep', { prep: 'nope' }), null, 'an unknown pick: official');
    assert.equal(pickedBgm({ audio: { bgm: {} } }, 'prep', { prep: 'knight' }), null, 'a manifest without that track: official');
    assert.equal(sanitizeBgmChoice('knight'), 'knight');
    assert.equal(sanitizeBgmChoice('x'), 'official');
    assert.deepEqual([DEFAULT_SETTINGS.bgmPrep, DEFAULT_SETTINGS.bgmCombat], ['official', 'official']);
    assert.deepEqual([sanitizeSettings({ bgmPrep: 'custom', bgmCombat: 'bogus' }).bgmPrep, sanitizeSettings({ bgmCombat: 'bogus' }).bgmCombat], ['custom', 'official']);
    assert.deepEqual(pickedBgm(manifest, 'prep', { prep: 'major' }), { intro: null, loop: MAJOR_BGM_URL, choice: 'major' }, '上海Major: no manifest entry');
    assert.deepEqual(pickedBgm(manifest, 'combat:0', { combat: 'major' })?.loop, MAJOR_BGM_URL);
    assert.deepEqual(BGM_CHOICES.slice(0, 2), ['official', 'major'], '官方 first, then 上海Major');
    assert.equal(BGM_CHOICES.at(-1), 'custom');
    assert.ok(BGM_CHOICES.every((id) => id === 'official' || id === 'custom' || pickedBgm(manifest, 'prep', { prep: id })), 'every manifest pick resolves');
  });
  test('the 大厅音乐 pick that cannot be fetched falls back to the lobby track once — never restarts in a loop', async () => {
    // 「一切歌就卡住」 (owner report 2026-10-20): a pick whose file is missing (上海Major is host-provided and absent in
    // this repo) used to be resolved again and again by _startBgm's failure path, each round fetching + decoding.
    const fw = fakeWindow();
    const origFetch = globalThis.fetch;
    const urls = [];
    globalThis.fetch = async (u) => { urls.push(String(u)); const bad = String(u).includes('sp_major_pause'); return { ok: !bad, status: bad ? 404 : 200, arrayBuffer: async () => new ArrayBuffer(bad ? 0 : 8) }; };
    const tick = () => new Promise((r) => setTimeout(r, 10));
    const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await tick(); return fn(); };
    const b = manifest.audio.bgm;
    try {
      const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
      a.install();
      a.setLobbyPick('major');
      a.playBgm('lobby');
      fw.fire('pointerdown');
      a.ctx.decodeAudioData = (ab, ok) => ok({ duration: 1.5 });
      await until(() => urls.length > 0);
      assert.ok(await until(() => a.bgm?.loopUrl === b.lobby.loop), 'the lobby keeps its own music');
      const attempts = urls.filter((u) => u.includes('sp_major_pause')).length;
      await new Promise((r) => setTimeout(r, 120));
      assert.equal(urls.filter((u) => u.includes('sp_major_pause')).length, attempts, 'no restart after the failure');
      assert.ok(attempts <= 4, `the failing file is asked for a bounded number of times (${attempts})`);
      assert.ok(a.bgmChoiceFailed.has('major'), 'the failure is remembered');
      // an explicit pick retries it (a host that adds the file back)
      a.setLobbyPick('major');
      assert.equal(a.bgmChoiceFailed.has('major'), false);
    } finally { globalThis.fetch = origFetch; }
  });
  test('the picks play: 休整期 / 作战 follow them at once, 联防 does not; 自选曲 plays the file; one that does not decode plays the official track', async () => {
    const fw = fakeWindow();
    const origFetch = globalThis.fetch;
    const urls = [];
    // blob:bad is no audio: an empty body, which the context below fails to decode
    globalThis.fetch = async (u) => { urls.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(String(u) === 'blob:bad' ? 0 : 8) }; };
    const tick = () => new Promise((r) => setTimeout(r, 10));
    const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await tick(); return fn(); };
    const b = manifest.audio.bgm;
    try {
      const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
      a.install();
      a.setBgmChoice({ prep: 'knight', combat: 'official' });
      a.playBgm('prep');
      fw.fire('pointerdown');
      a.ctx.decodeAudioData = (ab, ok, fail) => (ab.byteLength ? ok({ duration: 1.5 }) : fail(new Error('no audio')));
      assert.ok(await until(() => a.bgm?.loopUrl === b.combatAlts[0].loop), '休整期 plays the picked 骑士之日');
      a.playBgm('combat:1');
      assert.ok(await until(() => a.bgm?.loopUrl === b.combatAlts[1].loop), '作战 official: the round table (无畏者)');
      a.setBgmChoice({ prep: 'knight', combat: 'lobby' });
      assert.ok(await until(() => a.bgm?.loopUrl === b.lobby.loop), 'a new 作战 pick plays at once');
      a.playBgm('unite');
      assert.ok(await until(() => a.bgm?.loopUrl === b.unite.loop), '联防 keeps its own track');
      a.setBgmChoice({ prep: 'custom', combat: 'lobby' });
      a.playBgm('prep');
      assert.ok(await until(() => a.bgm?.loopUrl === b.prep.loop), '自选曲 without a file: the official 休整期 track');
      a.setBgmLocal('prep', 'blob:good');
      assert.ok(await until(() => a.bgm?.loopUrl === 'blob:good'), 'a chosen file plays at once');
      assert.equal(a.buffers.has('blob:good'), false, 'decoded outside the LRU cache');
      a.setBgmLocal('prep', 'blob:bad');
      assert.ok(await until(() => a.bgm?.loopUrl === b.prep.loop), 'a file that does not decode: the official track');
      assert.ok(a.bgmChoiceFailed.has('blob:bad'));
      const n = urls.length;
      a.playBgm('combat:0'); a.playBgm('prep');
      await tick(); await tick();
      assert.ok(!urls.slice(n).includes('blob:bad'), 'not asked again on this page');
      a.setBgmLocal('prep', 'blob:good');
      assert.ok(await until(() => a.bgm?.loopUrl === 'blob:good'), 'another file plays again');
      a.setBgmChoice({ prep: 'major', combat: 'lobby' });
      assert.ok(await until(() => a.bgm?.loopUrl === MAJOR_BGM_URL), '上海Major plays where the host has it');
      // a host without the 上海Major file: 404 on /media/, its OpenI retry and the original URL — the official track
      globalThis.fetch = async (u) => { urls.push(u); return /sp_major_pause/.test(String(u)) ? { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) } : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
      const fw2 = fakeWindow();
      const c = new AudioManager({ win: fw2.win, getManifest: () => manifest });
      c.install();
      c.setBgmChoice({ prep: 'major', combat: 'official' });
      c.playBgm('prep');
      fw2.fire('pointerdown');
      c.ctx.decodeAudioData = (ab, ok) => ok({ duration: 1.5 });
      assert.ok(await until(() => c.bgm?.loopUrl === b.prep.loop), 'a missing 上海Major file: the official 休整期 track');
      assert.ok(c.bgmChoiceFailed.has('major'));
    } finally {
      globalThis.fetch = origFetch;
    }
  });
  test('BGM is not downloaded while the music is muted or at volume 0; the wanted track starts once it is audible', async () => {
    const fw = fakeWindow();
    const origFetch = globalThis.fetch;
    const urls = [];
    globalThis.fetch = async (u) => { urls.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
    const tick = () => new Promise((r) => setTimeout(r, 10));
    const lobby = manifest.audio.bgm.lobby.loop;
    const prep = manifest.audio.bgm.prep.loop;
    assert.notEqual(lobby, prep, 'premise: two different loops');
    try {
      const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
      a.setVolumes({ muted: true });
      a.install();
      a.playBgm('lobby');
      fw.fire('pointerdown');
      await tick();
      assert.equal(a.unlocked, true);
      assert.equal(a.bgmSilent, true);
      assert.ok(!asked(urls, lobby) && !asked(urls, manifest.audio.bgm.lobby.intro), 'muted: nothing fetched at unlock');
      a.playBgm('prep');
      await tick();
      assert.ok(!asked(urls, prep), 'muted: a phase change fetches nothing');
      assert.equal(a.wantBgm, 'prep', 'the wanted track is remembered');
      a.setVolumes({ muted: false });
      await tick();
      assert.ok(asked(urls, prep), 'unmuted: the track the screen wants now is fetched');
      assert.ok(!asked(urls, lobby), 'never the track wanted before');
      assert.equal(a.bgm?.loopUrl, prep);

      // BGM volume 0 is silent too: another track stops and is not fetched; SFX keep playing
      a.setVolumes({ bgm: 0 });
      a.playBgm('lobby');
      await tick();
      assert.ok(!asked(urls, lobby), 'BGM volume 0: no download');
      assert.equal(a.bgm, null, 'the other track stopped');
      a.sfx('buy');
      await tick();
      assert.ok(asked(urls, manifest.audio.sfx.ui.buy), 'SFX are not gated by the BGM volume');
      a.setVolumes({ bgm: 0.5 });
      await tick();
      assert.ok(asked(urls, lobby), 'audible again: fetched');
      assert.equal(a.bgm?.loopUrl, lobby);

      // the loop that already plays keeps playing through a silent phase change, and is not fetched again
      a.setVolumes({ muted: true });
      const n = urls.length;
      const started = fw.made.started;
      a.playBgm('lobby');
      a.setVolumes({ muted: false });
      await tick();
      assert.equal(a.bgm?.loopUrl, lobby);
      assert.equal(urls.length, n, 'no new request');
      assert.equal(fw.made.started, started, 'no restart');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
  test('fetch failures are swallowed', async () => {
    const fw = fakeWindow();
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('offline'); };
    const origWarn = console.warn;
    let warns = 0;
    console.warn = () => { warns++; };
    try {
      const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
      a.install();
      fw.fire('keydown');
      a.playBgm('lobby');
      a.sfx('buy');
      a.sfx('buy');
      await new Promise((r) => setTimeout(r, 20));
      assert.ok(warns >= 1);
    } finally {
      globalThis.fetch = origFetch;
      console.warn = origWarn;
    }
  });
  test('a served manifest\'s content-hashed audio URL is fetched as /media/~<hash>/…, falling back to the hashed .mp3 URL', async () => {
    const H = '0123456789abcdef';
    const raw = manifest.audio.bgm.prep.loop.replace(/^\/assets\//, `/assets/~${H}/`);
    const served = { ...manifest, audio: { ...manifest.audio, bgm: { ...manifest.audio.bgm, prep: { loop: raw } } } };
    const fw = fakeWindow();
    const urls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (u) => { urls.push(u); return u.startsWith('/media/') ? { ok: false, status: 404 } : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
    try {
      const a = new AudioManager({ win: fw.win, getManifest: () => served });
      a.install();
      fw.fire('pointerdown');
      a.playBgm('prep');
      await new Promise((r) => setTimeout(r, 20));
      assert.deepEqual(urls, [raw.replace(/^\/assets\/(~[0-9a-f]{16})\/audio\/(.+)\.mp3$/, '/media/$1/$2'), raw]);
      assert.match(urls[0], new RegExp(`^/media/~${H}/bgm/`));
      assert.equal(a.bgm?.loopUrl, raw);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
  test('音频先走 /media/；OpenI 也缺失时保留原地址静态托管兼容', async () => {
    const raw = manifest.audio.bgm.prep.loop;
    const media = mediaUrl(raw);
    assert.notEqual(media, raw, '前提：manifest 地址确实会被换算成 /media/ 路径');

    // 第一发 404：必须看到 /media/ 在前、原地址在后，两者都请求过
    {
      const fw = fakeWindow();
      const urls = [];
      const origFetch = globalThis.fetch;
      globalThis.fetch = async (u) => {
        urls.push(u);
        return u.startsWith(media) ? { ok: false, status: 404 } : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
      };
      try {
        const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
        a.install();
        fw.fire('pointerdown');
        a.playBgm('prep');
        await new Promise((r) => setTimeout(r, 25));
        const first = urls.indexOf(media);
        const fallback = urls.indexOf(raw);
        assert.ok(first !== -1, '先试无扩展名路径');
        assert.ok(fallback !== -1, '404 后回退到原地址');
        assert.ok(first < fallback, '顺序必须是先 /media/ 再原地址');
      } finally { globalThis.fetch = origFetch; }
    }

    // 第一发 200：不该再去碰带扩展名的地址（否则白白多一次请求，也正是 IDM 会拦的那个 URL）
    {
      const fw = fakeWindow();
      const urls = [];
      const origFetch = globalThis.fetch;
      globalThis.fetch = async (u) => { urls.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
      try {
        const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
        a.install();
        fw.fire('pointerdown');
        a.playBgm('prep');
        await new Promise((r) => setTimeout(r, 25));
        assert.ok(urls.includes(media), '走了 /media/');
        assert.ok(!urls.includes(raw), '/media/ 成功就不该再请求 .mp3 地址');
      } finally { globalThis.fetch = origFetch; }
    }

    // 第一发 200 但内容不是音频：有些静态托管对不存在的路径回 200 + index.html，解码会静默失败，也要回退。
    {
      const fw = fakeWindow();
      const urls = [];
      let cancelled = 0;
      const origFetch = globalThis.fetch;
      globalThis.fetch = async (u) => {
        urls.push(u);
        if (!u.startsWith(media)) return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
        return {
          ok: true,
          status: 200,
          headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
          body: { cancel: async () => { cancelled += 1; } },
          arrayBuffer: async () => new ArrayBuffer(8),
        };
      };
      try {
        const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
        a.install();
        fw.fire('pointerdown');
        a.playBgm('prep');
        await new Promise((r) => setTimeout(r, 25));
        assert.ok(urls.includes(raw), '内容不是音频时回退到原地址');
        assert.equal(cancelled, 2, '丢掉两个用不上的响应，别把连接挂着');
        assert.ok(urls.includes(media + '?sp_source=openi'), '先尝试同版本 OpenI');
      } finally { globalThis.fetch = origFetch; }
    }

    // /media/ 直接给出 audio/*（服务端真实行为）：不回退，也不去 cancel 一个能用的响应
    {
      const fw = fakeWindow();
      const urls = [];
      let cancelled = 0;
      const origFetch = globalThis.fetch;
      globalThis.fetch = async (u) => {
        urls.push(u);
        return {
          ok: true,
          status: 200,
          headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'audio/mpeg' : null) },
          body: { cancel: async () => { cancelled += 1; } },
          arrayBuffer: async () => new ArrayBuffer(8),
        };
      };
      try {
        const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
        a.install();
        fw.fire('pointerdown');
        a.playBgm('prep');
        await new Promise((r) => setTimeout(r, 25));
        assert.ok(urls.includes(media));
        assert.ok(!urls.includes(raw), 'audio/* 就是成功，不该再回退');
        assert.equal(cancelled, 0);
      } finally { globalThis.fetch = origFetch; }
    }
  });

  for (const type of ['application/octet-stream', 'binary/octet-stream', ' Application/Octet-Stream ; charset=binary', 'BINARY/OCTET-STREAM']) test(`generic audio media ${type} decodes without cancelling or requesting the raw URL`, async () => {
    const fw = fakeWindow(), raw = manifest.audio.bgm.prep.loop, media = mediaUrl(raw), urls = [];
    const origFetch = globalThis.fetch;
    let cancelled = 0;
    globalThis.fetch = async url => {
      urls.push(url);
      return { ok: true, headers: { get: () => type }, body: { cancel: async () => { cancelled++; } }, arrayBuffer: async () => new ArrayBuffer(8) };
    };
    try {
      const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
      a.ctx = new fw.win.AudioContext();
      assert.equal((await a._buffer(raw)).duration, 1.5);
      assert.deepEqual(urls, [media]);
      assert.equal(cancelled, 0);
    } finally { globalThis.fetch = origFetch; }
  });

  for (const type of ['text/html; charset=utf-8', 'application/json', 'image/png', 'application/octet-streamx']) test(`non-audio media ${type} cancels and tries OpenI before the raw compatibility URL`, async () => {
    const fw = fakeWindow(), raw = manifest.audio.bgm.prep.loop, media = mediaUrl(raw), urls = [];
    const origFetch = globalThis.fetch;
    let cancelled = 0;
    globalThis.fetch = async url => {
      urls.push(url);
      return url === media
        ? { ok: true, headers: { get: () => type }, body: { cancel: async () => { cancelled++; } }, arrayBuffer: async () => { throw new Error('the rejected media body must not be read'); } }
        : { ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: async () => new ArrayBuffer(8) };
    };
    try {
      const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
      a.ctx = new fw.win.AudioContext();
      assert.equal((await a._buffer(raw)).duration, 1.5);
      assert.deepEqual(urls, [media, media + '?sp_source=openi']);
      assert.equal(cancelled, 1);
    } finally { globalThis.fetch = origFetch; }
  });

  for (const type of ['application/octet-stream', 'binary/octet-stream']) test(`failed ${type} voice decoding still falls back to Chinese`, async () => {
    const fw = fakeWindow(), cn = '/assets/audio/voice/cn/char_a/cn_001.mp3', jp = '/assets/audio/voice/jp/char_a/cn_001.mp3', urls = [];
    const vm = { audio: { voice: { char_a: { place: cn } }, voiceByLang: { cn: { char_a: { place: cn } }, jp: { char_a: { place: jp } } } } };
    const origFetch = globalThis.fetch;
    globalThis.fetch = async url => {
      urls.push(url);
      return { ok: true, headers: { get: () => type }, arrayBuffer: async () => Uint8Array.of(url.includes('/jp/') ? 1 : 0).buffer };
    };
    try {
      const a = new AudioManager({ win: fw.win, getManifest: () => vm, random: () => 0 });
      a.install(); fw.fire('pointerdown'); a.setVoiceLanguage('jp'); a.voiceGate = new VoiceGate({ gapMs: 0 });
      a.ctx.decodeAudioData = (body, ok, fail) => new Uint8Array(body)[0] === 1 ? fail(new Error('invalid recording')) : ok({ duration: 1.5 });
      assert.equal(a.voice('char_a', 'place', { unitKey: 1 }), true);
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.deepEqual(urls, [mediaUrl(jp), mediaUrl(jp) + '?sp_source=openi', mediaUrl(cn)]);
      assert.equal(a.voiceNode.url, cn);
      assert.equal(fw.made.started, 1);
    } finally { globalThis.fetch = origFetch; }
  });

  // 「技能音效有时候不触发」 (PR #292 by @LimitlessHPPK): the sim emits the cast of a deployment that fires inside its own first
  // tick (`initSp` already at `spCost`, 宴's deploy-timed skill, 银灰 S3 真银斩 …) before the unit's `['spawn', unitInfo]` — the
  // same batch, or the next — so `handleBattleEvents` used to skip the cue for good: that first cast was silent and every
  // later one played. The cue is held and answered once, when the unit is tracked (`_track`); it never outlives its field.
  test('a cast that arrives before its unit is known is held and plays once when the unit is tracked', () => {
    const vm = { audio: { sfx: { ui: {}, battle: {}, units: { char_a: { skill: '/s/a_skill.mp3' } } },
      voice: { char_a: { skill3: '/v/a_s3.mp3' } } } };
    const a = new AudioManager({ win: null, getManifest: () => vm });
    a.ctx = {};                                   // unlocked: every path below is the real one
    const played = [], voiced = [];
    a._play = (url) => { played.push(url); };     // the cue itself, and the 作战中 line that goes with it
    a.voice = (charId, slot, o) => { voiced.push([charId, slot, o.unitKey]); return true; };
    /** UnitInfo of the operator `char_a` (spine = the sfx.units key; skillIndex picks its 作战中N slot). */
    const info = (id, skillIndex) => ({ id, side: 'ally', spine: 'char_a', kind: 'op', skillIndex });

    // (1) the sim's order inside one batch: the cast, then the unit's spawn — the cast waits, then sounds once
    a.handleBattleEvents([['skill', 8, 1]]);
    assert.deepEqual(played, [], 'nothing to play yet: the unit is unknown');
    a.handleBattleEvents([['spawn', info(8, 2)]]);
    assert.deepEqual(played, ['/s/a_skill.mp3'], 'the held cast plays as soon as the unit is tracked');
    assert.deepEqual(voiced, [['char_a', 'skill3', 8]], 'with the 作战中N line its skillIndex picks');
    a.handleBattleEvents([['skill', 7, 1], ['atk', 7, 8, 'none'], ['spawn', info(7, 0)]]);
    assert.equal(played.length, 2, 'the same batch: the cast waits for the spawn of its own batch');
    assert.deepEqual(voiced.at(-1), ['char_a', 'skill1', 7]);
    // (2) once: a unit that is told about again (a repeated spawn) never replays it; a later cast plays directly
    a.handleBattleEvents([['spawn', info(8, 2)], ['spawn', info(7, 0)]]);
    assert.equal(played.length, 2, 'no second cue for the held cast');
    a.handleBattleEvents([['skill', 8, 1]]);
    assert.equal(played.length, 3, 'a later cast of a known unit plays through');
    assert.deepEqual(voiced.at(-1), ['char_a', 'skill3', 8], 'and sounds the same as the replayed one');
    // (3) skill off (`['skill', id, 0]`) is no cast: nothing is held for it
    a.handleBattleEvents([['skill', 9, 0]]);
    a.handleBattleEvents([['spawn', info(9, 0)]]);
    assert.equal(played.length, 3, 'the off event holds nothing');
    assert.equal(a.pendingSkill.size, 0);
  });

  test('a held cast does not outlive its field: a unit of the next field that shares its id does not sound it', () => {
    const vm = { audio: { sfx: { ui: {}, battle: {}, units: { char_a: { skill: '/s/a_skill.mp3' } } }, voice: {} } };
    const a = new AudioManager({ win: null, getManifest: () => vm });
    a.ctx = {};
    const played = [];
    a._play = (url) => { played.push(url); };
    a.voice = () => true;
    const info = (id) => ({ id, side: 'ally', spine: 'char_a', kind: 'op' });
    a.handleBattleEvents([['skill', 9, 1]]);          // a cast whose unit never appeared on this field
    assert.equal(a.pendingSkill.size, 1);
    a.setFieldUnits([info(9)]);                       // another battle: unit ids are per battle, 9 is a different unit
    assert.equal(a.pendingSkill.size, 0, 'the field change drops the hold');
    a.handleBattleEvents([['spawn', info(9)]]);
    assert.deepEqual(played, [], 'the old field\'s cast never sounds in the new one');
    // the hold is bounded: casts of units that never appear cannot pile up
    for (let id = 100; id < 400; id++) a.handleBattleEvents([['skill', id, 1]]);
    assert.ok(a.pendingSkill.size <= 64, `${a.pendingSkill.size} holds`);
    assert.ok(a.pendingSkill.has(399) && !a.pendingSkill.has(100), 'the oldest holds go first');
  });

  test('a real battle: the deploy-tick cast of a deployment-activated skill is heard, once', () => {
    // The reported shape in 0.2.0's own sim: 宴's kit activates its skill on deployment (activateOnDeploy, PR #109), and
    // `sim/battle/deploy.js` runs `skill.reset()` (→ `activate` → `['skill', id, 1]`) BEFORE it emits
    // `['spawn', unitInfo]` — three events earlier in 宴's case (a status and an fx come between). Fed to the audio as
    // the socket delivers it, that cast used to be dropped for good.
    const chessId = 'chess_char_1_18_a';   // 宴 (char_337_utage): a deploy-timed skill with a skill sound
    const h = makeBattle({ seed: 7, autoFinish: false, timeLimit: 5, units: [{ chessId, row: 9, col: 5 }] });
    h.step(3);
    const ev = h.events;
    const iCast = ev.findIndex((e) => e[0] === 'skill' && e[2]);
    const iSpawn = ev.findIndex((e) => e[0] === 'spawn');
    assert.ok(iCast >= 0 && iSpawn > iCast, `the sim emits the deploy-tick cast before the unit info (${iCast} < ${iSpawn})`);
    // the cast's sound, resolved as `unit()` does (the equipped skill's own ON_SKILL_START file, else its `skill`)
    const info = ev[iSpawn][1];
    const rec = manifest.audio.sfx.units[info.spine];
    const url = (Number.isInteger(info.skillIndex) && rec?.skills ? rec.skills[info.skillIndex] : null) ?? rec?.skill;
    assert.ok(typeof url === 'string', `前提：${info.spine} 有技能音效`);
    const played = [];
    const a = new AudioManager({ win: null, getManifest: () => manifest });
    a.ctx = {};
    a._play = (u) => { played.push(u); };
    a.voice = () => true;
    a.handleBattleEvents(ev);
    assert.equal(played.filter((u) => u === url).length, 1, 'the cast of the deployment is heard, exactly once');
  });

  /**
   * Owner report 「场上有两只丰川祥子时，似乎只播放其中一只的音效」. Two units of one character share every sound FILE
   * (`sfx.units[charId].attack`, and now `sfx.proj.note.born`), and one socket message carries both units' events — so
   * both read the same `performance.now()`. A single global "one URL per 45 ms" stamp let the first unit's copy block
   * the second unit's, every single time. `_play({ now })` is the batch's own reading (see audio.js); only that one
   * number is faked here — the limiter, the manifest resolution and the manager are the real ones.
   */

  /**
   * Owner report 「场上有两只丰川祥子时，似乎只播放其中一只的音效」. Two units of one character share every sound FILE
   * (`sfx.units[charId].attack`, and `sfx.proj.note.born`), and one socket message carries both units' events — so
   * both read the same `performance.now()`.
   *
   * sakiko 0.1.4 answered that report by keying the url gap per unit, so both copies played. dust 0.2.5 keeps the gap
   * GLOBAL (`SfxLimiter.lastByUrl`, one map for every caller — see the `per-unit cooldown and per-url gap` test above,
   * which pins `tryAcquire(10, 'u2', 'x') === false`). This test asserts dust's reading: the first copy rings, the
   * second waits out the gap. That is a knowing divergence — see mods/sakiko/README.md §「与 sakiko 的分歧」.
   *
   * `_play` reads its own clock, so no timestamp is faked here: every call in one batch already shares one reading.
   */
  test('two 丰川祥子 on one field: the first copy rings, the second waits for the GLOBAL gap (dust contract)', async () => {
    const CHAR = 'char_4182_oblvns';
    const her = manifest.audio.sfx.units[CHAR];
    const born = manifest.audio.sfx.proj?.note?.born;
    assert.ok(her?.attack && born, '前提：清单里有她的 attack 与音符发射音');
    const fw = fakeWindow();
    const urls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (u) => { urls.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
    const settle = () => new Promise((r) => setTimeout(r, 5));
    try {
      const a = new AudioManager({ win: fw.win, getManifest: () => manifest, random: () => 0 });
      a.install();
      fw.fire('pointerdown');
      assert.ok(a.unlocked, '前提：音频已解锁，下面的路径才是真实的播放路径');
      a.setFieldUnits([
        { id: 1, side: 'ally', kind: 'chess', spine: CHAR }, { id: 5, side: 'ally', kind: 'chess', spine: CHAR },
        { id: 2, side: 'enemy', kind: 'enemy', spine: 'enemy_1007_slime' }, { id: 6, side: 'enemy', kind: 'enemy', spine: 'enemy_1007_slime' },
      ]);
      // both attacks arrive in ONE batch: 发出音符 — the same reading for both, exactly like one socket message
      assert.equal(a.unit(CHAR, 'attack', 1), true);
      // `unit()` answers "such a sound exists", not "it played" (see audio.js), so the start count is the evidence
      assert.equal(a.unit(CHAR, 'attack', 5), true, '…and the manifest carries her attack cue for unit 5 too');
      await settle();
      assert.equal(fw.made.started, 1, 'only the FIRST copy started: the gap is global, not per unit');
      assert.equal(askedCount(urls, her.attack), 1, '两只共用同一个文件：one fetch serves both calls (the buffer is cached)');
      assert.equal(a.limiter.activeByUrl.get(her.attack), 1, 'one copy on air');
      assert.ok(a.limiter.lastByUrl.get(her.attack) > 0, 'the copy that played stamped the shared map');
      assert.ok(a.limiter.lastByUnit.get('1:attack') > 0, 'unit 1 also carries its own per-unit stamp');
      assert.equal(a.limiter.lastByUnit.get('5:attack'), undefined, 'unit 5 never acquired, so it has no per-unit state');
      // the same unit again at once: refused as well (a unit never flams with itself)
      assert.equal(a.unit(CHAR, 'attack', 1), true, 'the manifest still carries her attack cue …');
      await settle();
      assert.equal(fw.made.started, 1, '… but no second copy started: its own cooldown holds it back');
      // …and the very same rule for the note she fires: two units, one file, one launch
      assert.equal(a.playProj('note', { unitId: 1, unit: CHAR }), true);
      assert.equal(a.playProj('note', { unitId: 5, unit: CHAR }), true);
      await settle();
      assert.equal(fw.made.started, 2, 'two notes, one shared file, one global gap ⇒ one launch sound');
      assert.ok(a.limiter.lastByUrl.get(born) > 0, 'the launch stamped the same global map');
      assert.ok(a.limiter.active <= a.limiter.maxVoices);
    } finally { globalThis.fetch = origFetch; }
  });
});

// user playtest #4 item 6: 纯烬艾雅法拉's skill sound rang outside her skill — her manifest `hit` is her S3 impact
// (p_imp_gtshpbrnch_s, the audio bank ON_ABILITY_HIT.attack.2) and every damage on an ally she had just healed was
// attributed to her ('atk' healer → ally), so ordinary enemy hits on healed allies played it.
describe('impact sounds (user playtest #4 item 6)', () => {
  const AGOAT2 = 'char_1016_agoat2';
  async function rig(units) {
    const fw = fakeWindow();
    const urls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (u) => { urls.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
    const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
    a.install();
    fw.fire('pointerdown');
    a.setFieldUnits(units);
    const settle = () => new Promise((r) => setTimeout(r, 5));
    return { a, urls, settle, restore: () => { globalThis.fetch = origFetch; } };
  }

  test('an operator never plays a skill-mode file (_d / _h / _s) as its normal attack or impact; enemies keep their _h', () => {
    const u = manifest.audio.sfx.units;
    // her impact: the S3 file (built before tools/assets/audio.mjs preferred normal-mode banks) is refused, the normal
    // one (projectile_chr_agoat2: p_imp_gtshpbrnch_n) plays
    assert.equal(normalAttackSfx(AGOAT2, '/assets/audio/sfx/player/p_imp/p_imp_gtshpbrnch_s.mp3'), false);
    assert.equal(normalAttackSfx(AGOAT2, '/assets/audio/sfx/player/p_imp/p_imp_gtshpbrnch_n.mp3'), true);
    if (u[AGOAT2].hit) assert.equal(normalAttackSfx(AGOAT2, u[AGOAT2].hit), !/_s\.mp3$/.test(u[AGOAT2].hit));
    assert.equal(normalAttackSfx(AGOAT2, u[AGOAT2].attack), true, 'p_atk_gtshpbrnch_n');
    assert.equal(normalAttackSfx('char_1014_nearl2', '/x/p_atk_goldspear_s.mp3'), false);
    assert.equal(normalAttackSfx('char_1028_texas2', '/x/p_imp_reticentsword_h.mp3'), false);
    assert.equal(normalAttackSfx('char_1045_svash2', '/x/p_atk_snwlprdg_n1.mp3'), true);
    assert.equal(normalAttackSfx('enemy_1045_hammer', '/x/e_atk_bigaxe_h.mp3'), true, 'enemy _h = heavy weapon');
    assert.equal(normalAttackSfx('char_x', null), false);
  });

  test('a heal never makes the healer the author of the next damage on the healed ally', async () => {
    const enemyId = Object.keys(manifest.audio.sfx.units).find((k) => k.startsWith('enemy_') && manifest.audio.sfx.units[k].hit);
    const { a, urls, settle, restore } = await rig([
      { id: 1, side: 'ally', kind: 'chess', spine: AGOAT2 }, { id: 2, side: 'ally', kind: 'chess', spine: 'char_x' },
      { id: 3, side: 'enemy', kind: 'enemy', spine: enemyId },
    ]);
    try {
      // 她的技能形态（_s）文件：这条断言要盯住它们一个都没响，所以先确认音效表里真的有 _s ——
      // 否则集合为空，断言会永远成立、形同虚设。
      const ownSkill = Object.values(manifest.audio.sfx.units[AGOAT2]).filter((x) => typeof x === 'string' && /_s\.mp3$/.test(x));
      assert.ok(ownSkill.length > 0, '前提：她的音效表里确实有 _s（技能形态）文件');
      a.handleBattleEvents([['atk', 1, 2, 'orb'], ['heal', 2, 300], ['dmg', 2, 120, 'phys'], ['dmg', 2, 80, 'arts']]);
      await settle();
      assert.ok(asked(urls, manifest.audio.sfx.units[AGOAT2].attack), 'her cast sound');
      assert.ok(!asked(urls, manifest.audio.sfx.units[AGOAT2].hit), 'no impact sound of hers on the ally');
      assert.ok(!ownSkill.some((p) => asked(urls, p)), 'nothing of her S3');
      // a hostile attack still authors its impact — once, and only for a real hit (not an element gauge fill)
      a.handleBattleEvents([['atk', 3, 2, 'none'], ['dmg', 2, 900, 'burn']]);
      await settle();
      assert.ok(!asked(urls, manifest.audio.sfx.units[enemyId].hit), 'a gauge fill is no impact');
      a.handleBattleEvents([['dmg', 2, 200, 'phys']]);
      await settle();
      assert.equal(askedCount(urls, manifest.audio.sfx.units[enemyId].hit), 1, 'the impact');
      a.limiter.lastByUnit.clear(); a.limiter.lastByUrl.clear();
      a.handleBattleEvents([['dmg', 2, 50, 'phys']]);
      await settle();
      assert.equal(askedCount(urls, manifest.audio.sfx.units[enemyId].hit), 1, 'a later tick is not the same attack\'s impact');
    } finally { restore(); }
  });

  test('a chain bounce plays no attack sound of the previous target; a stale attack is no impact', async () => {
    const enemyId = Object.keys(manifest.audio.sfx.units).find((k) => k.startsWith('enemy_') && manifest.audio.sfx.units[k].attack && manifest.audio.sfx.units[k].hit);
    const charId = Object.keys(manifest.audio.sfx.units).find((k) => k.startsWith('char_') && normalAttackSfx(k, manifest.audio.sfx.units[k].hit) && manifest.audio.sfx.units[k].hit);
    const { a, urls, settle, restore } = await rig([
      { id: 1, side: 'ally', kind: 'chess', spine: charId }, { id: 5, side: 'enemy', kind: 'enemy', spine: enemyId },
      { id: 6, side: 'enemy', kind: 'enemy', spine: enemyId },
    ]);
    const perf = globalThis.performance;
    let fakeNow = 1000;
    globalThis.performance = { now: () => fakeNow };
    try {
      a.handleBattleEvents([['atk', 5, 6, 'chain']]);
      await settle();
      assert.ok(!asked(urls, manifest.audio.sfx.units[enemyId].attack), 'the bounce is not an enemy attack');
      a.handleBattleEvents([['atk', 1, 5, 'arrow']]);
      fakeNow += 4000;
      a.handleBattleEvents([['dmg', 5, 100, 'phys']]);
      await settle();
      assert.ok(!asked(urls, manifest.audio.sfx.units[charId].hit), '4 s later: not that attack\'s impact');
    } finally { globalThis.performance = perf; restore(); }
  });
});

// 司霆惊蛰's S3 attack had no sound: she is 解放者 (she only attacks while a skill runs) and the official client has no
// normal-mode bank of hers at all — every attack of hers is a skill mode's (`attacks`, tools/assets/audio.mjs
// pickModeAttacks). 赤刃明霄陈's S3 slashes are the other half of the same idea: the mode's IMPACT differs too (`hits`,
// pickModeHits) — without it her S3 still landed with p_imp_hljdswd_n, i.e. it sounded like her normal attack. Both
// tables play only while that skill is active (the ['skill', id, 1] / 0 events).
describe('the running skill\'s own attack / impact sound (sfx.units[id].attacks / hits)', () => {
  const LEIZI2 = 'char_1043_leizi2';
  const CHEN3 = 'char_1050_chen3';
  const enemyId = () => Object.keys(manifest.audio.sfx.units).find((k) => k.startsWith('enemy_') && manifest.audio.sfx.units[k].attack);
  async function rig(units) {
    const fw = fakeWindow();
    const urls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (u) => { urls.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
    const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
    a.install();
    fw.fire('pointerdown');
    a.setFieldUnits(units);
    const settle = () => new Promise((r) => setTimeout(r, 5));
    return { a, urls, settle, restore: () => { globalThis.fetch = origFetch; } };
  }
  const clear = (a) => { a.limiter.lastByUnit.clear(); a.limiter.lastByUrl.clear(); };
  // …and forget the decoded buffers too: these assertions count REQUESTS, and a sound the manager already holds is
  // played from the cache without a second fetch (a real battle hears it either way).
  const fresh = (a) => { clear(a); a.buffers.clear(); };
  /** One attack plus the impact that belongs to it (the dmg inside IMPACT_WINDOW_MS). */
  const swingAndHit = (a) => a.handleBattleEvents([['atk', 1, 2, 'none'], ['dmg', 2, 120, 'phys']]);


  test('司霆惊蛰 S3: her attack rings the S3 mode\'s file while the skill runs, and only then', async () => {
    const u = manifest.audio.sfx.units[LEIZI2];
    assert.equal(u.attack, undefined, '前提：她没有普通形态的攻击音（这正是那次「没有音效」）');
    assert.ok(u.attacks['2'] && /_s\.mp3$/.test(u.attacks['2']), '前提：清单带 S3 形态的攻击音');
    const { a, urls, settle, restore } = await rig([
      { id: 1, side: 'ally', kind: 'chess', spine: LEIZI2, skillIndex: 2 }, { id: 2, side: 'enemy', kind: 'enemy', spine: enemyId() },
    ]);
    try {
      // 技能没开（解放者本就不攻击，模拟里也不会发 atk；真发了也仍然是静的）
      a.handleBattleEvents([['atk', 1, 2, 'none']]);
      await settle();
      assert.equal(askedCount(urls, u.attacks['2']), 0, '没有技能就没有她的攻击音');
      // S3 开启 → ['skill', id, 1]
      a.handleBattleEvents([['skill', 1, 1]]);
      await settle();
      const before = askedCount(urls, u.attacks['2']);
      a.handleBattleEvents([['atk', 1, 2, 'none']]);
      await settle();
      assert.equal(askedCount(urls, u.attacks['2']), before + 1, 'S3 期间她的攻击响 S3 的形态音');
      assert.ok(!asked(urls, u.skill), '技能发动音是另一条事件（这次没发），别混进攻击音');
      // 重复的 atk 会被同键冷却挡（既有口径，这里确认它没被新分支绕过）
      a.handleBattleEvents([['atk', 1, 2, 'none']]);
      await settle();
      assert.equal(askedCount(urls, u.attacks['2']), before + 1, '同一单位 160 ms 内只响一次');
      // S3 结束 → ['skill', id, 0]
      clear(a);
      a.handleBattleEvents([['skill', 1, 0]]);
      a.handleBattleEvents([['atk', 1, 2, 'none']]);
      await settle();
      assert.equal(askedCount(urls, u.attacks['2']), before + 1, '技能结束后又静音');
    } finally { restore(); }
  });

  test('a unit with both banks: the mode file inside the skill, its normal attack outside it', async () => {
    const id = Object.keys(manifest.audio.sfx.units).find((k) => k.startsWith('char_') && manifest.audio.sfx.units[k].attack && manifest.audio.sfx.units[k].attacks?.['2']);
    const u = manifest.audio.sfx.units[id];
    const { a, urls, settle, restore } = await rig([
      { id: 1, side: 'ally', kind: 'chess', spine: id, skillIndex: 2 }, { id: 2, side: 'enemy', kind: 'enemy', spine: enemyId() },
    ]);
    try {
      a.handleBattleEvents([['atk', 1, 2, 'none']]);
      await settle();
      assert.equal(askedCount(urls, u.attack), 1, `${id}: 技能外是普通攻击音`);
      assert.equal(askedCount(urls, u.attacks['2']), 0, `${id}: 技能外不响形态音`);
      clear(a);
      a.handleBattleEvents([['skill', 1, 1]]);
      a.handleBattleEvents([['atk', 1, 2, 'none']]);
      await settle();
      assert.equal(askedCount(urls, u.attacks['2']), 1, `${id}: 技能期间响形态音`);
      assert.equal(askedCount(urls, u.attack), 1, `${id}: 形态音取代、而不是叠加普通攻击音`);
    } finally { restore(); }
  });

  test('a unit whose manifest has no attacks table for that slot keeps its normal bank (and no crash)', async () => {
    const id = Object.keys(manifest.audio.sfx.units).find((k) => k.startsWith('char_') && manifest.audio.sfx.units[k].attack && !manifest.audio.sfx.units[k].attacks?.['2']);
    const u = manifest.audio.sfx.units[id];
    const { a, urls, settle, restore } = await rig([
      { id: 1, side: 'ally', kind: 'chess', spine: id, skillIndex: 2 }, { id: 2, side: 'enemy', kind: 'enemy', spine: enemyId() },
    ]);
    try {
      a.handleBattleEvents([['skill', 1, 1]]);
      a.handleBattleEvents([['atk', 1, 2, 'none']]);
      await settle();
      assert.equal(askedCount(urls, u.attack), 1, `${id}: 没有形态音就用普通攻击音`);
    } finally { restore(); }
  });

  test('赤刃明霄陈 S3: 挥砍与斩击都用 S3 的 `_s` 对，技能外回到普通 `_n` 对', async () => {
    const u = manifest.audio.sfx.units[CHEN3];
    assert.ok(u.attacks['2'] && u.hits['2'] && /_s\.mp3$/.test(u.attacks['2']) && /_s\.mp3$/.test(u.hits['2']), '前提：清单带 S3 的挥砍与斩击');
    const { a, urls, settle, restore } = await rig([
      { id: 1, side: 'ally', kind: 'chess', spine: CHEN3, skillIndex: 2 }, { id: 2, side: 'enemy', kind: 'enemy', spine: enemyId() },
    ]);
    try {
      fresh(a);
      swingAndHit(a);
      await settle();
      assert.equal(askedCount(urls, u.attack), 1, '技能外：普通挥砍');
      assert.equal(askedCount(urls, u.hit), 1, '技能外：普通命中');
      fresh(a);
      a.handleBattleEvents([['skill', 1, 1]]);       // S3 开启
      swingAndHit(a);
      await settle();
      assert.equal(askedCount(urls, u.attacks['2']), 1, 'S3：挥砍换成 S3 的');
      assert.equal(askedCount(urls, u.hits['2']), 1, 'S3：斩击（命中）也换成 S3 的');
      assert.equal(askedCount(urls, u.attack), 1, 'S3：没有叠加普通挥砍');
      assert.equal(askedCount(urls, u.hit), 1, 'S3：没有叠加普通命中');
      fresh(a);
      a.handleBattleEvents([['skill', 1, 0]]);       // S3 结束
      swingAndHit(a);
      await settle();
      assert.equal(askedCount(urls, u.attack), 2, '技能结束：普通挥砍回来了');
      assert.equal(askedCount(urls, u.hit), 2, '技能结束：普通命中回来了');
      assert.equal(askedCount(urls, u.hits['2']), 1, '技能结束：不再用 S3 的斩击');
    } finally { restore(); }
  });

  test('a mode without a hits entry keeps the unit\'s normal impact while the skill runs', async () => {
    const u = manifest.audio.sfx.units[LEIZI2];
    assert.ok(u.attacks['2'] && !u.hits?.['2'], '前提：她的 S3 有挥砍、没有命中 bank（官方就没有）');
    const { a, urls, settle, restore } = await rig([
      { id: 1, side: 'ally', kind: 'chess', spine: LEIZI2, skillIndex: 2 }, { id: 2, side: 'enemy', kind: 'enemy', spine: enemyId() },
    ]);
    try {
      a.handleBattleEvents([['skill', 1, 1]]);
      swingAndHit(a);
      await settle();
      assert.equal(askedCount(urls, u.attacks['2']), 1, 'S3 的挥砍');
      assert.equal(askedCount(urls, u.hit), 1, '命中仍是普通的那条');
    } finally { restore(); }
  });
});

// =====================================================================================================================
// 漏怪 sound (user request "接下来加漏怪的音效", then "应该是原版明日方舟关卡中的怪进蓝门的音效"). The sim emits
// `['leak', id]` when an enemy reaches its goal (Battle.leak) — NOT a `die` — so until now an escape was completely
// silent, for the player's own field and for a 联防 the helpers could not hold alike.
//
// The cue is the ORIGINAL Arknights stage alarm an enemy entering the exit plays in any normal stage: the manifest's
// `sfx.battle.leak`, bank `battle.ON_ENEMY_REACHED_EXIT`, file `Battle/b_ui/b_ui_alarmenter`. (The autochess banks
// have nothing named for an escape — all 13,948 SFX banks searched — but the stage itself does.) The official bank is
// a one-shot: `maxSoundAllowed: 1` with `popOldest: true` on the `Battle_UI_Important` mixer.

describe('漏怪 sound', () => {
  async function rig() {
    const fw = fakeWindow();
    const urls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (u) => { urls.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
    const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
    a.install();
    fw.fire('pointerdown');
    const settle = () => new Promise((r) => setTimeout(r, 10));
    return { a, fw, urls, settle, restore: () => { globalThis.fetch = origFetch; } };
  }

  test('an escaped enemy plays the original stage exit alarm — and no death sound (a leak is not a `die`)', async () => {
    const { a, urls, settle, restore } = await rig();
    try {
      const url = manifest.audio.sfx.battle.leak;
      assert.ok(url, '前提：清单里有 sfx.battle.leak');
      assert.match(url, /b_ui_alarmenter\.mp3$/, '就是原版关卡里怪进蓝门那一声');
      a.handleBattleEvents([['leak', 7]]);
      await settle();
      assert.ok(asked(urls, url), `漏怪 plays ${url}`);
      assert.equal(askedCount(urls, manifest.audio.sfx.battle.enemyDie), 0, 'a leak is not a death — no death sound');
    } finally { restore(); }
  });

  test('leaks of one disaster are ONE alarm (the cue is 1.44 s long), a later one rings again', async () => {
    const { a, fw, urls, settle, restore } = await rig();
    try {
      const url = manifest.audio.sfx.battle.leak;
      a.handleBattleEvents([['leak', 1]]);
      await settle();
      assert.equal(askedCount(urls, url), 1, 'the first escape rings');
      // the plays themselves, not the fetches: the buffer is cached after the first one
      const before = fw.made.started;
      // six more at once — a wiped board, or a 联防 the helpers could not hold
      a.handleBattleEvents([['leak', 2], ['leak', 3], ['leak', 4], ['leak', 5], ['leak', 6], ['leak', 7]]);
      await settle();
      assert.equal(fw.made.started - before, 0, 'one disaster never stacks alarms (the official bank allows 1)');
      // a genuine later leak is a new disaster and rings again, once the cue (1.44 s) has finished
      await new Promise((r) => setTimeout(r, 1600));
      a.handleBattleEvents([['leak', 8]]);
      await settle();
      assert.equal(fw.made.started - before, 1, 'a later leak rings again');
      assert.ok(a.limiter.active <= a.limiter.maxVoices);
    } finally { restore(); }
  });
});

// 按技能细分 (`sfx.units[charId].skillSfx`, docs/ASSETS.md): her S1 / S2 / S3 are three different impact sounds while
// the manifest carries ONE `hit` per unit, and the client plays exactly that for every damage it attributes to her. So
// the skill the damage was dealt under has to pick the file — measured in a browser first (a real client played the
// ordinary `p_imp_mjckyrdnt` for all three), pinned here on the real AudioManager.
describe('per-skill sounds (sfx.units[id].skillSfx)', () => {
  const CHAR = 'char_4182_oblvns';
  const ENEMY = 'enemy_1007_slime';
  const her = () => manifest.audio.sfx.units[CHAR];
  /** The real manager, unlocked, with a field of her two units and one enemy; `_play` records what it asks for. */
  async function perSkillRig(units = [
    { id: 1, side: 'ally', kind: 'chess', spine: CHAR, skillIndex: 0 },
    { id: 5, side: 'ally', kind: 'chess', spine: CHAR, skillIndex: 2 },
    { id: 2, side: 'enemy', kind: 'enemy', spine: ENEMY },
  ], getManifest = () => manifest) {
    const fw = fakeWindow();
    const origFetch = globalThis.fetch;
    const urls = [];
    globalThis.fetch = async (u) => { urls.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
    const a = new AudioManager({ win: fw.win, getManifest, random: () => 0 });
    a.install();
    a.setFieldUnits(units);
    fw.fire('pointerdown');            // after setFieldUnits: unlock without fetching the prep BGM (keeps counts clean)
    await new Promise((r) => setTimeout(r, 5));   // let the unlock's own work settle before anything is played
    const played = [];
    const real = a._play.bind(a);
    a._play = (url, o) => { played.push([url, o]); return real(url, o); };
    const settle = () => new Promise((r) => setTimeout(r, 5));
    return { a, fw, urls, played, settle, restore: () => { globalThis.fetch = origFetch; } };
  }
  /** Did a sound really START (the `_play` calls, not the fetches: a cached buffer is fetched only once)? */
  const playedUrl = (played, url, from = 0) => played.slice(from).some((p) => p[0] === url);

  test('her three skills carry their own impact, and each one is a different file', { skip: !manifest?.audio?.sfx?.units?.[CHAR]?.skillSfx && 'manifest has no skillSfx yet (run npm run assets)' }, () => {
    const s = her().skillSfx;
    assert.ok(s?.['0']?.hit && s?.['1']?.hit && s?.['2']?.hit, 'all three skills have an impact of their own');
    assert.notEqual(s['0'].hit, her().hit, 'S1 is not the unit’s ordinary hit');
    assert.notEqual(s['1'].hit, her().hit, 'S2 is not either');
    assert.notEqual(s['2'].hit, her().hit, 'S3 is not either');
  });

  test('an impact plays the sound of the skill it was dealt under, and falls back to `hit` without one', async () => {
    const { a, played, settle, restore } = await perSkillRig([
      { id: 1, side: 'ally', kind: 'chess', spine: CHAR, skillIndex: 2 },
      { id: 5, side: 'ally', kind: 'chess', spine: CHAR, skillIndex: 2 },
      { id: 2, side: 'enemy', kind: 'enemy', spine: ENEMY },
      { id: 3, side: 'enemy', kind: 'enemy', spine: ENEMY },
    ]);
    const s = her().skillSfx;
    try {
      // unit 1 casts S3, unit 5 casts it too: an 'atk' under a cast followed by the 'dmg' that lands plays S3's impact,
      // never the unit's ordinary `hit`. (The 'atk' itself is her swing, played for both.)
      a.handleBattleEvents([['skill', 1, 1], ['skill', 5, 1]]);
      a.handleBattleEvents([['atk', 1, 2, 'none'], ['atk', 5, 3, 'none']]);
      await settle();
      a.handleBattleEvents([['dmg', 2, 10, 'arts'], ['dmg', 3, 10, 'arts']]);
      await settle();
      assert.ok(playedUrl(played, s['2'].hit), `S3 ⇒ ${s['2'].hit}`);
      assert.ok(!playedUrl(played, her().hit), 'the ordinary hit is NOT played for a hit made under S3');
      assert.ok(!playedUrl(played, s['0'].hit) && !playedUrl(played, s['1'].hit), 'and no other skill’s impact is');
      // …and a hit from a unit with NO cast of its own: the ordinary `hit` is the answer (the fallback that keeps every
      // other operator — and every path whose unit entry carries no skillSfx — exactly as it was)
      a.units.get(5).skillIndex = null;
      a.activeSkill.delete(5);
      const from = played.length;
      a.handleBattleEvents([['atk', 5, 3, 'none']]);
      await settle();
      a.handleBattleEvents([['dmg', 3, 10, 'arts']]);
      await settle();
      assert.ok(playedUrl(played, her().hit, from), 'no cast ⇒ the unit’s own `hit`');
      assert.ok(!playedUrl(played, s['2'].hit, from), 'and not the skill’s');
    } finally { restore(); }
  });


  test('a unit with no skillSfx at all still plays its ordinary hit (the fallback)', async () => {
    // The enemy attacks her: the enemy's own `hit` is the answer (it has no skillSfx), and her S1 / S3 files are not.
    const { a, urls, settle, restore } = await perSkillRig();
    const enemyHit = manifest.audio.sfx.units[ENEMY]?.hit;
    try {
      assert.ok(enemyHit, '前提：敌人有 hit');
      a.handleBattleEvents([['atk', 2, 1, 'arrow']]);
      await settle();
      a.handleBattleEvents([['dmg', 1, 10, 'phys']]);
      await settle();
      assert.ok(asked(urls, enemyHit), 'the attacker’s own hit');
      for (const i of ['0', '1', '2']) assert.ok(!asked(urls, her().skillSfx[i].hit), `her S${Number(i) + 1} impact is not borrowed`);
    } finally { restore(); }
  });


  test('a cast plays the skill’s activation cue (never its `born`, which belongs to the projectile kind)', async () => {
    // `skillSfx[i].born` is the NOTE's launch — the renderer asks for it as `playProj(kind)` (sfx.proj). The 'skill'
    // event is the cast cue (`skills[i]`): reading the `born` role here would replace her 大招音 with the note's launch.
    const { a, played, settle, restore } = await perSkillRig();
    try {
      a.handleBattleEvents([['skill', 1, 1]]);
      await settle();
      assert.deepEqual(played.map((p) => p[0]), [her().skills['0']], 'S1’s activation cue, not `skillSfx[0]`');
      a.handleBattleEvents([['skill', 5, 1]]);
      await settle();
      assert.equal(played.at(-1)[0], her().skills['2'], 'S3’s activation cue (owner report 「三技能开大没有大招音效」)');
    } finally { restore(); }
  });

  test('the skill’s end event plays `finish`; a unit without one is silent (never the ordinary hit)', async () => {
    const { a, played, settle, restore } = await perSkillRig();
    try {
      a.handleBattleEvents([['skill', 5, 0]]);          // S3 ends: its cue is the STOP of the loop, not a file
      a.handleBattleEvents([['skill', 1, 0]]);          // S1 ends: no finish bank either
      await settle();
      assert.deepEqual(played.filter((p) => p[0] !== her().hit), [], 'no invented finish sound for S1 / S3');
      assert.ok(!played.some((p) => p[0] === her().skills['2']), 'an end is not a cast');
    } finally { restore(); }
  });


  test('a cast starts the sustained loop of the equipped skill, its end stops it (official ctrlStop)', async () => {
    const { a, settle, restore } = await perSkillRig();
    try {
      assert.equal(a.loops.size, 0, 'nothing loops before the cast');
      // S1 is an INSTANT skill (`durationType NONE`): it has no sustained section and therefore no `loop` role at all —
      // a cast of it must not start anything. S3 is the sustained one (`duration` 25 s, `ON_BUFF_START.…[loop]`).
      a.handleBattleEvents([['skill', 1, 1]]);
      await settle();
      assert.equal(a.loops.size, 0, 'S1 is not sustained: no loop');
      a.handleBattleEvents([['skill', 5, 1]]);
      await settle();
      assert.deepEqual([...a.loops.keys()], ['skill:5'], 'one loop, keyed by the unit that cast it');
      assert.ok(a.loops.get('skill:5').src, 'the loop really started (its source is up)');
      assert.equal(a.loops.get('skill:5').src.loop, true, 'and it is a LOOP (the official bank is `loop: true`)');
      a.handleBattleEvents([['skill', 5, 0]]);           // S3 ends
      await settle();
      assert.equal(a.loops.size, 0, 'the end event stops it (S3 has no finish file: the stop IS the end cue)');
    } finally { restore(); }
  });


  test('the end of a sustained skill FADES the loop out (official ctrlStop 0.2 s) instead of cutting it', async () => {
    // `soundFXCtrlBanks` is 315/315 `ctrlStop: true`, 287 of them `ctrlStopFadetime: 0.2` — the official end of a
    // sustained skill is that FADE, and for her S3 (no finish file) it is the only sound the skill ends with. The stop
    // used to go through `startLoop(…, { on: false })`, which clears the key with `fadeS: 0`: a hard cut, so the fade the
    // ctrl bank asks for was never heard.
    const { a, fw, settle, restore } = await perSkillRig();
    try {
      a.handleBattleEvents([['skill', 5, 1]]);
      await settle();
      const rec = a.loops.get('skill:5');
      assert.ok(rec?.src && rec.gain, '前提：S3 的循环在放');
      const stopped = fw.made.stopped;
      a.handleBattleEvents([['skill', 5, 0]]);           // S3 ends
      await settle();
      assert.equal(a.loops.size, 0, '结束就忘掉这个 key（同一个技能可以马上重放）');
      assert.equal(rec.gain.gain.value, 0, '增益淡出到 0（官方 ctrlStopFadetime 0.2 s）');
      assert.equal(fw.made.stopped, stopped, '不是硬切：结束时 source 还没有被 stop()');
      await new Promise((r) => setTimeout(r, 300));       // 斜坡（0.2 s + 0.05 s）走完之后
      assert.equal(fw.made.stopped, stopped + 1, '淡出走完才 src.stop() —— 这就是她 S3 的结束音');
    } finally { restore(); }
  });

  test('startLoop / stopLoop are contained: same key replaces, an unknown key is a no-op, no context is silent', async () => {
    const { a, restore } = await perSkillRig();
    try {
      const url = her().skillSfx['2'].loop;
      assert.equal(a.startLoop('k', url), true);
      const first = a.loops.get('k');
      assert.equal(a.startLoop('k', url), true, 'a second start on the same key');
      assert.notEqual(a.loops.get('k'), first, 'replaces the record (never two loops under one key)');
      assert.equal(a.loops.size, 1);
      a.stopLoop('k');
      assert.equal(a.loops.size, 0);
      a.stopLoop('k');
      a.stopLoop('never-started');
      assert.equal(a.stopLoop('nope', { fadeS: 0 }), undefined, 'a stop with no loop is a harmless no-op');
      assert.equal(a.startLoop('k', url, { on: false }), false, '`on: false` starts nothing but still clears the key');
      assert.equal(a.loops.size, 0);
      assert.equal(a.startLoop('', url), false, 'no key, no loop');
      assert.equal(a.startLoop('k', null), false, 'no url, no loop');
      const b = new AudioManager({ win: null, getManifest: () => manifest });
      assert.equal(b.startLoop('k', url), false, 'no AudioContext ⇒ silent (never a throw)');
    } finally { restore(); }
  });
});

// 按技能细分 (`sfx.units[charId].skillSfx`, docs/ASSETS.md): her S1 / S2 / S3 are three different impact sounds while
// the manifest carries ONE `hit` per unit, and the client plays exactly that for every damage it attributes to her. So
// the skill the damage was dealt under has to pick the file — measured in a browser first (a real client played the
// ordinary `p_imp_mjckyrdnt` for all three), pinned here on the real AudioManager.
describe('per-skill sounds (sfx.units[id].skillSfx)', () => {
  const CHAR = 'char_4182_oblvns';
  const ENEMY = 'enemy_1007_slime';
  const her = () => manifest.audio.sfx.units[CHAR];
  /** The real manager, unlocked, with a field of her two units and one enemy; `_play` records what it asks for. */
  async function perSkillRig(units = [
    { id: 1, side: 'ally', kind: 'chess', spine: CHAR, skillIndex: 0 },
    { id: 5, side: 'ally', kind: 'chess', spine: CHAR, skillIndex: 2 },
    { id: 2, side: 'enemy', kind: 'enemy', spine: ENEMY },
  ], getManifest = () => manifest) {
    const fw = fakeWindow();
    const origFetch = globalThis.fetch;
    const urls = [];
    globalThis.fetch = async (u) => { urls.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
    const a = new AudioManager({ win: fw.win, getManifest, random: () => 0 });
    a.install();
    a.setFieldUnits(units);
    fw.fire('pointerdown');            // after setFieldUnits: unlock without fetching the prep BGM (keeps counts clean)
    await new Promise((r) => setTimeout(r, 5));   // let the unlock's own work settle before anything is played
    const played = [];
    const real = a._play.bind(a);
    a._play = (url, o) => { played.push([url, o]); return real(url, o); };
    const settle = () => new Promise((r) => setTimeout(r, 5));
    return { a, fw, urls, played, settle, restore: () => { globalThis.fetch = origFetch; } };
  }
  /** Did a sound really START (the `_play` calls, not the fetches: a cached buffer is fetched only once)? */
  const playedUrl = (played, url, from = 0) => played.slice(from).some((p) => p[0] === url);

  test('her three skills carry their own impact, and each one is a different file', { skip: !manifest?.audio?.sfx?.units?.[CHAR]?.skillSfx && 'manifest has no skillSfx yet (run npm run assets)' }, () => {
    const s = her().skillSfx;
    assert.ok(s?.['0']?.hit && s?.['1']?.hit && s?.['2']?.hit, 'all three skills have an impact of their own');
    assert.notEqual(s['0'].hit, her().hit, 'S1 is not the unit’s ordinary hit');
    assert.notEqual(s['1'].hit, her().hit, 'S2 is not either');
    assert.notEqual(s['2'].hit, her().hit, 'S3 is not either');
  });

  test('an impact plays the sound of the skill it was dealt under, and falls back to `hit` without one', async () => {
    const { a, played, settle, restore } = await perSkillRig([
      { id: 1, side: 'ally', kind: 'chess', spine: CHAR, skillIndex: 2 },
      { id: 5, side: 'ally', kind: 'chess', spine: CHAR, skillIndex: 2 },
      { id: 2, side: 'enemy', kind: 'enemy', spine: ENEMY },
      { id: 3, side: 'enemy', kind: 'enemy', spine: ENEMY },
    ]);
    const s = her().skillSfx;
    try {
      // unit 1 casts S3, unit 5 casts it too: an 'atk' under a cast followed by the 'dmg' that lands plays S3's impact,
      // never the unit's ordinary `hit`. (The 'atk' itself is her swing, played for both.)
      a.handleBattleEvents([['skill', 1, 1], ['skill', 5, 1]]);
      a.handleBattleEvents([['atk', 1, 2, 'none'], ['atk', 5, 3, 'none']]);
      await settle();
      a.handleBattleEvents([['dmg', 2, 10, 'arts'], ['dmg', 3, 10, 'arts']]);
      await settle();
      assert.ok(playedUrl(played, s['2'].hit), `S3 ⇒ ${s['2'].hit}`);
      assert.ok(!playedUrl(played, her().hit), 'the ordinary hit is NOT played for a hit made under S3');
      assert.ok(!playedUrl(played, s['0'].hit) && !playedUrl(played, s['1'].hit), 'and no other skill’s impact is');
      // …and a hit from a unit with NO cast of its own: the ordinary `hit` is the answer (the fallback that keeps every
      // other operator — and every path whose unit entry carries no skillSfx — exactly as it was)
      a.units.get(5).skillIndex = null;
      a.activeSkill.delete(5);
      const from = played.length;
      a.handleBattleEvents([['atk', 5, 3, 'none']]);
      await settle();
      a.handleBattleEvents([['dmg', 3, 10, 'arts']]);
      await settle();
      assert.ok(playedUrl(played, her().hit, from), 'no cast ⇒ the unit’s own `hit`');
      assert.ok(!playedUrl(played, s['2'].hit, from), 'and not the skill’s');
    } finally { restore(); }
  });

  test('an INSTANT skill (her S1) ends in its own tick: the later landing is an ORDINARY hit (dust contract)', async () => {
    // Measured in a browser (test/e2e/sakiko-note-sfx-probe.mjs --skill=0): S1 emits START and, in the SAME tick, the
    // end tuple (`skills.js` ends an instant skill right after the cast), while the eight notes it fired land ~1 s later.
    // sakiko 0.1.4 carried the cast across that gap with `recentSkill` + IMPACT_WINDOW_MS. dust 0.2.5 has no such
    // memory: `['skill', id, 0]` clears `skillActive` and `activeSkill`, so by the time the damage is attributed the
    // unit is back to its ordinary `hit`. A knowing divergence — see mods/sakiko/README.md §「与 sakiko 的分歧」②.
    const { a, played, settle, restore } = await perSkillRig([
      { id: 1, side: 'ally', kind: 'chess', spine: CHAR, skillIndex: 0 },
      { id: 2, side: 'enemy', kind: 'enemy', spine: ENEMY },
    ]);
    const perf = globalThis.performance;
    let now = 1000;
    globalThis.performance = { now: () => now };
    try {
      a.handleBattleEvents([['skill', 1, 1], ['skill', 1, 0]]);   // cast + end, one batch (the instant-skill shape)
      await settle();
      assert.equal(a.activeSkill.has(1), false, '前提：瞬时技能结束时已不在施放中');
      a.handleBattleEvents([['atk', 1, 2, 'none']]);
      await settle();
      const from = played.length;
      now += 900;                                                 // her note lands ~0.9 s later
      a.handleBattleEvents([['dmg', 2, 10, 'arts']]);
      await settle();
      assert.ok(playedUrl(played, her().hit, from), 'the cast is over ⇒ the unit’s ordinary hit');
      assert.ok(!playedUrl(played, her().skillSfx['0'].hit, from), 'and NOT S1’s impact: dust keeps no recent-cast memory');
      // an impact later than IMPACT_WINDOW_MS after its own attack is no impact at all (unchanged behaviour)
      now += 3000;
      a.handleBattleEvents([['atk', 1, 2, 'none']]);   // the swing itself plays (that is the 'attack' cue, not an impact)
      await settle();
      const quiet = played.length;
      now += 2600;
      a.handleBattleEvents([['dmg', 2, 10, 'arts']]);
      await settle();
      assert.equal(played.length, quiet, 'no impact sound: the window dropped it');
    } finally {
      globalThis.performance = perf;
      restore();
    }
  });

  test('a unit with no skillSfx at all still plays its ordinary hit (the fallback)', async () => {
    // The enemy attacks her: the enemy's own `hit` is the answer (it has no skillSfx), and her S1 / S3 files are not.
    const { a, urls, settle, restore } = await perSkillRig();
    const enemyHit = manifest.audio.sfx.units[ENEMY]?.hit;
    try {
      assert.ok(enemyHit, '前提：敌人有 hit');
      a.handleBattleEvents([['atk', 2, 1, 'arrow']]);
      await settle();
      a.handleBattleEvents([['dmg', 1, 10, 'phys']]);
      await settle();
      assert.ok(asked(urls, enemyHit), 'the attacker’s own hit');
      for (const i of ['0', '1', '2']) assert.ok(!asked(urls, her().skillSfx[i].hit), `her S${Number(i) + 1} impact is not borrowed`);
    } finally { restore(); }
  });

  test('a `_d` / `_h` / `_s` skill-mode hit IS the skill’s sound (the normal-attack guard covers the unit’s own roles only)', async () => {
    // `normalAttackSfx` keeps an operator's skill-mode file (`_d` / `_h` / `_s`) out of its ORDINARY attack, and the
    // official bank of a SKILL is exactly such a file: 伊内丝's S1 impact is `ON_PROJECTILE_HIT.projectile_chr_ines_s1`
    // → `p_imp_insasn_d`. dust 0.2.5 expresses that as `hits[skillIndex]` while the skill RUNS (audio.js `unit()`:
    // `mode` bypasses the guard at the `typeof mode !== 'string'` clause). The fixture below swaps her S1 impact for
    // such a file and drives BOTH paths on the real manager.
    const skillFile = '/assets/audio/sfx/player/p_imp/p_imp_insasn_d.mp3';   // 伊内丝 S1's impact: a `_d` file
    assert.equal(normalAttackSfx(CHAR, skillFile), false, '前提：技能形态文件会被普通攻击的闸门拒掉');
    for (const i of ['0', '1', '2']) {
      assert.equal(normalAttackSfx(CHAR, her().skillSfx[i].hit), true, `她的 S${Number(i) + 1} 命中不匹配该正则 ⇒ 这处回移对她零影响`);
    }
    const m = structuredClone(manifest);
    m.audio.sfx.units[CHAR].hits['0'] = skillFile;      // S1's own impact, in dust's own slot
    const { a, played, settle, restore } = await perSkillRig([
      { id: 1, side: 'ally', kind: 'chess', spine: CHAR, skillIndex: 0 },
      { id: 2, side: 'enemy', kind: 'enemy', spine: ENEMY },
    ], () => m);
    try {
      // 1) 这次伤害算 S1 的：技能自己的命中音会响（施放仍在进行 ⇒ dust 读 `hits[0]`，闸门不作用于它）
      a.handleBattleEvents([['skill', 1, 1]]);          // 施放保持进行中（不发结束事件）
      await settle();
      a.handleBattleEvents([['atk', 1, 2, 'none']]);
      await settle();
      a.handleBattleEvents([['dmg', 2, 10, 'arts']]);
      await settle();
      assert.ok(playedUrl(played, skillFile), '技能自己的命中音（_d）会响');
      // 2) 同一个文件当作单位的普通命中：仍被拒（闸门没被拆掉）
      m.audio.sfx.units[CHAR].hit = skillFile;          // 现在它同时是她的 `hit`
      const from = played.length;
      a.setFieldUnits([{ id: 7, side: 'ally', kind: 'chess', spine: CHAR, skillIndex: 0 }, { id: 3, side: 'enemy', kind: 'enemy', spine: ENEMY }]);
      a.limiter.lastByUnit.clear(); a.limiter.lastByUrl.clear();   // 排除限流（同 URL 的 45 ms gap）造成的假阴性
      a.handleBattleEvents([['atk', 7, 3, 'none']]);    // 没有任何施放：走单位自己的 `hit`
      await settle();
      a.handleBattleEvents([['dmg', 3, 10, 'phys']]);
      await settle();
      assert.ok(!playedUrl(played, skillFile, from), '作为普通命中仍被拒');
    } finally { restore(); }
  });

  test('a cast plays the skill’s activation cue (never its `born`, which belongs to the projectile kind)', async () => {
    // `skillSfx[i].born` is the NOTE's launch — the renderer asks for it as `playProj(kind)` (sfx.proj). The 'skill'
    // event is the cast cue (`skills[i]`): reading the `born` role here would replace her 大招音 with the note's launch.
    const { a, played, settle, restore } = await perSkillRig();
    try {
      a.handleBattleEvents([['skill', 1, 1]]);
      await settle();
      assert.deepEqual(played.map((p) => p[0]), [her().skills['0']], 'S1’s activation cue, not `skillSfx[0]`');
      a.handleBattleEvents([['skill', 5, 1]]);
      await settle();
      assert.equal(played.at(-1)[0], her().skills['2'], 'S3’s activation cue (owner report 「三技能开大没有大招音效」)');
    } finally { restore(); }
  });

  test('the skill’s end event plays `finish`; a unit without one is silent (never the ordinary hit)', async () => {
    const { a, played, settle, restore } = await perSkillRig();
    try {
      a.handleBattleEvents([['skill', 5, 0]]);          // S3 ends: its cue is the STOP of the loop, not a file
      a.handleBattleEvents([['skill', 1, 0]]);          // S1 ends: no finish bank either
      await settle();
      assert.deepEqual(played.filter((p) => p[0] !== her().hit), [], 'no invented finish sound for S1 / S3');
      assert.ok(!played.some((p) => p[0] === her().skills['2']), 'an end is not a cast');
    } finally { restore(); }
  });

  test('the skill’s end event is silent: dust never consumes `skillSfx[i].finish` (deliberate divergence)', async () => {
    // sakiko 0.1.4 played `skillSfx[i].finish` on the end tuple. dust 0.2.5 gives the end event no sound of its own:
    // the activation cue belongs to the START (`skills[skillIndex]`) and a sustained skill's end is the STOP of its
    // loop. Her S2 `finish` — the same take as its cast, `_h2` — therefore stays unused.
    // See mods/sakiko/README.md §「与 sakiko 的分歧」③.
    const { a, urls, played, settle, restore } = await perSkillRig([
      { id: 5, side: 'ally', kind: 'chess', spine: CHAR, skillIndex: 1 },
      { id: 2, side: 'enemy', kind: 'enemy', spine: ENEMY },
    ]);
    try {
      const url = her().skillSfx?.['1']?.finish;
      assert.ok(url, '前提：清单里有 S2 的 finish');
      const from = played.length;
      a.handleBattleEvents([['skill', 5, 0]]);
      await settle();
      assert.equal(played.length, from, 'the end cue does not exist in dust’s event table');
      assert.equal(asked(urls, url), false, 'and its file was never even fetched');
      // the cast is where dust makes a sound: `skills[skillIndex]`, not `finish`
      a.handleBattleEvents([['skill', 5, 1]]);
      await settle();
      assert.equal(played.at(-1)[0], her().skills['1'], 'the activation cue carries the sound instead');
      assert.equal(url, her().skills['1'], '…同一份录音（她的 finish 就是施放那一版 `_h2`），只是改在施放时响');
    } finally { restore(); }
  });

  test('a cast starts the sustained loop of the equipped skill, its end stops it (official ctrlStop)', async () => {
    const { a, settle, restore } = await perSkillRig();
    try {
      assert.equal(a.loops.size, 0, 'nothing loops before the cast');
      // S1 is an INSTANT skill (`durationType NONE`): it has no sustained section and therefore no `loop` role at all —
      // a cast of it must not start anything. S3 is the sustained one (`duration` 25 s, `ON_BUFF_START.…[loop]`).
      a.handleBattleEvents([['skill', 1, 1]]);
      await settle();
      assert.equal(a.loops.size, 0, 'S1 is not sustained: no loop');
      a.handleBattleEvents([['skill', 5, 1]]);
      await settle();
      assert.deepEqual([...a.loops.keys()], ['skill:5'], 'one loop, keyed by the unit that cast it');
      assert.ok(a.loops.get('skill:5').src, 'the loop really started (its source is up)');
      assert.equal(a.loops.get('skill:5').src.loop, true, 'and it is a LOOP (the official bank is `loop: true`)');
      a.handleBattleEvents([['skill', 5, 0]]);           // S3 ends
      await settle();
      assert.equal(a.loops.size, 0, 'the end event stops it (S3 has no finish file: the stop IS the end cue)');
    } finally { restore(); }
  });

  test('two of her casting at once loop independently, and a death / a new field stops the loop', async () => {
    // Two units BOTH on S3 (the 自选 slot can hand out a second piece — the two-of-her field the owner reported on).
    const { a, settle, restore } = await perSkillRig([
      { id: 1, side: 'ally', kind: 'chess', spine: CHAR, skillIndex: 2 },
      { id: 5, side: 'ally', kind: 'chess', spine: CHAR, skillIndex: 2 },
    ]);
    try {
      a.handleBattleEvents([['skill', 1, 1], ['skill', 5, 1]]);
      await settle();
      assert.deepEqual([...a.loops.keys()].sort(), ['skill:1', 'skill:5'], '两只各响各的（各自的限流键与循环）');
      const one = a.loops.get('skill:1');
      const five = a.loops.get('skill:5');
      assert.notEqual(one.src, five.src, 'two independent sources');
      // unit 1's own end stops only unit 1's loop
      a.handleBattleEvents([['skill', 1, 0]]);
      await settle();
      assert.deepEqual([...a.loops.keys()], ['skill:5'], 'unit 1’s loop is gone, unit 5 keeps hers');
      // a new field (the next battle) stops everything: no loop may ring across a battle
      a.setFieldUnits([{ id: 9, side: 'ally', kind: 'chess', spine: CHAR, skillIndex: 2 }]);
      assert.equal(a.loops.size, 0, 'a new field is a new battle');
      assert.equal(a.activeSkill.size, 0, 'and the cast scopes go with it');
      assert.equal(a.pendingSkill.size, 0, 'and so do casts held for a unit that never spawned');
      // (dust 0.2.5 has no `recentSkill` — sakiko 0.1.4's impact memory — so there is nothing else to clear here)
    } finally { restore(); }
  });

  test('the end of a sustained skill FADES the loop out (official ctrlStop 0.2 s) instead of cutting it', async () => {
    // `soundFXCtrlBanks` is 315/315 `ctrlStop: true`, 287 of them `ctrlStopFadetime: 0.2` — the official end of a
    // sustained skill is that FADE, and for her S3 (no finish file) it is the only sound the skill ends with. The stop
    // used to go through `startLoop(…, { on: false })`, which clears the key with `fadeS: 0`: a hard cut, so the fade the
    // ctrl bank asks for was never heard.
    const { a, fw, settle, restore } = await perSkillRig();
    try {
      a.handleBattleEvents([['skill', 5, 1]]);
      await settle();
      const rec = a.loops.get('skill:5');
      assert.ok(rec?.src && rec.gain, '前提：S3 的循环在放');
      const stopped = fw.made.stopped;
      a.handleBattleEvents([['skill', 5, 0]]);           // S3 ends
      await settle();
      assert.equal(a.loops.size, 0, '结束就忘掉这个 key（同一个技能可以马上重放）');
      assert.equal(rec.gain.gain.value, 0, '增益淡出到 0（官方 ctrlStopFadetime 0.2 s）');
      assert.equal(fw.made.stopped, stopped, '不是硬切：结束时 source 还没有被 stop()');
      await new Promise((r) => setTimeout(r, 300));       // 斜坡（0.2 s + 0.05 s）走完之后
      assert.equal(fw.made.stopped, stopped + 1, '淡出走完才 src.stop() —— 这就是她 S3 的结束音');
    } finally { restore(); }
  });

  test('startLoop / stopLoop are contained: same key replaces, an unknown key is a no-op, no context is silent', async () => {
    const { a, restore } = await perSkillRig();
    try {
      const url = her().skillSfx['2'].loop;
      assert.equal(a.startLoop('k', url), true);
      const first = a.loops.get('k');
      assert.equal(a.startLoop('k', url), true, 'a second start on the same key');
      assert.notEqual(a.loops.get('k'), first, 'replaces the record (never two loops under one key)');
      assert.equal(a.loops.size, 1);
      a.stopLoop('k');
      assert.equal(a.loops.size, 0);
      a.stopLoop('k');
      a.stopLoop('never-started');
      assert.equal(a.stopLoop('nope', { fadeS: 0 }), undefined, 'a stop with no loop is a harmless no-op');
      assert.equal(a.startLoop('k', url, { on: false }), false, '`on: false` starts nothing but still clears the key');
      assert.equal(a.loops.size, 0);
      assert.equal(a.startLoop('', url), false, 'no key, no loop');
      assert.equal(a.startLoop('k', null), false, 'no url, no loop');
      const b = new AudioManager({ win: null, getManifest: () => manifest });
      assert.equal(b.startLoop('k', url), false, 'no AudioContext ⇒ silent (never a throw)');
    } finally { restore(); }
  });
});

// SFX_PRI (audio.js): the note storm of two 丰川祥子 is three sounds per attack — 挥击 + 音符诞生 + 音符命中 — against ONE
// global MAX_VOICES budget, so an event sound arriving on a full limiter used to be refused outright. Owner report
// 「现在三技能开大没有大招音效了」. Measured in a browser first (see docs/ASSETS.md): the skill cue was playable and
// reachable, and the sounds being refused were the decorations.
describe('SFX priority: an event sound is never starved by the decorations', () => {
  const CHAR = 'char_4182_oblvns';
  const ENEMY = 'enemy_1007_slime';
  /**
   * n units whose `attack` files are all different (one per unit ⇒ the per-url cap never fires first) and whose bank
   * starts the sound at once. An official bank sound may carry a `delay` (audio.mjs bankPool, official `delay`): the
   * merged pool path waits it out before it takes a voice, so such a unit cannot fill the budget within this test's
   * settle — the eviction rule is what is under test here, not the official stagger.
   */
  const delayedPool = (u) => {
    const pool = manifest.audio.sfx.pools?.[u?.pools?.attack];
    return !!pool && Object.values(pool.sounds || {}).some((s) => Number(s?.delay) > 0);
  };
  const spreadUnits = (n) => Object.entries(manifest.audio.sfx.units)
    .filter(([id, u]) => id !== CHAR && typeof u.attack === 'string' && normalAttackSfx(id, u.attack) && !delayedPool(u))
    .slice(0, n)
    .map(([id], i) => ({ id: i + 1, side: 'ally', kind: 'chess', spine: id }));

  async function storm() {
    const fw = fakeWindow();
    const origFetch = globalThis.fetch;
    const urls = [];
    globalThis.fetch = async (u) => { urls.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
    const a = new AudioManager({ win: fw.win, getManifest: () => manifest, random: () => 0 });
    a.install();
    const units = spreadUnits(a.limiter.maxVoices);
    units.push({ id: 99, side: 'ally', kind: 'chess', spine: CHAR, skillIndex: 2 });
    units.push({ id: 100, side: 'enemy', kind: 'enemy', spine: ENEMY });
    a.setFieldUnits(units);
    fw.fire('pointerdown');
    const played = [];
    const real = a._play.bind(a);
    a._play = (url, o) => { played.push([url, o]); return real(url, o); };
    const settle = () => new Promise((r) => setTimeout(r, 5));
    return { a, fw, urls, played, units, settle, restore: () => { globalThis.fetch = origFetch; } };
  }

  test('a full voice budget: the skill’s cast cue still plays (popOldest displaces a decoration)', async () => {
    const { a, played, units, settle, restore } = await storm();
    try {
      assert.equal(units.length, a.limiter.maxVoices + 2, `前提：${a.limiter.maxVoices} 个单位占满声道`);
      // one batch: every unit attacks at once — the same `performance.now()`, exactly like one socket message
      a.handleBattleEvents(units.slice(0, a.limiter.maxVoices).map((u) => ['atk', u.id, 100, 'arrow']));
      await settle();
      assert.equal(a.limiter.active, a.limiter.maxVoices, `前提：限流器已满 (${a.limiter.active}/${a.limiter.maxVoices})`);
      const before = played.length;
      a.handleBattleEvents([['skill', 99, 1]]);
      await settle();
      const skillUrl = manifest.audio.sfx.units[CHAR].skills['2'];
      assert.ok(played.slice(before).some(([url]) => url === skillUrl),
        '技能发动音播放了（它在满声道时挤掉了一条装饰音，而不是被拒绝）');
      assert.equal(a.limiter.active, a.limiter.maxVoices, '一个位置换一个位置：并发上限没有被突破');
      assert.ok(a.limiter.active <= a.limiter.maxVoices, '混战响度不失控');
    } finally { restore(); }
  });

  test('low priority is not muted: with room to spare, every decoration still plays', async () => {
    // The tiers must not turn into "only events are heard": an idle limiter plays the decorations as before.
    const { a, played, settle, restore } = await storm();
    try {
      const born = manifest.audio.sfx.proj.note.born;
      assert.equal(a.playProj('note', { unitId: 99, unit: CHAR }), true);
      await settle();
      assert.deepEqual(played.map((p) => p[0]), [born], '音符诞生 still plays');
      assert.equal(played[0][1].pri, SFX_PRI.deco, 'at the decoration tier');
      assert.equal(a.limiter.active, 1);
    } finally { restore(); }
  });

  test('SFX_PRI: events < units < decorations, and an omitted tier is an event', () => {
    assert.ok(SFX_PRI.event < SFX_PRI.unit && SFX_PRI.unit < SFX_PRI.deco, 'the ordering the popOldest rule reads');
    const l = new SfxLimiter({ maxVoices: 1, unitCooldownMs: 0, urlGapMs: 0 });
    assert.ok(l.tryAcquire(0, 'a', 'old.mp3', SFX_PRI.deco));
    assert.equal(l.tryAcquire(0, 'b', 'new.mp3', SFX_PRI.deco), false, 'equal tier: no eviction, the cap holds');
    assert.ok(l.tryAcquire(0, 'b', 'new.mp3', SFX_PRI.event), 'a better tier takes the slot');
    assert.equal(l.alive(l.lastToken), true);
    assert.equal(l.active, 1, 'still exactly one voice');
    assert.equal(l.activeByUrl.get('old.mp3'), undefined, 'the displaced sound released its copy');
    assert.equal(l.activeByUrl.get('new.mp3'), 1);
    // the token contract: a displaced token may not start (and its late release cannot free the new owner's slot)
    const displaced = 1;
    assert.equal(l.alive(displaced), false);
    l.release('new.mp3', displaced);
    assert.equal(l.active, 1, 'a stale release is a no-op');
    // 2 overlapping copies of one file is the official cap: only a STRICTLY better tier may break it
    const l2 = new SfxLimiter({ maxVoices: 9, unitCooldownMs: 0, urlGapMs: 0 });
    assert.ok(l2.tryAcquire(0, 'a', 'x.mp3', SFX_PRI.unit));
    assert.ok(l2.tryAcquire(0, 'b', 'x.mp3', SFX_PRI.unit));
    assert.equal(l2.tryAcquire(0, 'c', 'x.mp3', SFX_PRI.unit), false, 'a third copy of one file waits');
    assert.ok(l2.tryAcquire(0, 'c', 'x.mp3', SFX_PRI.event), '…unless it is an event sound');
    assert.equal(l2.activeByUrl.get('x.mp3'), 2, 'never more than one copy over the official cap');
  });

  test('a 60-unit brawl stays bounded, and the events of it are all heard', async () => {
    const { a, played, settle, restore } = await storm();
    try {
      const ids = a.units ? [...a.units.keys()] : [];
      assert.ok(ids.length >= 10);
      for (let round = 0; round < 12; round++) {
        const ev = [];
        for (const id of ids) if (typeof id === 'number' && id < 90) ev.push(['atk', id, 100, 'arrow'], ['dmg', 100, 10, 'phys']);
        ev.push(['skill', 99, 1]);
        a.handleBattleEvents(ev);
        await settle();
        assert.ok(a.limiter.active <= a.limiter.maxVoices, `round ${round}: ${a.limiter.active} ≤ ${a.limiter.maxVoices}`);
        assert.ok(a.limiter.activeByUrl.get(manifest.audio.sfx.units[CHAR].skills['2']) === undefined
          || a.limiter.activeByUrl.get(manifest.audio.sfx.units[CHAR].skills['2']) <= 2);
      }
      const skillUrl = manifest.audio.sfx.units[CHAR].skills['2'];
      assert.ok(played.filter(([url]) => url === skillUrl).length > 0, '每一次开大都有声音');
    } finally { restore(); }
  });
});
