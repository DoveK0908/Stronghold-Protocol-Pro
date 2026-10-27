// Import selena 0.4.1's 主界面 (lobby) music — the `factionMusicCatalog.js` entries with `home: true` — as the
// 主界面音乐库 (public/js/lobbyMusicLibrary.js) plus their .ogg files under ignored public/assets.
// Art/audio stay in ignored folders; this script makes the import repeatable instead of hand-editing the list.
//
//   node tools/import-lobby-music.mjs [<selena-app目录>]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(process.argv[2] || path.join(root, '../_selena/selena-latest/app'));
const DEST = 'public/assets/audio/bgm/lobby';
const catalog = path.join(source, 'public/js/factionMusicCatalog.js');
const { FACTION_MUSIC } = await import(`file://${catalog.replace(/\\/g, '/')}`);
const home = FACTION_MUSIC.filter((t) => t.home === true);
if (!home.length) throw new Error(`${catalog} has no home: true entries`);
await fs.mkdir(path.join(root, DEST), { recursive: true });
const tracks = [];
for (const t of home) {
  const name = path.basename(t.url);
  const from = path.join(source, 'public', t.url);
  const to = path.join(root, DEST, name);
  await fs.copyFile(from, to);
  tracks.push({ id: `lib_${name.replace(/^faction_/, '').replace(/\.ogg$/, '')}`, title: t.title, url: `/${DEST}/${name}` });
}
const body = tracks.map((t) => `  { id: ${JSON.stringify(t.id)}, title: ${JSON.stringify(t.title)}, url: ${JSON.stringify(t.url)} },`).join('\n');
const out = `// 主界面音乐库 (public/js/lobbyMusicLibrary.js): the ${tracks.length} packaged lobby tracks of selena 0.4.1 (\`factionMusicCatalog.js\`
// entries with \`home: true\`), copied here byte-for-byte as \`assets/audio/bgm/lobby/faction_<hash>.ogg\`. A pick is one of
// these ids (\`lib_<hash>\`); audio.js lobbyTrackOf resolves it, and the 大厅音乐 card lists them (ui/lobbyMusicPanel.js).
// Regenerate with tools/import-lobby-music.mjs after adding files; the ids are the file hashes, so they stay stable.

export const LOBBY_LIBRARY = Object.freeze([
${body}
]);

/** @param {string} id @returns {{id:string,title:string,url:string}|null} */
export const lobbyTrack = (id) => LOBBY_LIBRARY.find((x) => x.id === id) || null;
`;
await fs.writeFile(path.join(root, 'public/js/lobbyMusicLibrary.js'), out);
console.log(`imported ${tracks.length} lobby tracks → ${DEST}, public/js/lobbyMusicLibrary.js`);
