// The composed asset manifest's own skins, as flat rows for the tests that sample "any skin" (docs/SKINS.md: an
// appearance of an operator is chars[<charId>].skins[<skinKey>], not a client-side catalogue).
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../../data/assets.json', import.meta.url), 'utf8'));

/** @returns {ReadonlyArray<{ charId: string, id: string }>} every skin the manifest holds, charId → skin key. */
export const MANIFEST_SKINS = Object.freeze(Object.entries(manifest.chars)
  .flatMap(([charId, char]) => Object.keys(char.skins || {}).map((id) => Object.freeze({ charId, id }))));
