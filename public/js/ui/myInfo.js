// 界面#09: the lobby's 名片 button (头像 + 名字#四位 + 名片) and the 我的信息 dialog behind it — 修改头像 / 修改名片 /
// 统计数据 plus the 代号 and the four digits. The same name card the achievements page draws, at the top bar's height.
import { html, Icon, Modal, Button } from './components.js';
import { useState, useEffect, useRef } from '../../vendor/hooks.module.js';
import { useMyCard, setCardBackground, setCardAvatar, setAvatarLook, setCustomAvatar, customAvatarSrc } from './playerCard.js';
import { cardOperators, cardAvatarUrl } from './seatArt.js';
import { NameCardLayer, NameCardPicker } from './namecards.js';
import { AvatarPicker } from './opPicker.js';
import { Img, useGameData } from './gameComponents.js';
import { TrophyBadge } from './trophies.js';
import { openStats } from '../screens/stats.js';
import { uploadAvatar } from './customAvatar.js';
import { toast } from './toasts.js';
import { net, identity } from '../net.js';
import { useStore } from '../store.js';
import { settingsStore } from './settingsStore.js';
import { t } from '../../../shared/i18n.js';

/** `名字#1234` — the four digits when the server has given the session one, else just the name. `showTag` is
 *  设置「显示名字后面的编号」: off prints the bare 代号 and drops the digits. */
export function playerLabel(name, tag, showTag = true) {
  const who = name || t('博士');
  return showTag && typeof tag === 'string' && /^\d{4}$/.test(tag) ? `${who}#${tag}` : who;
}

/** playerLabel bound to 设置「显示名字后面的编号」. Every display takes it from here, so flipping the switch redraws the
 *  names where they stand (the room's seats, the 20-player 名单, the 选干员 draft, both 名片 cards). */
export function usePlayerLabel() {
  const show = useStore((s) => s.showTag !== false, Object.is, settingsStore);
  return (name, tag) => playerLabel(name, tag, show);
}

/**
 * The top bar's 名片 button: the name card layer, the avatar and `名字#1234`; opens 我的信息.
 * @param {{ me: any, onOpen: () => void }} props
 */
export function MeCard({ me, onOpen }) {
  const card = useMyCard();
  const label = usePlayerLabel();
  const face = customAvatarSrc(card) || cardAvatarUrl(card.avatar, undefined, card.avatarLook);
  return html`<button type="button" class="me-card" data-testid="me-card" onClick=${onOpen}
      title=${t('我的信息')} aria-label=${t('我的信息')}>
    <${NameCardLayer} card=${card.bg} />
    <span class="me-card__ava">
      <${Img} src=${face} alt="" fallback=${html`<span class="me-card__glyph">${[...(me?.name || '?')][0]}</span>`} />
    </span>
    <span class="me-card__text">
      <span class="me-card__name"><${TrophyBadge} count=${card.trophies} class="tbadge--inline" /><span class="me-card__label" data-testid="me-card-tag">${label(me?.name, me?.tag)}</span></span>
    </span>
  </button>`;
}

/**
 * 我的信息: the name card, 修改头像 / 修改名片 / 统计数据, and the 代号 / 四位编辑.
 * @param {{ me: any, onClose: () => void }} props
 */
export function MyInfoDialog({ me, onClose }) {
  const card = useMyCard();
  const label = usePlayerLabel();
  const gd = useGameData();
  const list = cardOperators(gd.ready ? gd.list('chess') : []);
  const [picking, setPicking] = useState(null); // 'avatar' | 'bg'
  const [draftName, setDraftName] = useState(me?.name || '');
  const [draftTag, setDraftTag] = useState(me?.tag || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [busyFace, setBusyFace] = useState(false);
  const fileRef = useRef(null);
  const pickFile = async (file) => {
    if (!file || busyFace) return;
    setBusyFace(true);
    const res = await uploadAvatar(file).catch((err) => ({ ok: false, err: String(err && err.message || err) }));
    setBusyFace(false);
    if (res.ok) { setCustomAvatar(res.id); toast(t('头像已上传')); } else toast(res.err || t('上传失败'), 'warn');
  };
  const face = customAvatarSrc(card) || cardAvatarUrl(card.avatar, gd.m, card.avatarLook);
  const tagOk = /^\d{4}$/.test(draftTag);
  const nameOk = draftName.trim().length > 0;
  const dirty = draftName.trim() !== (me?.name || '') || draftTag !== (me?.tag || '');
  // the save round-trip: a welcome carries the accepted pair (dialog closes), a NAME_TAKEN refusal keeps it open
  useEffect(() => {
    const onWelcome = () => { setSaving(false); onClose(); };
    const onErr = (err) => { if (err?.code === 'NAME_TAKEN') { setSaving(false); setError(t('这个「代号#四位数字」已经被占用，换一组再试。')); } };
    net.on('welcome', onWelcome);
    net.on('helloError', onErr);
    return () => { net.off('welcome', onWelcome); net.off('helloError', onErr); };
  }, []);
  const save = () => {
    if (saving || !tagOk || !nameOk) return;
    setSaving(true);
    setError('');
    const name = draftName.trim();
    identity.saveName(name);
    identity.saveTag(draftTag);
    net.setIdentity(name, draftTag);
  };
  return html`<${Modal} open=${true} title=${t('我的信息')} micro="ACCOUNT" ariaLabel=${t('我的信息')} trapFocus=${true} onClose=${onClose} class="me-info-dlg">
    <div class="me-info">
      <div class="ach-card has-nc me-info__card">
        <${NameCardLayer} card=${card.bg} />
        <button type="button" class="ach-card__ava" onClick=${() => setPicking('avatar')} title=${t('更换头像')} aria-label=${t('更换头像')}>
          <${Img} src=${face} alt="" fallback=${html`<span class="ach-card__glyph">${[...(me?.name || '?')][0]}</span>`} />
        </button>
        <span class="ach-card__who">
          <span class="ach-card__name" data-testid="me-info-tag">${label(me?.name, me?.tag)}</span>
        </span>
        <span class="ach-card__brand" aria-hidden="true">STRONGHOLD<br />PROTOCOL</span>
      </div>
      <div class="me-info__actions">
        <button type="button" class="btn btn--ghost btn--sm" onClick=${() => setPicking('avatar')}><${Icon} name="user" />${t('修改头像')}</button>
        <button type="button" class="btn btn--ghost btn--sm" onClick=${() => fileRef.current?.click()} disabled=${busyFace}><${Icon} name="plus" />${busyFace ? t('上传中…') : t('上传头像')}</button>
        <button type="button" class="btn btn--ghost btn--sm" onClick=${() => setPicking('bg')}><${Icon} name="edit" />${t('修改名片')}</button>
        <input ref=${fileRef} type="file" accept="image/png,image/jpeg,image/webp" class="me-info__file" data-testid="avatar-upload"
          onChange=${(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; pickFile(f); }} />
        <button type="button" class="btn btn--ghost btn--sm" onClick=${() => { onClose(); openStats(); }}><${Icon} name="chart" />${t('统计数据')}</button>
      </div>
      <div class="me-info__rename">
        <label class="me-info__field">
          <span>${t('代号')}</span>
          <input type="text" maxlength="12" value=${draftName} data-testid="me-info-name-input"
            onInput=${(e) => setDraftName(e.currentTarget.value)} />
        </label>
        <label class="me-info__field me-info__field--tag">
          <span>${t('编号')}</span>
          <input type="text" inputmode="numeric" maxlength="4" value=${draftTag} data-testid="me-info-tag-input"
            onInput=${(e) => setDraftTag(e.currentTarget.value.replace(/\D/g, '').slice(0, 4))} />
        </label>
        <${Button} variant="primary" size="sm" disabled=${!dirty || !tagOk || !nameOk || saving} onClick=${save}>${saving ? t('保存中…') : t('保存')}<//>
      </div>
      <p class=${`me-info__hint${tagOk ? '' : ' is-bad'}`}>
        ${tagOk ? t('编号是名字后面的四位数字，先到先得：同一个「代号#编号」只能被一个浏览器占用。') : t('编号必须是四位数字（1000–9999）。')}
      </p>
      ${error ? html`<p class="me-info__hint is-bad" data-testid="me-info-error">${error}</p>` : null}
    </div>
    ${picking === 'bg' ? html`<${NameCardPicker} current=${card.bg} onPick=${setCardBackground} onClose=${() => setPicking(null)} />` : null}
    ${picking === 'avatar' ? html`<${AvatarPicker} current=${card.avatar} list=${list} m=${gd.m}
      looks=${{ kind: 'avatar', current: card.avatarLook, onLook: (look) => { setAvatarLook(look); setPicking(null); } }}
      uploaded=${card.avatarImgSaved ? { src: `/avatar/${card.avatarImgSaved}`, on: !!card.avatarImg,
        onPick: () => { setCustomAvatar(card.avatarImgSaved); setPicking(null); } } : null}
      onPick=${(id) => { setCardAvatar(id); if (!id || !gd.m) setPicking(null); }}
      onClose=${() => setPicking(null)} />` : null}
  <//>`;
}
