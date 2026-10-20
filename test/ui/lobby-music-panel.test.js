// 大厅音乐面板 (ui/lobbyMusicPanel.js; the owner's request of 2026-10-20): the card, the picks it writes, and the
// audio.js plumbing behind them — a packaged track instead of the lobby's own, the lobby's own gain, its own volume.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AudioManager, lobbyTrackOf } from '../../public/js/audio.js';
import { BGM_TRACKS } from '../../public/js/bgmChoice.js';
import { siteCsp } from '../../server/http/csp.js';

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
  assert.ok(music.includes('mid|midi|rmi|kar'), 'the validator names the MIDI extensions');
  assert.ok(music.includes('midi|x-midi'), 'and the MIDI MIME types');
  assert.ok(music.includes('浏览器不能播放 MIDI 文件'), 'with a message that says what to do');
  const panel = read('public/js/ui/lobbyMusicPanel.js');
  assert.match(panel, /data-testid="lobby-upload-error"/, 'the card renders the reason');
  assert.match(panel, /\.catch\(\(err\) => setUploadError\(/, 'the upload rejection is surfaced, not swallowed');
  assert.doesNotMatch(panel, /music\.upload\(file\)\.catch\(\(\) => \{\}\)/, 'no silent catch left');
  const en = JSON.parse(read('public/i18n/en.json'));
  assert.equal(typeof en['浏览器不能播放 MIDI 文件，请先转成 MP3、WAV 或 OGG 再上传'], 'string');
});

test('the site policy lets the card play a blob: file, and 上海Major is not offered', () => {
  // 「我的桌面有一个mp3文件，也没法上传」 (owner report 2026-10-20): without media-src, default-src 'self' blocked the
  // blob: URL the card hands to <audio> for its metadata probe, so every upload failed as 「无法播放该音频」.
  const csp = siteCsp(join(ROOT, 'public'));
  assert.match(csp, /media-src 'self' blob:/, 'blob: media stays legal under the site policy');
  assert.ok(!csp.includes('unsafe-eval'), 'the relaxation is only media-src');
  const panel = read('public/js/ui/lobbyMusicPanel.js');
  assert.match(panel, /x\.id !== 'lobby' && x\.id !== 'major'/, '上海Major has no shipped file — not listed');
  assert.doesNotMatch(panel, /\['official', \.\.\.BGM_TRACKS\.filter\(\(x\) => x\.id !== 'lobby'\)\.map/, 'the 上海Major entry is gone from the picker');
});
