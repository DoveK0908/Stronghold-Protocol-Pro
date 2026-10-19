// The skin-shape helpers shared by the asset store (`public/js/assets.js`) and the client's skin store
// (`public/js/ui/skins.js`): one definition, so "a skin names a model" cannot drift between what the picker offers and
// what the renderer can wear (docs/SKINS.md).
//
// No imports on purpose: both callers are on the boot path and neither may pull the other in — the asset store brings
// its Spine cache, and ui/skins.js must not (test/ui/plugins-client.test.js pins the title page's boot cost).

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v ? v : null);
const get = (o, k) => (isObj(o) && Object.hasOwn(o, k) ? o[k] : undefined);

/** The manifest's shared empty skins map (one object, so callers can compare identity). */
export const EMPTY_SKINS = Object.freeze({});

/**
 * The appearances of an operator the manifest holds (docs/SKINS.md, the picker's source): `chars[charId].skins`,
 * written by a cosmetic plugin's overlay — `{ [skinId]: { name, group, avatar, …, spine: { front, back? } } }` — or an
 * empty object. A skin may carry a Spine model or pictures only; missing layers use the operator defaults.
 * @returns {Record<string, any>}
 */
export function skinsOf(m, charId) {
  const rec = get(get(m, 'chars'), str(charId) || '');
  return rec && isObj(rec.skins) ? rec.skins : EMPTY_SKINS;
}

/** Whether a skin record names a Spine model (picture-only outfits are wearable too) (docs/SKINS.md). */
export const skinHasModel = (skin) => !!skin && isObj(skin.spine) && isObj(skin.spine.front) && typeof skin.spine.front.skel === 'string';
