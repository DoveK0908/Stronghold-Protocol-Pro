import { PHASE } from '../../../shared/constants.js';
import { html, Button, Modal } from './components.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { store, selectRoute } from '../store.js';
import { audio, bgmKeyFor } from '../audio.js';
import { BGM_TRACKS, BGM_CHOICES } from '../bgmChoice.js';
import { useSettings, updateSettings, settingsStore } from './settings.js';
import { t, N_ } from '../../../shared/i18n.js';

export const MAX_MUSIC_BYTES = 20 * 1024 * 1024;
const listeners = new Set();
// The player's own lobby music is a *library* (the owner's request of 2026-10-20): every upload stays in this
// browser's IndexedDB — nothing is ever sent to a server — the card lists them all, and settings (lobbyTrack +
// lobbyCustomId) say which one plays.
let library = [], selectedId = '', playState = { enabled: true, paused: false };
let record = null, url = null, media = null, source = null, revision = 0, installed = false, dbPromise;
let status = N_('默认大厅音乐'), busy = false, lastRoute;
const notify = () => listeners.forEach(fn => fn(music.snapshot()));
let videoAudible=false;
const inMusicArea = () => { const s=store.get(),route=selectRoute(s);return ['lobby','room'].includes(route)||(route==='game'&&[PHASE.INFO_CHECK,PHASE.BAND_DRAFT,PHASE.BATTLE_CHECK].includes(s.match?.public?.phase)); };
let customGain=null,gainParent=null,fadeTarget=0,fadeTimer,handoff=false,handoffTimer;
// the 大厅音乐 card's dropdown owns the choice: 'custom' is this player's own library, any other pick is a packaged
// track (audio.js plays it) — the library must not override the pick once the player switches away from it.
const customPicked = () => (settingsStore.get().lobbyTrack || 'official') === 'custom';
const customId = () => selectedId || settingsStore.get().lobbyCustomId || '';
const entryOf = (id) => library.find((x) => x?.id === id) || null;
const areaKey = () => selectRoute(store.get()) + ':' + inMusicArea();
function db() {
  return dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('sp-lobby-music', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('tracks');
    req.onsuccess = () => { const result = req.result; result.onversionchange = () => result.close(); resolve(result); };
    req.onerror = () => { dbPromise = null; reject(Error(t('浏览器无法保存音乐，请检查可用空间'))); };
  });
}
async function saved(write, value, key = 'lobby') {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('tracks', write ? 'readwrite' : 'readonly'), table = tx.objectStore('tracks');
    const req = write ? value ? table.put(value, key) : table.delete(key) : table.get(key);
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(Error(t('音乐保存失败，可能是浏览器存储空间不足')));
  });
}
const saveLibrary = () => saved(true, { tracks: library }, 'library');
const saveState = () => saved(true, { id: selectedId, ...playState }, 'state');
async function validate(file, maxSeconds = 0) {
  if (!file || file.size <= 0) throw Error(t('请选择有效的音频文件'));
  if (file.size > MAX_MUSIC_BYTES) throw Error(t('音乐不能超过 20MB，请选择较小的文件'));
  // MIDI is not a browser-playable audio file: the <audio> probe cannot decode it, so say why instead of a silent no-op
  if (/\.(mid|midi|rmi|kar)$/i.test(file.name || '') || /audio\/(midi|x-midi)$/i.test(file.type || '')) throw Error(t('浏览器不能播放 MIDI 文件，请先转成 MP3、WAV 或 OGG 再上传'));
  if (!/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i.test(file.name || '') || (file.type && !file.type.startsWith('audio/') && file.type !== 'video/webm' && file.type !== 'application/ogg')) throw Error(t('请选择 MP3、M4A、OGG、WAV 等音频文件'));
  const objectUrl = URL.createObjectURL(file), probe = new Audio(); probe.preload = 'metadata';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(t('音频读取超时，请尝试其他文件'))), 10000);
      probe.onloadedmetadata = () => {
        clearTimeout(timer);
        if (!(Number.isFinite(probe.duration) && probe.duration > 0)) reject(Error(t('音频文件无效')));
        else if (maxSeconds && probe.duration > maxSeconds) reject(Error(t('对局音乐最长 5 分钟，请选择较短的曲子')));
        else resolve();
      };
      probe.onerror = () => { clearTimeout(timer); reject(Error(t('浏览器无法播放该音频，请尝试 MP3 或 M4A'))); };
      probe.src = objectUrl;
    });
  } finally { probe.onloadedmetadata = probe.onerror = null; probe.removeAttribute('src'); probe.load(); URL.revokeObjectURL(objectUrl); }
}
function replace(next) {
  if (media) { media.pause(); media.removeAttribute('src'); media.load(); }
  if (url) URL.revokeObjectURL(url);
  record = next; url = next?.blob ? URL.createObjectURL(next.blob) : null;
  if (media && url) media.src = url;
}
function fadeCustom(on, immediate = false) {
  const target = on ? 1 : 0;
  if (target === fadeTarget && !immediate) return;
  clearTimeout(fadeTimer);fadeTarget = target;
  if (!customGain || !audio.ctx || immediate) { if (!on) media?.pause();if(customGain)customGain.gain.value=target;return; }
  const t=audio.ctx.currentTime,g=customGain.gain;
  if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
  else {g.cancelScheduledValues(t);g.setValueAtTime(g.value,t);}
  g.linearRampToValueAtTime(target,t+0.9);
  if (!on) fadeTimer=setTimeout(()=>{if(fadeTarget===0){media.pause();notify();}},1000);
}
function clearHandoff() { clearTimeout(handoffTimer);handoff=false; }
function sync() {
  if (!media || !record) return;
  // the card's dropdown is authoritative: any pick other than 'custom' plays a packaged track instead
  if (!customPicked()) { clearHandoff(); fadeCustom(false, true); return; }
  if ((videoAudible&&selectRoute(store.get())==='lobby') || !playState.enabled || playState.paused || document.hidden || audio.bgmSilent) {clearHandoff();fadeCustom(false,true);return;}
  if (!inMusicArea()) {
    // Keep the old music while the next game's BGM buffer is loading.
    if (selectRoute(store.get())==='game' && !media.paused && fadeTarget>0) {
      if (!handoff) {handoff=true;handoffTimer=setTimeout(()=>{clearHandoff();fadeCustom(false);},10000);}
    } else fadeCustom(false);
    return;
  }
  clearHandoff();
  if (!audio.ctx) return;
  if (!source) {source=audio.ctx.createMediaElementSource(media);customGain=audio.ctx.createGain();customGain.gain.value=0;source.connect(customGain);}
  // the lobby's own gain (settings 大厅音乐音量) when audio.js has made one, the master BGM gain otherwise
  const parent = audio.lobbyGain || audio.bgmGain;
  if (customGain && parent && parent !== gainParent) {
    try { customGain.disconnect(); } catch { /* nothing connected yet */ }
    customGain.connect(parent); gainParent = parent;
  }
  fadeCustom(true);
  if (!media.paused) return;
  media.play().then(()=>{status=t('正在播放 · 单曲循环');notify();},()=>{status=t('点击“播放”开始音乐');notify();});
}

function refresh() {
  const s = store.get(); audio.playBgm(bgmKeyFor(selectRoute(s), s.match?.public)); sync(); notify();
}
function install() {
  if (installed) return; installed = true;
  media = new Audio(); media.loop = true; media.preload = 'none';
  media.onerror = () => { playState.enabled = false; status = t('音乐播放失败，已恢复默认音乐'); refresh(); };
  audio.lobbyMusicOverride = key => {
    const override = key === 'lobby' && customPicked() && ((videoAudible&&selectRoute(store.get())==='lobby') || (playState.enabled&&inMusicArea()));
    sync();
    return !!override;
  };
  audio.lobbyMusicBgmStarted = () => { if (!inMusicArea()) {clearHandoff();fadeCustom(false);} };
  window.addEventListener('sp:lobby-video-audio', e => {videoAudible=!!e.detail?.active;refresh();});
  lastRoute = areaKey();
  store.subscribe(() => { const route = areaKey(); if (route !== lastRoute) { lastRoute = route; refresh(); } else sync(); });
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pointerdown', () => { if (playState.enabled) { audio._unlock(); sync(); } }, { passive: true });
  const initialRevision = revision;
  (async () => {
    try {
      const lib = await saved(false, undefined, 'library');
      const st = await saved(false, undefined, 'state');
      if (revision !== initialRevision) return;
      library = Array.isArray(lib?.tracks) ? lib.tracks.filter((x) => x?.id && x?.blob?.size > 0) : [];
      if (!library.length) {
        // one-file layouts (before the library) kept the file under the 'lobby' key: adopt it instead of dropping it
        const legacy = await saved(false);
        if (legacy?.blob?.size > 0) {
          library = [{ id: 'legacy', name: legacy.name || 'lobby', size: legacy.blob.size, blob: legacy.blob, addedAt: Date.now() }];
          selectedId = 'legacy';
          playState = { enabled: legacy.enabled !== false, paused: !!legacy.paused };
          await saveLibrary(); await saveState(); await saved(true, null);
        }
      }
      // one-file 对局音乐 layouts (settings bgmPrep / bgmCombat = 'custom') kept their file under the kind's key
      for (const kind of ['prep', 'combat']) {
        const legacy = await saved(false, undefined, kind);
        if (!legacy?.blob?.size) continue;
        const id = `m${kind}`;
        if (!entryOf(id)) { library = [...library, { id, name: legacy.name || kind, size: legacy.blob.size, blob: legacy.blob, addedAt: Date.now() }]; await saveLibrary(); }
        const key = kind === 'prep' ? 'bgmPrep' : 'bgmCombat';
        if ((settingsStore.get()[key] || 'official') === 'custom') updateSettings({ [key]: `custom:${id}` });
        await saved(true, null, kind);
      }
      if (st?.id && entryOf(st.id)) { selectedId = st.id; playState = { enabled: st.enabled !== false, paused: !!st.paused }; }
      if (!selectedId) selectedId = library[0]?.id || '';
      replace(entryOf(customId()));
      status = record ? (playState.paused ? t('已暂停') : t('点击“播放”开始音乐')) : N_('默认大厅音乐');
      syncMatchLocal();
      refresh();
    } catch { status = t('浏览器暂不能保存音乐，可稍后重试'); notify(); }
  })();
}
// debug surface for the browser probes (only with ?debug-music in the URL; nothing in a normal page)
if (typeof window !== 'undefined' && window.location.search.includes('debug-music')) {
  window.__spMusic = () => ({ ...music.snapshot(), pausedFocus: typeof media !== 'undefined' && media ? media.paused : null });
  window.__spAudio = () => audio;
}
export const music = {
  /** Subscribe to the player's own library (upload / pick / toggle / remove): the 大厅音乐 card reads it. */
  subscribe(fn) { install(); listeners.add(fn); fn(music.snapshot()); return () => listeners.delete(fn); },
  snapshot: () => ({
    tracks: library.map(({ id, name, size }) => ({ id, name, size })),
    selectedId: customId(),
    name: record?.name || '', size: record?.blob?.size || 0,
    enabled: playState.enabled, paused: playState.paused,
    playing: !!media && !media.paused, status, busy,
  }),
  /** Add one file to the local library (nothing leaves this browser); returns its id. */
  async add(file) {
    if (busy) return ''; install(); busy = true; notify();
    try {
      await validate(file);
      const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      library = [...library, { id, name: file.name.slice(0, 180), size: file.size, blob: file, addedAt: Date.now() }];
      await saveLibrary();
      syncMatchLocal();
      status = t('已添加到大厅音乐列表');
      return id;
    } catch (e) { status = e.message || t('音乐导入失败'); throw e; }
    finally { busy = false; notify(); }
  },
  /** Add one file to the library and play it in the lobby (the card's upload button). */
  async upload(file) {
    if (busy) return;
    const id = await music.add(file);
    if (id) await music.select(id);
  },
  /** Play one library entry; the card's dropdown calls this (and settings follow it). */
  async select(id) {
    install();
    const entry = entryOf(id);
    if (!entry) return;
    ++revision;
    selectedId = id;
    playState = { enabled: true, paused: false };
    replace(entry);
    updateSettings({ lobbyTrack: 'custom', lobbyCustomId: id });
    await saveState();
    status = t('正在播放 · 单曲循环');
    syncMatchLocal();
    audio._unlock(); refresh(); notify();
  },
  /** Drop one entry from the library; a deleted pick falls back to the next entry (or the official track). */
  async remove(id) {
    if (busy) return; install(); busy = true; notify();
    try {
      library = library.filter((x) => x.id !== id);
      await saveLibrary();
      if (customId() === id) {
        const next = library[0];
        if (next) await music.select(next.id);
        else {
          selectedId = '';
          replace(null);
          updateSettings({ lobbyTrack: 'official', lobbyCustomId: '' });
          await saveState();
          status = t('默认大厅音乐');
          refresh();
        }
      }
      syncMatchLocal();
    } finally { busy = false; notify(); }
  },
  async toggle() {
    if (!record || busy) return; ++revision;
    playState = { ...playState, enabled: true, paused: !playState.paused };
    await saveState();
    status = playState.paused ? t('已暂停') : t('正在播放 · 单曲循环');
    audio._unlock(); refresh(); notify();
  },
  /** 恢复默认: forget the whole local library and play the official lobby track again. */
  async reset() {
    if (busy) return; install(); busy = true; notify();
    try {
      ++revision; library = []; selectedId = '';
      replace(null); playState = { enabled: true, paused: false };
      await Promise.all([saveLibrary(), saveState()]);
      updateSettings({ lobbyTrack: 'official', lobbyCustomId: '' });
      status = t('默认大厅音乐'); refresh(); syncMatchLocal();
    } finally { busy = false; notify(); }
  },
  /** The card switched the pick: stop or restart the player's own file. */
  pickChanged() { sync(); notify(); },
};

// 对局音乐 (the owner's request of 2026-10-15): the 休整期 / 作战 BGM, official by default — bgmChoice.js, settings
// bgmPrep / bgmCombat. 休整期 offers every track but its own official one (that is 官方); 作战's 官方 is the round table.
// 自选曲 is a file of the player's, one per kind, kept like the lobby music (the same IndexedDB store, keys 'prep' /
// 'combat'; nothing goes to a server) and handed to audio.js as an object URL. It is decoded whole like the official
// tracks (the lobby music streams), so it may last MAX_MATCH_MUSIC_S at most: 5 minutes are ~115 MB of PCM.
export const MAX_MATCH_MUSIC_S = 300;
const MATCH_KINDS = ['prep', 'combat'];
// the object URLs audio.js plays for each kind, with the library id they came from (so a switch revokes the old one)
const matchLocal = { prep: null, combat: null };
/**
 * Point audio.js at the library entry 休整期 / 作战 picked (`custom:<id>`), revoking the URL of the old one. The library
 * is shared with the 大厅音乐 card: a file uploaded for one place can be picked in the other.
 */
export function syncMatchLocal() {
  install();
  const settings = settingsStore.get();
  for (const kind of MATCH_KINDS) {
    const pick = kind === 'prep' ? settings.bgmPrep : settings.bgmCombat;
    const id = typeof pick === 'string' && pick.startsWith('custom:') ? pick.slice(7) : '';
    const prev = matchLocal[kind];
    if ((prev?.id || '') === id) continue;
    if (prev?.url) URL.revokeObjectURL(prev.url);
    const entry = id ? entryOf(id) : null;
    const url = entry ? URL.createObjectURL(entry.blob) : null;
    matchLocal[kind] = id && url ? { id, url } : null;
    audio.setBgmLocal(kind, url, id || null);
  }
}
export const matchMusic = {
  /** Hand the picked library entries to audio.js (main.js boot: a page that resumes a match never opens the lobby). */
  load() { install(); syncMatchLocal(); },
  /** The file name of the entry this kind picked ('' when it picked an official track). */
  name(kind) {
    const pick = kind === 'prep' ? settingsStore.get().bgmPrep : settingsStore.get().bgmCombat;
    const id = typeof pick === 'string' && pick.startsWith('custom:') ? pick.slice(7) : '';
    return id ? entryOf(id)?.name || '' : '';
  },
};
const PREP_PICKS = BGM_CHOICES.filter((id) => id !== 'prep' && id !== 'custom');
const COMBAT_PICKS = BGM_CHOICES.filter((id) => id !== 'custom');
const trackName = (id, customName = '') => (id === 'official' ? t('官方（默认）') : id?.startsWith?.('custom:') ? customName || t('自选上传') : id === 'custom' ? t('自选曲') : t(BGM_TRACKS.find((x) => x.id === id)?.name || id));
function BgmPick({ kind, label, value, options, tracks, onPick, busy, action }) {
  const input = useRef(null);
  const customId = typeof value === 'string' && value.startsWith('custom:') ? value.slice(7) : '';
  const name = customId ? tracks.find((x) => x.id === customId)?.name || '' : '';
  const upload = (file) => action(async () => {
    const id = await music.add(file);
    if (id) onPick(`custom:${id}`);
  });
  const fileInput = html`<input ref=${input} type="file" accept=".mp3,.m4a,.ogg,.wav,.aac,.flac,.webm,audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/x-wav,audio/aac,audio/flac,audio/webm" hidden
    onChange=${(e) => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (file) upload(file); }} />`;
  return html`<div style="display:grid;gap:6px;min-width:0">
    <label style="display:grid;grid-template-columns:4.5em minmax(0,1fr);align-items:center;gap:10px;font-size:13px">
      <span>${label}</span>
      <span class="lang-select" style="display:block;min-width:0"><select data-testid=${`bgm-${kind}`} style="width:100%" value=${value} onChange=${(e) => {
        const next = e.currentTarget.value;
        if (next === '__upload') { input.current?.click(); return; }
        onPick(next);
      }}>
        ${options.map((id) => html`<option key=${id} value=${id}>${trackName(id)}</option>`)}
        ${tracks.map((x) => html`<option key=${x.id} value=${`custom:${x.id}`}>${trackName(`custom:${x.id}`, x.name)}</option>`)}
        <option value="__upload">${t('＋ 上传新的…')}</option>
      </select></span>
    </label>
    ${customId ? html`<div style="display:flex;align-items:center;gap:8px;padding-left:calc(4.5em + 10px);min-width:0">
      <small data-testid=${`bgm-${kind}-file`} style="flex:1;min-width:0;font-size:12px;overflow-wrap:anywhere;color:${name ? 'var(--mint,#58d9b5)' : 'var(--muted)'}">${name || t('文件已不存在')}</small>
      ${fileInput}
      <${Button} size="sm" disabled=${busy} onClick=${() => input.current?.click()}>${busy ? t('正在导入…') : t('更换')}<//>
      <${Button} size="sm" variant="secondary" disabled=${busy} onClick=${() => onPick('official')}>${t('清除')}<//>
    </div>` : fileInput}
  </div>`;
}
function MatchMusic() {
  const s = useSettings();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [tracks, setTracks] = useState(() => music.snapshot().tracks);
  useEffect(() => music.subscribe((snap) => setTracks(snap.tracks)), []);
  // the library entries behind `custom:<id>` picks: rebuild the object URLs audio.js plays whenever either moves
  useEffect(() => { syncMatchLocal(); }, [s.bgmPrep, s.bgmCombat, tracks]);
  const action = async (fn) => {
    setError(''); setBusy(true);
    try { await fn(); } catch (e) { setError(e.message || t('音乐导入失败')); } finally { setBusy(false); }
  };
  const pick = (kind, value) => updateSettings({ [kind === 'prep' ? 'bgmPrep' : 'bgmCombat']: value });
  return html`<div style="display:grid;gap:10px;padding-top:14px;border-top:1px solid rgba(223,230,226,.14);min-width:0">
    <strong style="font-size:15px">${t('对局音乐')}</strong>
    <${BgmPick} kind="prep" label=${t('休整期')} value=${s.bgmPrep} options=${PREP_PICKS} tracks=${tracks} busy=${busy} action=${action} onPick=${(v) => pick('prep', v)} />
    <${BgmPick} kind="combat" label=${t('作战')} value=${s.bgmCombat} options=${COMBAT_PICKS} tracks=${tracks} busy=${busy} action=${action} onPick=${(v) => pick('combat', v)} />
    ${error ? html`<p role="alert" style="margin:0;color:#ff9393;font-size:13px;overflow-wrap:anywhere">${error}</p>` : null}
    <small style="color:var(--muted);font-size:12px;line-height:1.6">${t('只改变你自己听到的音乐。自选曲和主界面音乐共用本机曲库，每首最长 5 分钟。作战的官方音乐：第 1–7 回合《无畏者》，第 8 回合起《骑士之日》；联防、最终攻势和隐秘核心保持官方音乐。')}</small>
  </div>`;
}

export function LobbyMusicButton() {
  const [open, setOpen] = useState(false);
  return html`<${Button} variant="secondary" size="sm" square=${true} class="hub-music-btn" title=${t('音乐')} aria-label=${t('音乐')} onClick=${() => setOpen(true)}><span style="font-size:22px;line-height:1" aria-hidden="true">♫</span><//>
    <style>.lobby-music-panel .modal__head{padding:14px 16px 4px}.lobby-music-panel .modal__title{font-size:18px}.lobby-music-panel .modal__head>:first-child{font-size:10px}.lobby-music-panel .modal__body{padding:12px 16px 16px}.lobby-music-panel .modal__actions{padding:10px 16px}.lobby-music-panel button{font-size:13px;min-height:36px;padding:8px 12px}.lobby-music-panel select{height:36px;font-size:13px}@media (pointer: coarse){.lobby-music-panel select{height:44px;font-size:16px}}</style>
    <${Modal} class="lobby-music-panel" open=${open} title=${t('音乐')} micro="MUSIC" width="min(420px, calc(100vw - 32px))" onClose=${() => setOpen(false)} actions=${html`<${Button} variant="secondary" onClick=${() => setOpen(false)}>${t('关闭')}<//>`}>
      <div style="display:grid;gap:14px;padding:8px 0;min-width:0">
        <${MatchMusic} />
        <small style="color:var(--muted);font-size:12px;line-height:1.6">${t('大厅音乐已移到大厅左上角的「主界面音乐」卡片：可以添加多首自选曲，切换、随机播放和单独的音量都在那里。自选曲只保存在本机浏览器，不上传服务器。')}</small>
      </div>
    <//>`;
}
