// 名片底图 (2026-10-14, the owner's decision: the room design by 雨千代chiyo had name-card art from its account service;
// here the backgrounds come from material this server already has, no new art): the four simulation loading pictures
// (assets.json ui['loading/loading_ac_*']) and the faction emblems (ui['campLogo/logo_*'], white on the faction's
// colour). A card id is `loading:<key>` or `camp:<key>`; an unknown id (an older or newer client's) shows nothing.
// 2026-10-20: the operator-skin cards (feedback #24) are gone — the owner found those illustrations read badly behind a
// name plate — so the picker offers only 模拟场景 + 阵营徽记, and an empty or unknown pick (including an old `skin:` one)
// falls back to DEFAULT_NAMECARD (模拟·终极), because the no-card look clashed with the 成就统计 card.
// The pick is kept in the browser (NAMECARD_PREF) and travels with room.card (ui/playerCard.js) so teammates see it.
// Styles: css/screens/lobby.css (.has-nc / .nc-layer / .nc-pick).
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { data, useData } from '../data.js';
import { t, N_ } from '../../../shared/i18n.js';
import { uploadNamecard } from './customNamecard.js';
import { toast } from './toasts.js';

export const NAMECARD_PREF = 'room.namecard';
/** The card a player gets without picking one (2026-10-20: the no-card look clashed with 成就统计). */
export const DEFAULT_NAMECARD = 'loading:abyss';

/** The loading pictures (one per simulation difficulty). */
const LOADING = [
  { key: 'prototype', name: N_('模拟·原型') },
  { key: 'core', name: N_('模拟·核心') },
  { key: 'hard', name: N_('模拟·险境') },
  { key: 'abyss', name: N_('模拟·终极') },
];

/** The factions with an emblem in the material, each with a tint for the card behind the white emblem. */
const CAMPS = [
  { key: 'rhodes', name: N_('罗德岛'), tint: '#1f3a4a' },
  { key: 'lungmen', name: N_('龙门'), tint: '#5a2a1c' },
  { key: 'yan', name: N_('炎'), tint: '#6a1f1f' },
  { key: 'higashi', name: N_('东'), tint: '#5c2a3e' },
  { key: 'victoria', name: N_('维多利亚'), tint: '#2a3358' },
  { key: 'kazimierz', name: N_('卡西米尔'), tint: '#4a3b1c' },
  { key: 'laterano', name: N_('拉特兰'), tint: '#5a4c1e' },
  { key: 'leithanien', name: N_('莱塔尼亚'), tint: '#3c2a52' },
  { key: 'columbia', name: N_('哥伦比亚'), tint: '#1f3f58' },
  { key: 'ursus', name: N_('乌萨斯'), tint: '#3a3a3a' },
  { key: 'siracusa', name: N_('叙拉古'), tint: '#4a1e2a' },
  { key: 'iberia', name: N_('伊比利亚'), tint: '#1e3c3c' },
  { key: 'egir', name: N_('阿戈尔'), tint: '#163a4e' },
  { key: 'sargon', name: N_('萨尔贡'), tint: '#5a4418' },
  { key: 'kjerag', name: N_('谢拉格'), tint: '#2c4656' },
  { key: 'sami', name: N_('萨米'), tint: '#24443a' },
  { key: 'minos', name: N_('米诺斯'), tint: '#4e3220' },
  { key: 'bolivar', name: N_('玻利瓦尔'), tint: '#2e4a22' },
  { key: 'rim', name: N_('雷姆必拓'), tint: '#4a3420' },
];

/** Every card: { id, kind, name, assetKey, tint? }. */
export const NAMECARDS = Object.freeze([
  ...LOADING.map((c) => Object.freeze({ id: `loading:${c.key}`, kind: 'loading', name: c.name, assetKey: `loading/loading_ac_${c.key}` })),
  ...CAMPS.map((c) => Object.freeze({ id: `camp:${c.key}`, kind: 'camp', name: c.name, tint: c.tint, assetKey: `campLogo/logo_${c.key}` })),
]);
const BY_ID = new Map(NAMECARDS.map((c) => [c.id, c]));
/** The card of an id, or null (unknown / empty). 2026-10-20: operator-skin cards are gone (they read badly), so a
 *  stored `skin:` id resolves to null and the caller falls back to DEFAULT_NAMECARD. @param {unknown} id */
export function namecardOf(id) {
  if (typeof id !== 'string') return null;
  const own = BY_ID.get(id);
  if (own) return own;
  // 自传名片底图 (维护者 2026-10-22): `custom:<id>` is the browser's own upload, served at /namecard/<id>
  const m = /^custom:([0-9a-f]{16})$/.exec(id);
  return m ? { id, kind: 'custom', name: null, image: `/namecard/${m[1]}` } : null;
}

const safeUrl = (src) => (typeof src === 'string' && src && !/["\\)]/.test(src) ? src : null);

/** The picture of a card in the loaded asset index, or null. */
export function namecardSrc(card, m = data.get('assets')) {
  if (card && card.kind === 'custom') return safeUrl(card.image);
  return safeUrl(card && m?.ui && typeof m.ui === 'object' ? m.ui[card.assetKey] : null);
}

/**
 * The card behind a name plate (the room's seat cards, the 成就统计 card, the top bar's chip): put it inside a
 * `.has-nc` element; nothing for no / an unknown card.
 * @param {{ card: string|null|undefined }} props
 */
export function NameCardLayer({ card }) {
  useData('assets');
  const nc = namecardOf(card);
  const src = namecardSrc(nc);
  if (!nc || !src) return null;
  return html`<span class=${`nc-layer nc-layer--${nc.kind}`} style=${`--nc:url("${src}")${nc.tint ? `; --nc-tint:${nc.tint}` : ''}`} aria-hidden="true"></span>`;
}

/** 名片底图 picker: 模拟场景 + 阵营徽记; picking closes it. Esc / the backdrop close it too. */
export function NameCardPicker({ current, onPick, onClose }) {
  useData('assets');
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const pick = (id) => { onPick(id); onClose(); };
  const card = (c) => html`<button key=${c.id} type="button" class=${`nc-pick__card${current === c.id ? ' is-on' : ''}`} onClick=${() => pick(c.id)} title=${t(c.name)}>
    <span class="nc-pick__art has-nc"><${NameCardLayer} card=${c.id} /><span class="nc-pick__name">${t(c.name)}</span></span>
    ${current === c.id ? html`<span class="nc-pick__on">${t('使用中')}</span>` : null}</button>`;
  const onFile = async (e) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    setBusy(true);
    const res = await uploadNamecard(file);
    setBusy(false);
    if (res.ok) pick(`custom:${res.id}`);
    else toast(res.err || t('上传失败，换一张图片再试'), 'warn');
  };
  return html`<div class="nc-pick" role="presentation" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="nc-pick__panel" role="dialog" aria-modal="true" aria-label=${t('名片底图')}>
      <header class="nc-pick__head"><strong>NAME CARD</strong><span class="nc-pick__title">${t('名片底图')}</span>
        <button type="button" class="nc-pick__x" onClick=${onClose} aria-label=${t('关闭')}><${Icon} name="close" /></button></header>
      <div class="nc-pick__grid">
        <h4 class="nc-pick__theme">${t('模拟场景')}</h4>
        ${NAMECARDS.filter((c) => c.kind === 'loading').map(card)}
        <h4 class="nc-pick__theme">${t('阵营徽记')}</h4>
        ${NAMECARDS.filter((c) => c.kind === 'camp').map(card)}
        <h4 class="nc-pick__theme">${t('自定义')}</h4>
        <button type="button" class="nc-pick__card nc-pick__card--upload" disabled=${busy} onClick=${() => fileRef.current?.click()}
                title=${t('上传名片底图')}>
          <span class="nc-pick__art nc-pick__upload"><${Icon} name="plus" /><span class="nc-pick__name">${busy ? t('上传中…') : t('上传图片')}</span></span>
        </button>
      </div>
      <footer class="nc-pick__foot"><small>${t('名片底图显示在同盟席位的名牌后面，同盟里的博士都能看到')}</small></footer>
      <input ref=${fileRef} type="file" accept="image/png,image/jpeg,image/webp" class="me-info__file" onChange=${onFile} />
    </div>
  </div>`;
}
