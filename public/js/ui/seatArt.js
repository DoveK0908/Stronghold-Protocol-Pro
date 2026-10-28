import { eliteCard } from '../../../shared/eliteAi.js';
// 名片干员 (PR #643 split 6): the portrait on a doctor's seat card in the waiting room (screens/room.js) and on the
// strategy draft's name cards (screens/bandDraft.js) — the operator the player picked (room.card; everybody sees it as
// room.state seats[].card), else one of the 5★/6★ operators chosen by the player id, the same on every client — worn in
// the player's outfit (seatCardSkin, the maintainer's decision 4 of 2026-10-21). The rules are pure: the screen passes
// the chess records (ui/assetUrls.js chessPortraitUrl turns the operator into its portrait; without the art pack the
// card keeps its avatar frame). The pick itself lives in `cardStore` (a pref; ui/loadoutSync.js installCardSync sends it).
// [ASSUMED] The event's card shows the account's assistant (名片形象, display_meta_table avatarTypeData ASSISTANT): this
// remake has no accounts, so the pick is made on one's own seat card and kept in this browser (CARD_PREF 'room.card').
// [ASSUMED] With no pick, a 5★/6★ operator is chosen by hash32(playerId) — a remake rule, so that every card has art as in
// the event's room and every client draws the same one.

import { chessPortraitUrl } from './assetUrls.js';
import { data } from '../data.js';
import { N_ } from '../../../shared/i18n.js';
import { createStore, loadPref, savePref } from '../store.js';
import { ownerSkin } from './skins.js';

/** 名片干员: the player's own pick (a localStorage pref, sent as room.card). */
export const CARD_PREF = 'room.card';

/** The store field of the pick (ui/loadoutSync.js installCardSync `key`) and its sync state field. */
export const CARD_KEY = 'card';
export const CARD_SYNC_KEY = 'cardSync';

/** A stored pick as the store holds it: a charId string, '' for none (默认). */
export function parseStoredCard(v) {
  return typeof v === 'string' ? v : '';
}

/** This browser's pick and its sync state (survives room / match resets like ui/skins.js' store). */
export const cardStore = createStore({ [CARD_KEY]: parseStoredCard(loadPref(CARD_PREF, '')), [CARD_SYNC_KEY]: 'idle' });

/**
 * Pick the 名片干员 ('' = 默认): persisted at once, the sync engine sends it.
 * @param {string} charId
 */
export function setCard(charId) {
  const next = parseStoredCard(charId);
  try { savePref(CARD_PREF, next); } catch { /* private mode: the session keeps it */ }
  cardStore.set({ [CARD_KEY]: next });
}

// The fork's addition (feedback #9 / #24): a card's art is not only the operator — `look` picks '' the 精二 art, 'e1' the
// 精一 art, or a skin of that operator (lookUrl, lookOptions); the 头像 the same (avatarLook). The look rides on room.card.

/** FNV-1a of a string (the default portrait: the same operator for a player on every client). */
function hash32(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * The operators a seat card can show — the server's room.card whitelist (server/lobby.js chessCharIds): one record per
 * charId of the visible, non-自选 chess records (the elite form, for its E2 art), 6★ first, then by name.
 * @param {any[]} chessList chess.json records
 * @returns {any[]}
 */
export function cardOperators(chessList) {
  const by = new Map();
  for (const c of Array.isArray(chessList) ? chessList : []) {
    if (!c || c.isDiy || c.visible === false || typeof c.charId !== 'string') continue;
    const prev = by.get(c.charId);
    if (!prev || (c.isGolden && !prev.isGolden)) by.set(c.charId, c);
  }
  return [...by.values()].sort((a, b) => ((b.rarity ?? 0) - (a.rarity ?? 0)) || String(a.name).localeCompare(String(b.name), 'zh'));
}

const str = (v) => (typeof v === 'string' && v ? v : null);

/**
 * An operator's art of a card look from the art manifest alone (the lobby never downloads the operators' data):
 * `kind` 'avatar' | 'portrait'; look '' = its 精二 art when it has one (else 精一), 'e1' = 精一, a skin id = that skin's
 * art (only a skin of this operator); null when unknown.
 * @param {any} m the art manifest @param {string} charId @param {string} [look] @param {'avatar'|'portrait'} [kind]
 */
export function lookUrl(m, charId, look = '', kind = 'avatar') {
  if (typeof charId !== 'string' || !m) return null;
  if (look && look !== 'e1') {
    // data/assets.json keeps skins under chars[charId].skins (flat top-level m.skins only exists in older manifests)
    const flat = m.skins && typeof m.skins === 'object' && Object.hasOwn(m.skins, look) ? m.skins[look] : null;
    if (flat && flat.charId === charId && str(flat[kind])) return str(flat[kind]);
    const perChar = m.chars && m.chars[charId] && m.chars[charId].skins;
    const nested = perChar && typeof perChar === 'object' && Object.hasOwn(perChar, look) ? perChar[look] : null;
    if (nested && str(nested[kind])) return str(nested[kind]);
  }
  const chars = typeof m.chars === 'object' ? m.chars : null;
  const c = chars && Object.hasOwn(chars, charId) ? chars[charId] : null;
  if (!c) return null;
  // 精二默认；精一有提取出来的全身立绘（illustE1）就用它，取景才和精二一致（没有再退回半身 portrait）
  if (look === 'e1') return kind === 'illust' ? str(c.illustE1) : str(c[kind]);
  return str(c[`${kind}E2`]) || str(c[kind]);
}

/**
 * The looks an operator offers on a card: [{ id, name, src }] — 精二 ('' — only when the art has an E2 form), 精一 ('e1';
 * '' when there is no E2 form, the default then) and each skin in the manifest; one entry = nothing to choose.
 * @param {any} m @param {string} charId @param {'avatar'|'portrait'} kind
 */
export function lookOptions(m, charId, kind) {
  const chars = m && typeof m.chars === 'object' ? m.chars : null;
  const c = typeof charId === 'string' && chars && Object.hasOwn(chars, charId) ? chars[charId] : null;
  if (!c) return [];
  const e2 = str(c[`${kind}E2`]);
  const out = e2 ? [{ id: '', name: N_('精英二'), src: e2 }, { id: 'e1', name: N_('精英一'), src: str(c[kind]) }]
    : [{ id: '', name: N_('精英一'), src: str(c[kind]) }];
  // 皮肤在 data/assets.json 里挂在 chars[charId].skins 下（顶层 m.skins 只有老清单才有）
  const flat = m.skins && typeof m.skins === 'object' ? m.skins : {};
  for (const [id, s] of Object.entries(flat)) if (s && s.charId === charId && str(s[kind])) out.push({ id, name: s.name || id, src: s[kind], skin: true });
  const nested = c.skins && typeof c.skins === 'object' ? c.skins : {};
  for (const [id, s] of Object.entries(nested)) if (s && str(s[kind])) out.push({ id, name: s.name || id, src: s[kind], skin: true });
  return out;
}

/**
 * 头像: the official avatar of an operator (room.card avatar) in its look (avatarLook: '' its elite (E2) avatar when
 * the art has one, as the card operators' golden form; 'e1'; a skin); null when unknown.
 * @param {string} charId @param {any} [m] the art manifest @param {string} [look]
 */
export function cardAvatarUrl(charId, m = data.get('assets'), look = '') {
  return lookUrl(m, charId, look, 'avatar');
}

/**
 * 名片干员的一条记录，按 charId 认：先查本模式的干员清单（byChar），查不到就直接拿素材清单里的角色
 * （`{ charId }` 够 lookUrl 用）。跨模式进来时 cardStore 里还留着上一个模式的干员，本模式清单里没有他 ——
 * 以前这里返回 null，席位就退回「按 playerId 哈希随便取一个 5★/6★」的半身像：明明选过，显示的却是别人。
 * @param {any} m the art manifest @param {Map<string, any>} byChar @param {string} [charId]
 */
export function cardOperator(m, byChar, charId) {
  if (typeof charId !== 'string' || !charId) return null;
  const rec = byChar ? byChar.get(charId) : null;
  if (rec) return rec;
  const chars = m && typeof m.chars === 'object' ? m.chars : null;
  return chars && Object.hasOwn(chars, charId) ? { charId } : null;
}

/**
 * 这个席位该画谁的立绘：自己优先本机 cardStore 的选择，认不出来（不在素材清单里）才用服务端广播的那份；
 * 都没有时返回 ''。
 * @returns {{ charId: string, look: string }}
 */
export function seatPick(seat, { byChar, m, myId, myCard, myLook = '' } = {}) {
  const elite = eliteCard(seat);
  if (elite) { const rec = cardOperator(m, byChar, elite.charId); return { charId: elite.charId, look: '', rec }; }
  const mine = !!seat && seat.playerId === myId && !!myCard;
  const own = mine ? (typeof myCard === 'string' ? myCard : myCard?.charId) : '';
  const fromCard = typeof seat?.card === 'string' ? seat.card : seat?.card?.charId;
  const rec = cardOperator(m, byChar, own) || cardOperator(m, byChar, fromCard);
  if (!rec) return { charId: '', look: '', rec: null };
  return { charId: rec.charId, look: seatLook(seat, rec.charId, { myId, myCard, myLook }), rec };
}

/**
 * 席位大图的「带场景」版本：名片干员装备了皮肤时，用该皮肤的 illustration（官方那张连背景的立绘）；
 * 没皮肤 / 精一 / 机器人返回 null，调用方退回 seatPortrait（透明立绘）。
 */
export function seatIllust(seat, ctx) {
  if (!seat || seat.playerId == null || (seat.isBot && !eliteCard(seat))) return null;
  const { charId, look } = seatPick(seat, ctx);
  if (!charId) return null;
  // '' = 精英二：客户端里那张带背景的立绘（chars[].illust）；'e1' = 同一套取景的透明全身立绘（chars[].illustE1）
  return lookUrl(ctx.m, charId, look, 'illust');
}

/**
 * The seat card's portrait: the operator the player picked (room.state seats[].card, or one's own pick), else one of
 * the 5★/6★ operators chosen by the player id — the same on every client (null before the data loads).
 * @param {any} seat room.state seat @param {{ pool: any[], byChar: Map<string, any>, m: any, myId: any, myCard: string, myLook?: string }} ctx
 */
/**
 * The appearance a seat shows for one operator: the skin its OWNER picked in 干员调配 (`skins[charId]`), else the
 * card look ('' 精二 / 'e1' 精一). Own seat reads the local stores, a teammate's reads `seat.skins` / `seat.card`
 * (server/lobby.js toState), so every client draws the same thing for the same person.
 */
export function seatLook(seat, charId, { myId, myCard, myLook = '' } = {}) {
  // 只认「更换立绘」这一处的选择：自己读本机 card.look，队友读广播过来的 seat.card.look。
  // 干员调配里选的皮肤（skinsStore → room.skins）不参与席位卡：否则选了皮肤就再也切不回精一/精二
  // （维护者 2026-10-22 在服务器上踩到「没办法切换」）。皮肤想上席位卡，就在「更换立绘」里挑一次。
  const mine = seat && seat.playerId === myId && myCard;
  if (mine) return typeof myLook === 'string' ? myLook : '';
  return typeof seat?.card?.look === 'string' ? seat.card.look : '';
}

export function seatPortrait(seat, ctx) {
  if (!seat || seat.playerId == null || (seat.isBot && !eliteCard(seat))) return null;
  // seats[].card is { charId, bg, trophies } (ui/playerCard.js); a bare string is the design's original form
  const { charId, look, rec } = seatPick(seat, ctx);
  // '' = 精英二（`portraitE2`，和立绘同一取景），'e1' = 半身 `portrait`，皮肤 = 该皮肤自己的 portrait
  if (charId) return lookUrl(ctx.m, charId, look, 'portrait') || chessPortraitUrl(ctx.m, rec || { charId });
  const { pool, m } = ctx;
  if (!Array.isArray(pool) || !pool.length) return null;
  return chessPortraitUrl(m, pool[hash32(seat.playerId) % pool.length]);
}

/**
 * What the seat cards draw from: the pickable operators by charId and the default pool (5★/6★, by charId so every
 * client orders it the same).
 * @param {any[]} list cardOperators()
 */
export function cardContext(list) {
  return {
    byChar: new Map(list.map((c) => [c.charId, c])),
    pool: list.filter((c) => (c.rarity ?? 0) >= 5).sort((a, b) => (a.charId < b.charId ? -1 : a.charId > b.charId ? 1 : 0)),
  };
}

/**
 * The operator on a seat card: the player's pick (one's own seat shows the local pick at once, the others the server's
 * seats[].card), else one of the pool chosen by the player id [ASSUMED, see the header]. null for an empty seat, a bot,
 * or before the data loads.
 * @param {any} seat room.state seat
 * @param {{ byChar: Map<string, any>, pool: any[] }} ctx cardContext()
 * @param {{ myId?: any, myCard?: string | { charId?: string } }} [own]
 * @returns {{ chess: any, picked: boolean } | null}
 */
export function seatOperator(seat, { byChar, pool }, { myId, myCard } = {}) {
  if (!seat || seat.playerId == null) return null;
  const elite = eliteCard(seat);
  if (elite) return { chess: byChar?.get(elite.charId) || { charId: elite.charId }, picked: true };
  if (seat.isBot) return null;
  // a card is a record ({ charId, avatar, bg, look, … }, ui/playerCard.js) since the 名片 remake, and a bare charId in
  // older prefs and in one's own `myCard` from useMyCard: read the charId out of either, or the pick resolves to nothing
  // and the seat falls back to the hash-chosen default operator — the wrong operator's name under the right portrait.
  const charOf = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' && typeof v.charId === 'string' ? v.charId : '');
  const pick = charOf(seat.playerId === myId ? myCard : seat.card);
  const rec = pick && byChar ? byChar.get(pick) : null;
  if (rec) return { chess: rec, picked: true };
  if (!Array.isArray(pool) || !pool.length) return null;
  return { chess: pool[hash32(seat.playerId) % pool.length], picked: false };
}

/**
 * The outfit a seat card's operator wears (docs/SKINS.md; the maintainer's decision 4 of 2026-10-21), by the rule of
 * every owner-aware card (ui/skins.js ownerSkin): one's own card wears this browser's choice at once (`localSkins`),
 * another doctor's the choice that seat published — `players` holds `{ playerId, skins }`: the room's seats
 * (room.state seats[].skins) or a match's public players — unless 「显示其他玩家的皮肤」 is off. null = the default art;
 * a skinId the local manifest does not hold (an appearance plugin this page lacks) also draws the default
 * (ui/assetUrls.js chessPortraitUrl falls back).
 * @param {any} seat a seat or player record (`playerId`, `isBot`)
 * @param {string | null | undefined} charId the operator the card shows (seatOperator)
 * @param {{ myId?: any, localSkins?: Record<string, string>, players?: any[], otherSkins?: boolean }} ctx
 * @returns {string | null}
 */
export function seatCardSkin(seat, charId, { myId = null, localSkins = {}, players = [], otherSkins = true } = {}) {
  if (!seat || seat.isBot || seat.playerId == null || !charId) return null;
  if (seat.playerId === myId) return ownerSkin(charId, { localSkins });
  return ownerSkin(charId, { ownerId: seat.playerId, myId, players: Array.isArray(players) ? players.filter(Boolean) : [], otherSkins });
}

/**
 * The picture a seat card draws: the first of `srcs` — the outfit's portrait, then the operator's default portrait — that
 * has not failed to load in this card (`failed`); null when none is left, and the card shows its avatar frame (§35.18's
 * leftover: an outfit file that failed went straight to the frame).
 * @param {(string | null | undefined)[]} srcs in order of preference
 * @param {readonly string[]} [failed]
 * @returns {string | null}
 */
export function seatArtSrc(srcs, failed = []) {
  for (const src of Array.isArray(srcs) ? srcs : []) if (src && !failed.includes(src)) return src;
  return null;
}
