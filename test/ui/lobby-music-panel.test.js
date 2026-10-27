// 大厅音乐面板 (ui/lobbyMusicPanel.js; the owner's request of 2026-10-20): the card, the picks it writes, and the
// audio.js plumbing behind them — a packaged track instead of the lobby's own, the lobby's own gain, its own volume.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AudioManager, lobbyTrackOf } from '../../public/js/audio.js';
import { BGM_TRACKS, pickedBgm, sanitizeBgmChoice } from '../../public/js/bgmChoice.js';
import { LOBBY_LIBRARY, LOBBY_GROUPS } from '../../public/js/lobbyMusicLibrary.js';
import { lobbyTrackName } from '../../public/js/ui/lobbyMusicPanel.js';
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
  // 维护者 2026-10-27: 下拉列表整个删了，bgmChoice.js 的 BGM_TRACKS 不再出现在大厅卡片里（上海Major 自然也不在）
  assert.doesNotMatch(panel, /BGM_TRACKS/, 'the lobby card no longer lists the packaged BGM_TRACKS');
  assert.match(panel, /LOBBY_LIBRARY\.filter/, 'the picker is the 音乐库');
});

test('the dropdown owns the lobby: switching away from 自选上传 stops the player\'s file, and its volume is the lobby gain', () => {
  // 「受控制不了，不能切歌，不能调音量」 (owner report 2026-10-20): the uploaded file's override never asked which pick was
  // active (so every later pick was ignored), and customGain connected once to whatever gain existed at that moment
  // (the master BGM gain before audio.js had built the lobby gain), so the lobby volume slider did nothing to it.
  const src = read('public/js/ui/lobbyMusic.js');
  assert.match(src, /const customPicked = \(\) => \(settingsStore\.get\(\)\.lobbyTrack \|\| 'official'\) === 'custom'/, 'the pick is read from settings');
  assert.match(src, /lobbyMusicOverride = key => \{\n\s*const override = key === 'lobby' && customPicked\(\)/, 'the override follows the pick');
  assert.match(src, /if \(!customPicked\(\)\) \{ clearHandoff\(\); fadeCustom\(false, true\); return; \}/, 'a packaged pick pauses the file');
  assert.match(src, /const parent = audio\.lobbyGain \|\| audio\.bgmGain;/, 'customGain follows the lobby gain when it exists');
  assert.match(src, /if \(customGain && parent && parent !== gainParent\) \{/, 'and is re-connected when audio.js builds it later');
  assert.match(src, /pickChanged\(\) \{ sync\(\); notify\(\); \}/);
  const panel = read('public/js/ui/lobbyMusicPanel.js');
  assert.match(panel, /music\.pickChanged\(\);/, 'the card tells lobbyMusic.js when the pick moves');
});

test('the player\'s own music is a local library: several files, all kept in this browser', () => {
  // 「所有上传的自选区不应该只能同时传一首，而是可以都保留在列表里面……都不要保留在服务器上」 (owner, 2026-10-20)
  const src = read('public/js/ui/lobbyMusic.js');
  assert.match(src, /let library = \[\], selectedId = '', playState/, 'a library, not a single record');
  assert.match(src, /const saveLibrary = \(\) => saved\(true, \{ tracks: library \}, 'library'\);/, 'the whole list is one IndexedDB record');
  assert.match(src, /saved\(true, \{ id: selectedId, \.\.\.playState \}, 'state'\)/, 'which entry plays is a separate record');
  assert.match(src, /library = \[\.\.\.library, \{ id, name: file\.name\.slice\(0, 180\), size: file\.size, blob: file/, 'uploading appends instead of replacing');
  assert.match(src, /await music\.select\(id\);/, 'and the new entry becomes the pick');
  assert.match(src, /async select\(id\) \{[\s\S]*?updateSettings\(\{ lobbyTrack: 'custom', lobbyCustomId: id \}\);/, 'the pick is written to settings');
  assert.match(src, /async remove\(id\) \{[\s\S]*?library = library\.filter\(\(x\) => x\.id !== id\);/, 'entries can be deleted');
  assert.match(src, /updateSettings\(\{ lobbyTrack: 'official', lobbyCustomId: '' \}\);/, 'deleting the last pick falls back to the official track');
  assert.match(src, /tracks: library\.map\(\(\{ id, name, size \}\) => \(\{ id, name, size \}\)\)/, 'the snapshot lists the library without the blobs');
  assert.ok(!/fetch\(|net\.request\(|XMLHttpRequest/.test(src), 'nothing about the music goes over the network');
  const panel = read('public/js/ui/lobbyMusicPanel.js');
  // 维护者 2026-10-27: 下拉列表（选曲列表）删了，音乐库本身是唯一的选曲入口
  assert.doesNotMatch(panel, /<select /, 'no 选曲列表 dropdown any more');
  assert.match(panel, /LOBBY_GROUPS\.map\(\(g\) => \{/, 'the library is grouped by category');
  assert.match(panel, /data-testid="lobby-library-track"/, 'every track is a row');
  assert.match(panel, /music\.select\(next\.slice\(7\)\)/, 'stepping onto an own file selects it');
  assert.match(panel, /data-testid="lobby-remove"/, 'the current entry can be deleted');
  const settings = read('public/js/ui/gameLogic/settings.js');
  assert.match(settings, /lobbyCustomId: ''/, 'the default settings know the entry');
  assert.match(settings, /lobbyCustomId: typeof r\.lobbyCustomId === 'string'/, 'and sanitize keeps it a string');
});

test('the 音乐 modal keeps only 对局音乐 — 大厅音乐 moved to the lobby card', () => {
  const src = read('public/js/ui/lobbyMusic.js');
  const button = src.slice(src.indexOf('export function LobbyMusicButton()'));
  assert.doesNotMatch(button, /大厅音乐<\/strong>/, 'no 大厅音乐 block in the modal');
  assert.doesNotMatch(button, /music\.upload\(/, 'and no upload of its own');
  assert.match(button, /<\$\{MatchMusic\} \/>/, '对局音乐 stays');
  assert.match(button, /大厅音乐已移到大厅左上角的「主界面音乐」卡片/, 'the modal points at the card');
});

test('对局音乐 lists the same local library as the lobby card', () => {
  // 「对局音乐里面的列表应该也和主界面音乐的列表一样啊」 (owner, 2026-10-20)
  const src = read('public/js/ui/lobbyMusic.js');
  assert.match(src, /export function syncMatchLocal\(\)/, 'the picked entries become object URLs for audio.js');
  assert.match(src, /const id = typeof pick === 'string' && pick\.startsWith\('custom:'\) \? pick\.slice\(7\) : ''/, 'a pick names a library entry');
  assert.match(src, /audio\.setBgmLocal\(kind, url, id \|\| null\);/, 'and the id travels with the URL');
  assert.match(src, /const id = await music\.add\(file\);/, 'uploading from 对局音乐 adds to the same library');
  assert.match(src, /tracks\.map\(\(x\) => html`<option key=\$\{x\.id\} value=\$\{`custom:\$\{x\.id\}`\}>/, 'every library entry is offered');
  assert.match(src, /<option value="__upload">\$\{t\('＋ 上传新的…'\)\}<\/option>/, 'with an upload entry');
  assert.match(src, /matchMusic = \{\n\s*\/\*\* Hand the picked library entries/, 'boot wires the picks up');
  assert.match(src, /for \(const kind of \['prep', 'combat'\]\) \{\n\s*const legacy = await saved\(false, undefined, kind\);/, 'old one-file 对局音乐 picks are adopted into the library');
  const bgm = read('public/js/bgmChoice.js');
  assert.match(bgm, /const CUSTOM_PICK = \/\^custom:\[A-Za-z0-9_-\]\{1,64\}\$\//, 'custom:<id> is a valid pick');
  const audio = read('public/js/audio.js');
  assert.match(audio, /setBgmLocal\(kind, url, id = null\)/, 'audio.js keeps the entry id');
});

// 主界面音乐库 (维护者 2026-10-27): selena 0.4.1's whole catalogue — 246 tracks in 7 groups. The pick resolves to its own
// file, and every entry ships (a listed track whose file is missing would silently fall back to the lobby music).
test('主界面音乐库: every track resolves through lobbyTrackOf and its file ships', () => {
  assert.equal(LOBBY_LIBRARY.length, 246, 'selena 0.4.1 published 246 tracks');
  assert.deepEqual([...LOBBY_GROUPS], ['悬赏 OST', '敌人 OST', '阵营 OST', '结算 OST', '其他 OST', '主界面', 'Boss OST']);
  const seen = new Set();
  for (const track of LOBBY_LIBRARY) {
    assert.match(track.id, /^lib_[0-9a-f]{20}(?:_[0-9a-f]+)?$/, `${track.title}: a stable file-hash id`);
    assert.ok(!seen.has(track.id), `${track.title}: the id is unique`);
    seen.add(track.id);
    assert.ok(track.title.trim(), `${track.id}: a title`);
    assert.ok(LOBBY_GROUPS.includes(track.group), `${track.title}: a known group`);
    assert.ok(track.groupName.trim(), `${track.title}: a sub-category`);
    assert.ok(Array.isArray(track.categories) && track.categories.length, `${track.title}: categories for 搜索`);
    assert.equal(lobbyTrackOf(MANIFEST, track.id)?.loop, track.url, `${track.title}: the pick plays its own file`);
    assert.ok(existsSync(join(ROOT, 'public', track.url)), `${track.title}: ${track.url} ships`);
    assert.equal(lobbyTrackName(track.id), track.title, `${track.title}: the card names it`);
  }
});

// 玩家 2026-10-27: 「对局音乐可选项也要和音乐库同步啊。还要新加一个条目，就是自己上传的，我说了自己上传不止上传一首。
// 还有把这个主界面的音乐模块做成可拖动的吧，现在展开会导致挤压下面反馈版的位置。」
test('对局音乐 offers the whole 音乐库 (grouped) and a 我上传的 group of every upload', () => {
  const src = read('public/js/ui/lobbyMusic.js');
  assert.match(src, /const LIB_GROUP_ROWS = LOBBY_GROUPS\.map\(/, 'the picker folds the library by its groups');
  assert.match(src, /<optgroup key=\$\{group\} label=\$\{t\('音乐库'\)/, 'each group is an <optgroup>');
  assert.match(src, /<optgroup label=\$\{t\('我上传的'\)\}>/, 'the player\'s own files are a group of their own');
  assert.match(src, /tracks\.map\(\(x\) => html`<option key=\$\{x\.id\} value=\$\{`custom:\$\{x\.id\}`\}>/, 'every upload is an entry');
  assert.match(src, /const id = await music\.add\(file\);/, 'uploading appends to the same library');
  // a library pick plays its own file in a match too (bgmChoice.js), and survives the settings sanitiser
  assert.match(read('public/js/bgmChoice.js'), /const LIB_PICK = \/\^lib_\[0-9a-f\]\{20\}/, 'lib_* is a valid pick');
  const lib = LOBBY_LIBRARY[0];
  assert.deepEqual(pickedBgm(MANIFEST, 'prep', { prep: lib.id }), { intro: null, loop: lib.url, choice: lib.id });
  assert.equal(sanitizeBgmChoice(lib.id), lib.id, 'the pick survives sanitizeSettings');
  assert.equal(sanitizeBgmChoice('lib_nonsense'), 'official', 'but only a real library id');
});

test('the 主界面音乐 card is draggable and its body no longer pushes 成就统计 / 反馈板 down', () => {
  const panel = read('public/js/ui/lobbyMusicPanel.js');
  assert.match(panel, /onPointerDown=\$\{onDown\}/, 'the header drags the card');
  assert.match(panel, /updateSettings\(\{ lobbyMusicPos: \{ x: Math\.round\(next\.x\), y: Math\.round\(next\.y\) \} \}\)/, 'the offset is kept in settings');
  assert.match(panel, /onDblClick=\$\{\(\) => updateSettings\(\{ lobbyMusicPos: null \}\)\}/, 'double-click puts it back');
  assert.match(panel, /style=\$\{`--dx:\$\{Math\.round\(at\.x\)\}px;--dy:\$\{Math\.round\(at\.y\)\}px`\}/, 'the offset drives the card');
  const css = read('public/css/screens/lobby.css');
  assert.match(css, /\.lobmusic__body \{ position: absolute; left: -1px; right: -1px; top: 100%/, 'the body floats over the page');
  assert.match(css, /\.lobmusic__head \{[^}]*cursor: grab; touch-action: none;/, 'the head reads as a drag handle');
  const settings = read('public/js/ui/gameLogic/settings.js');
  assert.match(settings, /lobbyMusicPos: null \}\)/, 'the default is where it ships');
  assert.match(settings, /lobbyMusicPos: Number\.isFinite\(r\.lobbyMusicPos\?\.x\)/, 'and a stored offset is sanitised');
});

test('the 音乐库 lists 我上传的 as its own group with every file kept', () => {
  const panel = read('public/js/ui/lobbyMusicPanel.js');
  assert.match(panel, /class="lobmusic__group lobmusic__group--own"/, 'a dedicated group');
  assert.match(panel, /<summary>\$\{t\('我上传的'\)\} <small>\$\{tracks\.length\}<\/small><\/summary>/, 'it counts every upload');
  assert.match(panel, /tracks\.filter\(\(x\) => !q \|\| String\(x\.name \|\| ''\)\.toLocaleLowerCase\(\)\.includes\(q\)\)/, 'search covers the file names too');
  assert.match(panel, /music\.select\(x\.id\)/, 'a row plays that file');
  assert.match(panel, /data-testid="lobby-upload"/, 'and it holds the upload button');
});
