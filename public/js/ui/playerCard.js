// 名片 (2026-10-14, the owner's decision; the room design by 雨千代chiyo): what a doctor shows on the room's seat card —
// 名片干员 (an operator's art, ui/seatArt.js CARD_PREF), 头像 (an operator's official avatar, AVATAR_PREF), 名片底图
// (ui/namecards.js NAMECARD_PREF) and the trophy level (ui/trophies.js) of the cumulative trophies this browser's 统计数据
// recorded (ui/stats.js); the looks of the portrait and the avatar (精二 / 精一 / a skin: CARD_LOOK_PREF, AVATAR_LOOK_PREF;
// feedback #9 / #24). All kept in the browser;
// sent as room.card where the server takes it (shared/protocol.js) so teammates see the same card. The trophy count is
// the player's own claim — display only, the server just bounds it — and a server without room.card (an older build)
// leaves the card visible to its owner only.
import { useEffect } from '../../vendor/hooks.module.js';
import { createStore, loadPref, savePref, useStore, shallowEqual } from '../store.js';
import { useData } from '../data.js';
import { peekStatsRecords, selfRowOf } from './stats.js';
import { CARD_PREF, cardAvatarUrl } from './seatArt.js';
import { DEFAULT_NAMECARD, NAMECARD_PREF, namecardOf } from './namecards.js';
import { C2S } from '../../../shared/protocol.js';

/** The server takes room.card (this build's protocol): teammates then see one's card. */
export const CARD_SYNC = !!C2S && Object.hasOwn(C2S, 'room.card');

const str = (v) => (typeof v === 'string' ? v : '');

/** The cumulative trophies of a stats envelope's records (each settled match's own row; ui/stats.js). */
export function trophyTotal(records) {
  let n = 0;
  for (const rec of Array.isArray(records) ? records : []) {
    const v = selfRowOf(rec)?.trophies;
    if (Number.isSafeInteger(v) && v > 0) n += v;
  }
  return n;
}

/** 头像: the operator whose official avatar stands for the player ('' = none: the strategy icon / the name's glyph). */
export const AVATAR_PREF = 'room.avatar';
/** 自传头像 (上传的图片, server/avatars.js): its id ('16 hex'), '' = none. One per browser, kept on the server. */
export const AVATAR_IMG_PREF = 'room.avatar.img';
/**
 * 上次上传的自传头像 id, kept even while the card shows an official 头像 instead (维护者 2026-10-23: 头像 是三选一的
 * 一格 — 默认 / 干员官方头像 / 自传图片 — 所以换成官方头像只是「不用」上传的那张, 并不是删掉它; 头像选择器还留着
 * 一格让玩家换回来). '' = never uploaded. 不上行: room.card 里的 avatarImg 只表示「现在显示的那张」.
 */
export const AVATAR_IMG_SAVED_PREF = 'room.avatar.img.saved';
/** The looks ('' 精二, 'e1' 精一, a skin id) of the 名片干员 and of the 头像 operator. */
export const CARD_LOOK_PREF = 'room.card.look';
export const AVATAR_LOOK_PREF = 'room.avatar.look';

export const cardStore = createStore({
  charId: str(loadPref(CARD_PREF, '')),
  avatar: str(loadPref(AVATAR_PREF, '')),
  bg: namecardOf(loadPref(NAMECARD_PREF, '')) ? loadPref(NAMECARD_PREF, '') : DEFAULT_NAMECARD,
  look: str(loadPref(CARD_LOOK_PREF, '')),
  avatarLook: str(loadPref(AVATAR_LOOK_PREF, '')),
  avatarImg: str(loadPref(AVATAR_IMG_PREF, '')),
  avatarImgSaved: str(loadPref(AVATAR_IMG_SAVED_PREF, '')),
  trophies: null, // read from the stats on first use
});

/** Re-read the trophy total (a match just ended, stats were imported). */
export function refreshTrophies() {
  let n;
  try { n = trophyTotal(peekStatsRecords()); } catch { n = 0; }
  if (cardStore.get().trophies !== n) cardStore.set({ trophies: n });
}

/** @param {string} charId '' = 默认 (chosen from the player id) */
export function setCardOperator(charId) {
  if (str(charId) !== cardStore.get().charId) setCardLook('');
  savePref(CARD_PREF, str(charId)); cardStore.set({ charId: str(charId) });
}
/**
 * @param {string} charId '' = none
 *
 * 头像 是三选一的一格: 默认 / 干员官方头像 / 自传图片。选了官方头像 (或默认) 就把「现在显示自传图」的标记清掉 —
 * 否则 customAvatarSrc 一直排在前面, 玩家点了别的头像也完全没反应 (维护者 2026-10-23: 调整头像连自己都不生效)。
 * 上传的那张图本身不删 (AVATAR_IMG_SAVED_PREF), 头像选择器里还有一格可以换回来。
 */
export function setCardAvatar(charId) {
  if (str(charId) !== cardStore.get().avatar) setAvatarLook('');
  savePref(AVATAR_PREF, str(charId)); cardStore.set({ avatar: str(charId) });
  if (cardStore.get().avatarImg) setCustomAvatar('');
}
/** 自传头像: the uploaded image's id (server/avatars.js); '' clears it back to the official 头像. */
export function setCustomAvatar(id) {
  const v = typeof id === 'string' && /^[0-9a-f]{16}$/.test(id) ? id : '';
  savePref(AVATAR_IMG_PREF, v);
  const patch = { avatarImg: v };
  if (v && cardStore.get().avatarImgSaved !== v) { savePref(AVATAR_IMG_SAVED_PREF, v); patch.avatarImgSaved = v; }
  cardStore.set(patch);
}

/** @param {string} look '' 精二 / 'e1' 精一 / a skin id of the 名片干员 */
export function setCardLook(look) { savePref(CARD_LOOK_PREF, str(look)); cardStore.set({ look: str(look) }); }
/** @param {string} look '' / 'e1' / a skin id of the 头像 operator */
export function setAvatarLook(look) { savePref(AVATAR_LOOK_PREF, str(look)); cardStore.set({ avatarLook: str(look) }); }
/** @param {string} bg a card id; anything unknown falls back to the default 模拟·终极 card */
export function setCardBackground(bg) { const id = namecardOf(bg) ? bg : DEFAULT_NAMECARD; savePref(NAMECARD_PREF, id); cardStore.set({ bg: id }); }

/** One's card, the trophies re-read when a component that shows it mounts. */
export function useMyCard() {
  useEffect(() => { refreshTrophies(); }, []);
  return useStore((s) => s, shallowEqual, cardStore);
}

/** The room.card message of a card: empty fields as '' (the server drops them), trophies bounded. */
export function cardMessage(card) {
  const trophies = Number.isSafeInteger(card?.trophies) ? Math.max(0, Math.min(1_000_000, card.trophies)) : 0;
  const charId = str(card?.charId), avatar = str(card?.avatar);
  const img = str(card?.avatarImg);
  return { charId, avatar, bg: namecardOf(card?.bg) ? card.bg : DEFAULT_NAMECARD, trophies,
    look: charId ? str(card?.look) : '', avatarLook: avatar ? str(card?.avatarLook) : '',
    avatarImg: /^[0-9a-f]{16}$/.test(img) ? img : '' };
}

/** Whether a seat's card (room.state seats[].card) already says what `msg` would. */
export function seatCardMatches(seatCard, msg) {
  const c = seatCard && typeof seatCard === 'object' ? seatCard : {};
  return str(c.charId) === msg.charId && str(c.avatar) === msg.avatar && str(c.bg) === msg.bg
    && (Number.isSafeInteger(c.trophies) ? c.trophies : 0) === msg.trophies
    && str(c.look) === str(msg.look) && str(c.avatarLook) === str(msg.avatarLook)
    && str(c.avatarImg) === str(msg.avatarImg);
}

/** The uploaded avatar of a display card (server/avatars.js id), '' when there is none. */
export function customAvatarSrc(card) {
  const id = card && typeof card === 'object' ? card.avatarImg : '';
  return typeof id === 'string' && /^[0-9a-f]{16}$/.test(id) ? `/avatar/${id}` : '';
}

/**
 * The official avatar a player picked: one's own pick (this browser), else their seat card's (room.state seats[].card,
 * what the server showed the room); null when none, unknown or before the data loads.
 * @param {any} playerId
 */
export function useCardAvatar(playerId) {
  useData('assets');
  const self = useStore((s) => playerId != null && s.me?.playerId === playerId);
  const mine = useStore((c) => `${c.avatar}|${c.avatarLook}`, Object.is, cardStore);
  const seat = useStore((s) => {
    const card = Array.isArray(s.room?.seats) ? s.room.seats.find((x) => x && x.playerId === playerId)?.card : null;
    return card && typeof card === 'object' ? `${str(card.avatar)}|${str(card.avatarLook)}|${str(card.avatarImg)}` : '||';
  });
  const mineImg = useStore((c) => str(c.avatarImg), Object.is, cardStore);
  const [id, look, seatImg] = (self ? mine : seat).split('|');
  const custom = self ? mineImg : seatImg;
  if (custom && /^[0-9a-f]{16}$/.test(custom)) return `/avatar/${custom}`;
  return cardAvatarUrl(id, undefined, look);
}
