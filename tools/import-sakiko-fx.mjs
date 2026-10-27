// Import only Sakiko's extracted effects and their dependencies from the local selena reference.
// Art stays in ignored public/assets; this script makes the import repeatable without hand-editing manifests.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(process.argv[2] || path.join(root, '../_selena/selena-latest/app'));
const read = async p => JSON.parse(await fs.readFile(p, 'utf8'));
const fxPath = 'public/assets/local/fx';
const index = await read(path.join(root, fxPath, 'index.json'));
const incoming = await read(path.join(source, fxPath, 'index.json'));
const list = await read(path.join(root, 'data/local-fx.json'));
const sourceList = await read(path.join(source, 'data/local-fx.json'));
const textures = await read(path.join(root, fxPath, 'textures.json'));
const sourceTextures = await read(path.join(source, fxPath, 'textures.json'));
const copied = new Set();
async function copy(group, key) {
  const entry = sourceList.groups[group]?.[key];
  if (!entry) throw new Error(`Missing ${group}: ${key}`);
  for (const url of [entry.path, entry.half].filter(Boolean)) {
    const relative = `public${url}`;
    const dest = path.join(root, relative);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(source, relative), dest);
  }
  list.groups[group][key] = entry;
}
async function prefab(key) {
  if (copied.has(key)) return;
  copied.add(key);
  const summary = incoming.prefabs[key];
  if (!summary) throw new Error(`Missing prefab: ${key}`);
  await copy('fx/prefabs', key);
  const def = await read(path.join(source, fxPath, summary.file));
  for (const tex of def.textures || []) {
    await copy('fx/tex', tex);
    textures.textures[tex] = sourceTextures.textures[tex];
  }
  for (const mesh of def.meshes || []) await copy('fx/mesh', mesh);
  index.prefabs[key] = summary;
  for (const ref of summary.refs || []) await prefab(ref);
}
for (const key of Object.keys(incoming.prefabs).filter(k => k.startsWith('oblvns_'))) await prefab(key);
for (const [key, value] of Object.entries(incoming.projectiles)) {
  if (key.startsWith('projectile_chr_oblvns')) index.projectiles[key] = value;
}
const skin = index.skins.char_4182_oblvns_avemujica_1;
if (skin) {
  skin.char = 'char_4182_oblvns';
  skin.replace = Object.fromEntries([...copied].filter(k => k.endsWith('_avemujica#1'))
    .map(k => [k.slice(0, -'_avemujica#1'.length), k]));
}
for (const [relative, value] of [[`${fxPath}/index.json`, index], [`${fxPath}/textures.json`, textures], ['data/local-fx.json', list]]) {
  await fs.writeFile(path.join(root, relative), JSON.stringify(value));
}
console.log(`Imported ${copied.size} Sakiko prefabs with textures, meshes and outfit replacements.`);
