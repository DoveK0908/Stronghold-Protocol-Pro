// 大厅音乐面板 (ui/lobbyMusicPanel.js; the owner's request of 2026-10-20): the card, the picks it writes, and the
// audio.js plumbing behind them — a packaged track instead of the lobby's own, the lobby's own gain, its own volume.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AudioManager, lobbyTrackOf } from '../../public/js/audio.js';
import { BGM_TRACKS } from '../../public/js/bgmChoice.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const MANIFEST = {
  audio: {
    bgm: {
      lobby: { loop: '/assets/audio/bgm/m_sys_act1autochess_loop.mp3', intro: '/assets/audio/bgm/m_sys_act1autochess_intro.mp3' },
      prep: { loop: '/assets/audio/bgm/m_bat_act1autochess_loop.mp3' },
      combatAlts: [{ loop: '/assets/audio/bgm/m_bat_kazimierz2_1_loop.mp3' }, { loop: '/assets/audio/bgm/m_bat_kazimierz2_2_loop.mp3' }],
      unite: { loop: '/assets/audio/bgm/m_bat_kazimierz2_2_loop.mp3' },
    },
  },
};

test('lobbyTrackOf: packaged picks resolve, official / custom leave the lobby its own music', () => {
  const knight = BGM_TRACKS.find((t) => t.id === 'knight');
  assert.ok(knight, '骑士之日 is a packaged track (bgmChoice.js)');
  assert.deepEqual(lobbyTrackOf(MANIFEST, 'knight'), { intro: null, loop: '/assets/audio/bgm/m_bat_kazimierz2_1_loop.mp3', choice: 'knight' });
  assert.equal(lobbyTrackOf(MANIFEST, 'official'), null);
  assert.equal(lobbyTrackOf(MANIFEST, 'custom'), null);
  assert.equal(lobbyTrackOf(MANIFEST, 'nonsense'), null);
  assert.equal(lobbyTrackOf(null, 'knight'), null);
});

test('a track that fails to load falls back to the lobby music instead of restarting forever', () => {
  const m = new AudioManager({ getManifest: () => MANIFEST });
  m.setLobbyPick('knight');
  assert.equal(m._bgmTrack('lobby').loop, '/assets/audio/bgm/m_bat_kazimierz2_1_loop.mp3');
  // a 404 / a file the browser cannot decode: _startBgm marks the pick; the lobby keeps its own music (no retry loop)
  m.bgmChoiceFailed.add('knight');
  assert.equal(m._bgmTrack('lobby').loop, '/assets/audio/bgm/m_sys_act1autochess_loop.mp3');
  // choosing it again is an explicit retry
  m.setLobbyPick('knight');
  assert.equal(m.bgmChoiceFailed.has('knight'), false);
  assert.equal(m._bgmTrack('lobby').loop, '/assets/audio/bgm/m_bat_kazimierz2_1_loop.mp3');
});

test('audio.js: the lobby pick and pause gate its own key, and lobby music rides its own gain', () => {
  const src = read('public/js/audio.js');
  assert.match(src, /this\.bgmChoiceFailed\.has\(this\.lobbyPick\)/, 'a failed pick never resolves again (no restart loop)');
  assert.match(src, /const pick = lobbyTrackOf\(manifest, this\.lobbyPick\);/, 'the pick goes through lobbyTrackOf');
  assert.match(src, /setLobbyPick\(id\) \{/, 'the panel writes the pick through setLobbyPick');
  assert.match(src, /if \(this\.lastBgmKey === 'lobby'\) this\.playBgm\('lobby'\);/, 'a new pick restarts the lobby track');
  assert.match(src, /if \(key === 'lobby' && this\.lobbyPaused\)/, 'a paused lobby never starts downloading its track');
  assert.match(src, /this\.lobbyGain = this\.ctx\.createGain\(\);/, 'the lobby has a gain of its own');
  assert.match(src, /this\.lobbyGain\.connect\(this\.bgmGain\);/, 'it sits under 背景音乐');
  assert.match(src, /gain\.connect\(key === 'lobby' \? this\.lobbyGain : this\.bgmGain\);/, 'only the lobby key takes it');
  assert.match(src, /lobby: n\(v\?\.lobbyVolume \?\? v\?\.lobby, this\.volumes\.lobby\)/, 'settings lobbyVolume drives it');
  assert.match(src, /this\.lobbyGain\.gain\.setTargetAtTime\(this\.volumes\.lobby \*\* 2, t, 0\.05\);/, 'applied as a multiplier');
});

test('settings: the panel\'s picks and the wire to audio.js', () => {
  const settings = read('public/js/ui/settings.js');
  assert.match(settings, /audio\.setLobbyPick\(s\.lobbyTrack\);/);
  assert.match(settings, /audio\.setLobbyPick\(settingsStore\.get\(\)\.lobbyTrack\);/);
  const music = read('public/js/ui/lobbyMusic.js');
  assert.match(music, /customGain\.connect\(audio\.lobbyGain \|\| audio\.bgmGain\);/, "the player's own file takes the lobby gain too");
  assert.match(music, /subscribe\(fn\) \{ install\(\); listeners\.add\(fn\);/, 'the card can follow the file state');
});

test('panel: the lobby card renders the radio, the transport, shuffle and the lobby volume', () => {
  const src = read('public/js/ui/lobbyMusicPanel.js');
  assert.match(src, /export function LobbyMusicPanel\(\)/);
  assert.match(src, /RHODES RADIO/);
  assert.match(src, /data-testid="lobby-track"/);
  assert.match(src, /data-testid="lobby-play"/);
  assert.match(src, /data-testid="lobby-shuffle"/);
  assert.match(src, /data-testid="lobby-volume"/);
  assert.match(src, /updateSettings\(\{ lobbyTrack: id \}\)/, 'a pick lands in settings');
  assert.match(src, /updateSettings\(\{ lobbyShuffle: e\.currentTarget\.checked \}\)/);
  assert.match(src, /updateSettings\(\{ lobbyVolume: Number\(e\.currentTarget\.value\) \/ 100 \}\)/);
  assert.match(src, /updateSettings\(\{ lobbyMusicOpen: !open \}\)/, 'the fold is remembered');
  assert.match(src, /audio\.setLobbyPaused\(!audio\.lobbyPaused\)/, 'play / pause drives audio.js');
  assert.match(src, /const step = \(dir\) => \{/, 'prev / next move through the tracks');
  assert.match(src, /if \(s\.lobbyShuffle\) \{/, '随机播放 picks another one');
  const lobby = read('public/js/screens/lobby.js');
  assert.match(lobby, /<\$\{LobbyMusicPanel\} \/>/, 'the card is on the lobby screen');
  assert.match(lobby, /<aside class="hub-side">\s*\n\s*<\$\{LobbyMusicPanel\} \/>/, 'top-left, above 成就统计');
  const css = read('public/css/screens/lobby.css');
  assert.match(css, /\.lobmusic \{/);
  assert.match(css, /\.lobmusic\[data-open="0"\] \.lobmusic__head \{ border-bottom: 0; \}/);
});

test('i18n: every string of the card has an English line', () => {
  const en = JSON.parse(read('public/i18n/en.json'));
  for (const id of ['主界面音乐', '官方大厅音乐', '自选上传', '上一首', '下一首', '随机播放', '大厅音乐音量', '展开', '音量']) {
    assert.equal(typeof en[id], 'string', `${id} has an English translation`);
  }
});
