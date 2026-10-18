// Resolve only appearances the composed asset manifest lists — chars[<charId>].skins[<skinKey>] (docs/SKINS.md),
// never an arbitrary client-provided URL or id.
const charOf = (record) => record?.charId || record?.assets?.spine || null;

/**
 * The manifest's record of `charId`'s appearance `skin`, in the fields the screens above read (`avatar`, `portrait`,
 * `illustration`, `spine`, the dynamic illustration), or null when the operator or the skin is not there.
 */
export function appearanceEntry(manifest, charId, skin) {
  if (!charId || typeof skin !== 'string' || !skin) return null;
  const skins = manifest?.chars?.[charId]?.skins;
  if (!skins || typeof skins !== 'object' || !Object.hasOwn(skins, skin)) return null;
  const rec = skins[skin];
  if (!rec || typeof rec !== 'object') return null;
  return { id: skin, charId, name: rec.name, group: rec.group, avatar: rec.avatar, portrait: rec.portrait, illustration: rec.illust, spine: rec.spine, dynamic: rec.dynamic, dynamicDeclared: rec.dynamicDeclared };
}

/** `record` wearing `skin` (a display tag only: `assets.js` resolves the art, the operator's own when it is missing). */
export function appearanceRecord(record, skin) {
  return record && typeof skin === 'string' && skin ? { ...record, skin } : record;
}

/** The record wearing the player's own choice for its operator (`priv.skins`, the room's stored map). */
export function ownAppearance(record, priv) {
  return appearanceRecord(record, priv?.skins?.[charOf(record)] || null);
}
