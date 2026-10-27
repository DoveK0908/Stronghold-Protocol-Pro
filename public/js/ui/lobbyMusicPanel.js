// 大厅音乐面板 (ui/lobbyMusicPanel.js; the owner's request of 2026-10-20, reshaped 2026-10-27): the lobby's own card at
// the top-left — 主界面音乐 / RHODES RADIO — ⏮ ▶/⏸ ⏭ with 随机播放, a volume slider for the lobby alone (settings
// lobbyVolume; the 背景音乐 slider of 设置 stays the master BGM volume), and the 主界面音乐库 as the only picker.
// 维护者 2026-10-27 (玩家: 「这个音乐库和我们现在有的选曲列表不是重复了吗，只留音乐库就可以了」): the old track
// dropdown (the packaged 曲目表 + the 23 home entries) is gone — the library now carries selena 0.4.1's whole
// catalogue (246 tracks in 7 groups, lobbyMusicLibrary.js) and is grouped by 悬赏/阵营/Boss/敌人/结算/其他/主界面 with a
// search box. 官方大厅音乐 stays as the reset chip. The picks live in settings (lobbyTrack / lobbyShuffle / lobbyVolume /
// lobbyMusicOpen); audio.js plays the packaged ones (setLobbyPick / setLobbyPaused, its own gain), and a player's own file
// keeps playing through ui/lobbyMusic.js, which overrides the lobby key. The card only shows in the lobby.
import { html, Button } from './components.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { audio } from '../audio.js';
import { LOBBY_LIBRARY, LOBBY_GROUPS } from '../lobbyMusicLibrary.js';
import { t } from '../../../shared/i18n.js';
import { useSettings, updateSettings } from './settings.js';
import { music } from './lobbyMusic.js';

const LIB_IDS = Object.freeze(LOBBY_LIBRARY.map((x) => x.id));

/** The name of one column value (`lobbyTrack`) — 'official', a library id, or 'custom' (the player's own file). */
export function lobbyTrackName(id, customName = '') {
  if (id === 'official' || !id) return t('官方大厅音乐');
  if (id === 'custom') return customName || t('自选上传');
  const lib = LOBBY_LIBRARY.find((x) => x.id === id);
  if (lib) return lib.title;
  return customName || id;
}

const ICON = { prev: '◀◀', next: '▶▶', play: '▶', pause: '❚❚', fold: '▾', unfold: '▸' };

/**
 * The 大厅音乐 card of the lobby (top-left, above 成就统计). Rendered only in the lobby screen.
 */
export function LobbyMusicPanel() {
  const s = useSettings();
  const [state, setState] = useState(() => music.snapshot());
  const [uploadError, setUploadError] = useState('');
  const [libQuery, setLibQuery] = useState('');
  const input = useRef(null);
  const open = s.lobbyMusicOpen !== false;
  const pick = s.lobbyTrack || 'official';
  const tracks = state.tracks || [];
  const selectedCustom = tracks.find((x) => x.id === state.selectedId) || null;
  const custom = pick === 'custom' && !!selectedCustom;
  const column = custom ? `custom:${selectedCustom.id}` : pick;
  const playing = custom ? state.playing : !audio.lobbyPaused;
  const volume = Math.round((Number.isFinite(s.lobbyVolume) ? s.lobbyVolume : 1) * 100);

  useEffect(() => {
    // ui/lobbyMusic.js keeps the listeners of its own file (upload / playing state); subscribe when it exposes them
    const fn = () => setState(music.snapshot());
    return music.subscribe ? music.subscribe(fn) : undefined;
  }, []);

  const choose = (value) => {
    if (value === 'custom') {
      // a library entry: ui/lobbyMusic.js owns the file and writes lobbyTrack/lobbyCustomId itself
      setUploadError('');
      const target = tracks[0];
      if (!target) { input.current?.click(); return; }
      music.select(target.id).catch((e) => setUploadError(e?.message || t('音乐导入失败')));
      return;
    }
    updateSettings({ lobbyTrack: value });
    // the player's own file and the packaged tracks share the lobby key: tell ui/lobbyMusic.js the pick moved on
    music.pickChanged();
  };
  const options = ['official', ...LIB_IDS, ...tracks.map((x) => `custom:${x.id}`)];
  const step = (dir) => {
    const at = Math.max(0, options.indexOf(column));
    let next;
    if (s.lobbyShuffle) {
      const pool = options.filter((id) => id !== column);
      next = pool[Math.floor(Math.random() * pool.length)] || column;
    } else next = options[(at + dir + options.length) % options.length];
    if (next.startsWith('custom:')) {
      setUploadError('');
      music.select(next.slice(7)).catch((e) => setUploadError(e?.message || t('音乐导入失败')));
      return;
    }
    choose(next);
  };
  const toggle = () => {
    if (custom) { music.toggle(); return; }
    audio.setLobbyPaused(!audio.lobbyPaused);
    // audio.js has no listener of its own: re-render this card
    setState(music.snapshot());
  };

  const q = libQuery.trim().toLocaleLowerCase();
  const shown = LOBBY_LIBRARY.filter((x) => !q
    || x.title.toLocaleLowerCase().includes(q)
    || (x.categories || []).some((c) => c.toLocaleLowerCase().includes(q)));

  // 拖动卡片（玩家 2026-10-27：「把这个主界面的音乐模块做成可拖动的吧，现在展开会导致挤压下面反馈板的位置」）:
  // the section stays one header tall in the column, the expanded body floats over the page (CSS `position: absolute`),
  // and the card itself can be dragged anywhere — the offset is kept in settings (lobbyMusicPos).
  const pos = s.lobbyMusicPos && Number.isFinite(s.lobbyMusicPos.x) ? s.lobbyMusicPos : null;
  const box = useRef(null);
  const drag = useRef(null);
  const [live, setLive] = useState(null);
  const at = live || pos || { x: 0, y: 0 };
  // a stored offset from an older build could sit off screen (the first draggable build stored screen coordinates):
  // put the card back where it ships instead of leaving it unreachable
  useEffect(() => {
    if (!pos) return undefined;
    const id = requestAnimationFrame(() => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      const out = r.left < -4 || r.top < -4 || r.right > (window.innerWidth || 0) + 4 || r.bottom > (window.innerHeight || 0) + 4;
      if (out) updateSettings({ lobbyMusicPos: null });
    });
    return () => cancelAnimationFrame(id);
  }, [pos?.x, pos?.y]);
  // `at` is the card's offset from where it ships (CSS px), never a screen coordinate: the drag adds the pointer delta to
  // the offset it started with, and the clamp keeps the header reachable (a screen coordinate here made the card jump by
  // the column's own left/top — the first build flew off to the bottom right).
  const onDown = (e) => {
    if (e.button !== 0 || e.target?.closest?.('button')) return;
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    drag.current = { px: e.clientX, py: e.clientY, ox: at.x, oy: at.y, left: r.left - at.x, top: r.top - at.y, w: r.width, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.px) + Math.abs(e.clientY - d.py) > 3) d.moved = true;
    const minX = -d.left, maxX = Math.max(minX, (window.innerWidth || 0) - d.w - d.left - 8);
    const minY = -d.top, maxY = Math.max(minY, (window.innerHeight || 0) - 44 - d.top - 8);
    setLive({
      x: Math.round(Math.min(Math.max(minX, d.ox + e.clientX - d.px), maxX)),
      y: Math.round(Math.min(Math.max(minY, d.oy + e.clientY - d.py), maxY)),
    });
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) { setLive(null); return; }
    const next = live || at;
    setLive(null);
    updateSettings({ lobbyMusicPos: { x: Math.round(next.x), y: Math.round(next.y) } });
  };

  return html`<section class="lobmusic" data-open=${open ? '1' : '0'} data-track=${pick} aria-label=${t('主界面音乐')}
    ref=${box} style=${`--dx:${Math.round(at.x)}px;--dy:${Math.round(at.y)}px`} data-moved=${at.x || at.y ? '1' : '0'}>
    <header class="lobmusic__head" onPointerDown=${onDown} onPointerMove=${onMove}
      onPointerUp=${onUp} onPointerCancel=${onUp} onDblClick=${() => updateSettings({ lobbyMusicPos: null })}
      title=${t('按住拖动；双击复位')}>
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
      <div class="lobmusic__now" data-testid="lobby-now">${lobbyTrackName(column, selectedCustom?.name)}</div>
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
      <div class="lobmusic__libhead">
        <button type="button" class="lobmusic__chip" data-testid="lobby-official" aria-pressed=${pick === 'official'}
          onClick=${() => choose('official')}>${t('官方大厅音乐')}</button>
        <strong>${t('音乐库')} <small>${LOBBY_LIBRARY.length}</small></strong>
      </div>
      <input class="lobmusic__search" type="search" data-testid="lobby-library-search" aria-label=${t('搜索曲目')}
        placeholder=${t('搜索曲目')} value=${libQuery} onInput=${(e) => setLibQuery(e.currentTarget.value)} />
      <div class="lobmusic__groups" data-testid="lobby-library">
        ${tracks.length || q ? html`<details class="lobmusic__group lobmusic__group--own" key="__own" open=${!!q || tracks.length <= 3}>
            <summary>${t('我上传的')} <small>${tracks.length}</small></summary>
            <div class="lobmusic__list">
              ${tracks.filter((x) => !q || String(x.name || '').toLocaleLowerCase().includes(q)).map((x) => html`<button type="button" class="lobmusic__track" data-testid="lobby-library-track"
                data-group="__own" aria-pressed=${column === `custom:${x.id}`}
                onClick=${() => { setUploadError(''); music.select(x.id).catch((e) => setUploadError(e?.message || t('音乐导入失败'))); }}><span aria-hidden="true">${column === `custom:${x.id}` && !audio.lobbyPaused ? '♫' : '▷'}</span><span>${x.name}</span><small>${t('本机')}</small></button>`)}
              <button type="button" class="lobmusic__upload" data-testid="lobby-upload" onClick=${() => input.current?.click()}>${t('＋ 上传本地音乐')}</button>
            </div>
          </details>` : html`<button type="button" class="lobmusic__upload" data-testid="lobby-upload"
            onClick=${() => input.current?.click()}>${t('＋ 上传本地音乐')}</button>`}
        ${LOBBY_GROUPS.map((g) => {
          const rows = shown.filter((x) => x.group === g);
          if (!rows.length) return null;
          return html`<details class="lobmusic__group" key=${g} open=${!!q}>
            <summary>${g} <small>${rows.length}</small></summary>
            <div class="lobmusic__list">
              ${rows.map((x) => html`<button type="button" class="lobmusic__track" data-testid="lobby-library-track"
                data-group=${x.group} aria-pressed=${pick === x.id}
                onClick=${() => choose(x.id)}><span aria-hidden="true">${pick === x.id && !audio.lobbyPaused ? '♫' : '▷'}</span><span>${x.title}</span><small>${x.groupName}</small></button>`)}
            </div>
          </details>`;
        })}
      </div>
      ${custom ? html`<div class="lobmusic__file">
        <small data-testid="lobby-file">${selectedCustom.name}</small>
        <${Button} size="sm" variant="secondary" onClick=${() => input.current?.click()}>${t('更换')}<//>
        <${Button} size="sm" variant="secondary" class="lobmusic__remove" data-testid="lobby-remove"
          onClick=${() => music.remove(selectedCustom.id).catch((e) => setUploadError(e?.message || t('音乐导入失败')))}>${t('删除')}<//>
      </div>` : null}
      ${uploadError ? html`<p class="lobmusic__note is-bad" data-testid="lobby-upload-error">${uploadError}</p>` : null}
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
