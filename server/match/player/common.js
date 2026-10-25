// server/match/player/common.js — constants and small helpers shared by the PlayerState method modules
// (server/match/player/*.js) and its constructor (server/match/PlayerState.js).

import { GEO, HAND_MAX } from '../../../shared/constants.js';

export const HAND_SIZE = GEO.HAND_SIZE;
export const TEMP_SIZE = GEO.TEMP_SIZE;
/** 整备区扩容 (experimental `benchExpand`): this match's hand capacity — 10 slots, or HAND_MAX when the room asked for it
 *  AND the drawn stage is the measured one (Match.benchExpand / shared/benchExpand.js benchExpandable). */
export const handSizeOf = (m) => (m && m.benchExpand === true ? HAND_MAX : GEO.HAND_SIZE);
/** g.reward accepts idx 0..5 (shared/protocol.js) */
export const MAX_OFFER_SLOTS = 6;
export const OK = Object.freeze({ ok: true });
export const fail = (error, detail) => (detail ? { error, detail } : { error });
