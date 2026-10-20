// 大厅音乐面板 (ui/lobbyMusicPanel.js; the owner's request of 2026-10-20): the lobby's own card at the top-left —
// 主界面音乐 / RHODES RADIO — a track dropdown (the packaged tracks of bgmChoice.js BGM_TRACKS, 官方大厅音乐, and the
// player's own file), ⏮ ▶/⏸ ⏭ with 随机播放, and a volume slider for the lobby alone (settings lobbyVolume; the
// 背景音乐 slider of 设置 stays the master BGM volume). The picks live in settings (lobbyTrack / lobbyShuffle /
// lobbyVolume / lobbyMusicOpen); audio.js plays the packaged ones (setLobbyPick / setLobbyPaused, its own gain), and a
// player's own file keeps playing through ui/lobbyMusic.js, which overrides the lobby key. The card only shows in the
// lobby: other screens keep their music.
import { html, Button } from './components.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { audio } from '../audio.js';
import { BGM_TRACKS } from '../bgmChoice.js';
import { t } from '../../../shared/i18n.js';
import { useSettings, updateSettings } from './settings.js';
import { music } from './lobbyMusic.js';

/** The track names the dropdown offers; 'custom' is the player's own file (lobbyMusic.js), 'official' the lobby's own. */
const TRACK_IDS = Object.freeze(['official', ...BGM_TRACKS.filter((x) => x.id !== 'lobby').map((x) => x.id), 'custom']);

/** The name of one column value (`lobbyTrack`). */
export function lobbyTrackName(id, customName = '') {
  if (id === 'official') return t('官方大厅音乐');
  if (id === 'custom') return customName || t('自选上传');
  return t(BGM_TRACKS.find((x) => x.id === id)?.name || id);
}

const ICON = { prev: '◀◀', next: '▶▶', play: '▶', pause: '❚❚', fold: '▾', unfold: '▸' };

/**
 * The 大厅音乐 card of the lobby (top-left, above 成就统计). Rendered only in the lobby screen.
 */
export function LobbyMusicPanel() {
  const s = useSettings();
  const [state, setState] = useState(() => music.snapshot());
  const [uploadError, setUploadError] = useState('');
  const input = useRef(null);
  const open = s.lobbyMusicOpen !== false;
  const pick = s.lobbyTrack || 'official';
  const custom = pick === 'custom';
  const playing = custom ? state.playing : !audio.lobbyPaused;
  const volume = Math.round((Number.isFinite(s.lobbyVolume) ? s.lobbyVolume : 1) * 100);

  useEffect(() => {
    // ui/lobbyMusic.js keeps the listeners of its own file (upload / playing state); subscribe when it exposes them
    const fn = () => setState(music.snapshot());
    return music.subscribe ? music.subscribe(fn) : undefined;
  }, []);

  const choose = (id) => {
    updateSettings({ lobbyTrack: id });
    if (id === 'custom' && !state.name) input.current?.click();
  };
  const step = (dir) => {
    const at = Math.max(0, TRACK_IDS.indexOf(pick));
    let next;
    if (s.lobbyShuffle) {
      const pool = TRACK_IDS.filter((id) => id !== pick);
      next = pool[Math.floor(Math.random() * pool.length)] || pick;
    } else next = TRACK_IDS[(at + dir + TRACK_IDS.length) % TRACK_IDS.length];
    choose(next);
  };
  const toggle = () => {
    if (custom) { if (state.name) music.toggle(); else input.current?.click(); return; }
    audio.setLobbyPaused(!audio.lobbyPaused);
    // audio.js has no listener of its own: re-render this card
    setState(music.snapshot());
  };

  return html`<section class="lobmusic" data-open=${open ? '1' : '0'} data-track=${pick} aria-label=${t('主界面音乐')}>
    <header class="lobmusic__head">
      <span class="lobmusic__icon" aria-hidden="true">♫</span>
      <span class="lobmusic__titles">
        <strong>${t('主界面音乐')}</strong>
        <em>RHODES RADIO</em>
      </span>
      <${Button} size="sm" square=${true} variant="secondary" class="lobmusic__fold"
        title=${open ? t('收起') : t('展开')} aria-label=${open ? t('收起') : t('展开')}
        onClick=${() => updateSettings({ lobbyMusicOpen: !open })}>${open ? ICON.fold : ICON.unfold}<//>
    </header>
    ${open ? html`<div class="lobmusic__body">
      <div class="lobmusic__sel">
        <select data-testid="lobby-track" value=${pick} onChange=${(e) => choose(e.currentTarget.value)}>
          ${TRACK_IDS.map((id) => html`<option key=${id} value=${id}>${lobbyTrackName(id, state.name)}</option>`)}
        </select>
      </div>
      <div class="lobmusic__row">
        <button class="lobmusic__btn" data-act="prev" title=${t('上一首')} aria-label=${t('上一首')} onClick=${() => step(-1)}>${ICON.prev}</button>
        <button class="lobmusic__btn lobmusic__btn--play" data-act=${playing ? 'pause' : 'play'} data-testid="lobby-play"
          title=${playing ? t('暂停') : t('播放')} aria-label=${playing ? t('暂停') : t('播放')}
          onClick=${toggle}>${playing ? ICON.pause : ICON.play}</button>
        <button class="lobmusic__btn" data-act="next" title=${t('下一首')} aria-label=${t('下一首')} onClick=${() => step(1)}>${ICON.next}</button>
        <label class="lobmusic__shuffle" title=${t('随机播放')}>
          <input type="checkbox" data-testid="lobby-shuffle" checked=${s.lobbyShuffle === true} onChange=${(e) => updateSettings({ lobbyShuffle: e.currentTarget.checked })} />
          <span>${t('随机播放')}</span>
        </label>
      </div>
      <label class="lobmusic__vol">
        <span>${t('音量')}</span>
        <input type="range" min="0" max="100" step="1" value=${volume} data-testid="lobby-volume"
          aria-label=${t('大厅音乐音量')} onChange=${(e) => updateSettings({ lobbyVolume: Number(e.currentTarget.value) / 100 })} />
        <b>${volume}</b>
      </label>
      ${custom ? html`<div class="lobmusic__file">
        <small>${state.name || t('未选择文件')}</small>
        <${Button} size="sm" variant="secondary" onClick=${() => input.current?.click()}>${state.name ? t('更换') : t('选择文件')}<//>
      </div>` : null}
      ${custom && uploadError ? html`<p class="lobmusic__note is-bad" data-testid="lobby-upload-error">${uploadError}</p>` : null}
      <input ref=${input} type="file" accept=".mp3,.m4a,.ogg,.wav,.aac,.flac,.webm,audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/x-wav,audio/aac,audio/flac,audio/webm" hidden
        onChange=${(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!file) return;
          setUploadError('');
          // surface the reason (a MIDI file, too large, not decodable) instead of swallowing the rejection
          music.upload(file).catch((err) => setUploadError(err?.message || t('音乐导入失败')));
        }} />
    </div>` : null}
  </section>`;
}
