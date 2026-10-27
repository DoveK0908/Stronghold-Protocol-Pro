// Import selena 0.4.1's whole 主界面音乐库 — every `factionMusicCatalog.js` entry (246 tracks, 7 groups / 61
// sub-categories) — as the 主界面音乐库 (public/js/lobbyMusicLibrary.js) plus its .ogg files under ignored
// public/assets. Art/audio stay in ignored folders; this script makes the import repeatable instead of hand-editing
// the list, and keeps the ids stable (they are the source file hashes).
//
//   node tools/import-lobby-music.mjs [<selena-app目录>]
//
// 维护者 2026-10-27: 玩家要「两百多首、有分类」——所以不再只取 `home: true` 的那 23 首，整张目录都进来，
// 并把 `categories`（"阵营 OST/卡西米尔" 这种）带过来给面板分组。文件落在 public/assets/audio/bgm/ 根下
// （和别的 BGM 放一起），不再单独开 lobby/ 子目录。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(process.argv[2] || path.join(root, '../_selena/selena-latest/app'));
const DEST = 'public/assets/audio/bgm'; // 盘上路径；对外 URL 是 /assets/audio/bgm/...（和 manifest 里的 bgm 一致）
const catalog = path.join(source, 'public/js/factionMusicCatalog.js');
const { FACTION_MUSIC } = await import(`file://${catalog.replace(/\\/g, '/')}`);
if (!FACTION_MUSIC.length) throw new Error(`${catalog} has no entries`);
await fs.mkdir(path.join(root, DEST), { recursive: true });

const tracks = [];
for (const t of FACTION_MUSIC) {
  const name = path.basename(t.url);
  const from = path.join(source, 'public', t.url);
  const to = path.join(root, DEST, name);
  // 已有的文件不重拷（246 首约 390MB，重复拷贝没有意义）
  if (!(await fs.stat(to).catch(() => null))) await fs.copyFile(from, to);
  // 分类：selena 用 "组/子类" 的两级串，这里拆成 { group, groupName, path } —— group 是首段（悬赏 OST 这类）
  const cats = (t.categories || []).map((c) => String(c));
  const first = cats[0] || '其他 OST';
  const [group, ...rest] = first.split('/');
  tracks.push({
    id: `lib_${name.replace(/^faction_/, '').replace(/\.ogg$/, '')}`,
    title: t.title,
    url: `/assets/audio/bgm/${name}`,
    group,
    groupName: rest.join('/') || group,
    categories: cats,
    home: t.home === true,
  });
}

const esc = (s) => JSON.stringify(s);
const body = tracks
  .map((t) => `  { id: ${esc(t.id)}, title: ${esc(t.title)}, url: ${esc(t.url)}, group: ${esc(t.group)}, groupName: ${esc(t.groupName)}, categories: ${JSON.stringify(t.categories)}${t.home ? ', home: true' : ''} }, // i18n-ignore 官方曲名/分类，原样显示`)
  .join('\n');
// 分组顺序按目录里首次出现的顺序走（悬赏 → 阵营 → Boss → 敌人 → 结算 → 其他 → 主界面）
const groups = [];
for (const t of tracks) if (!groups.includes(t.group)) groups.push(t.group);
const out = `// 主界面音乐库 (public/js/lobbyMusicLibrary.js): selena 0.4.1 的整张 \`factionMusicCatalog.js\`——${tracks.length} 首、${groups.length} 个组
// （${groups.join(' / ')}）——.ogg 从官方包原样拷进 \`public/assets/audio/bgm/faction_<hash>.ogg\`。
// 一次选曲就是这里的一个 id（\`lib_<hash>\`）；audio.js 的 lobbyTrackOf 解析它，大厅音乐卡（ui/lobbyMusicPanel.js）按 group 分组列出。
// 新增曲目后跑 tools/import-lobby-music.mjs 重新生成；id 是文件哈希，所以稳定。
// 曲名与分类是官方专有名词，按原样显示，故逐行标 \`// i18n-ignore\`。

export const LOBBY_LIBRARY = Object.freeze([
${body}
]);

/** 面板上的分组顺序（官方目录里的首次出现顺序）；组名是官方分类，原样显示。 */
export const LOBBY_GROUPS = Object.freeze(${JSON.stringify(groups)}); // i18n-ignore 官方分类名，原样显示

/** @param {string} id @returns {{id:string,title:string,url:string,group:string,groupName:string,categories:string[]}|null} */
export const lobbyTrack = (id) => LOBBY_LIBRARY.find((x) => x.id === id) || null;
`;
await fs.writeFile(path.join(root, 'public/js/lobbyMusicLibrary.js'), out);
console.log(`imported ${tracks.length} tracks in ${groups.length} groups → ${DEST}, public/js/lobbyMusicLibrary.js`);
