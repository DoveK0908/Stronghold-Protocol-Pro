# 丰川祥子（`char_4182_oblvns`）外挂式 mod

把「丰川祥子」做成**叠加在 dust 基线上的一层 overlay**，而不是往基线里塞改动。
目标：**对之后的官方基础版 / dust 版更新零影响** —— 基线随时能 `git pull --ff-only`，`--revert` 一条命令回到干净树。

- 基线：`StrongholdPro\`（dust fork `Stardust-minus/Stronghold-Protocol`，`HEAD = 2b1cdb6bff38be4f9821dfa5efed9faaa8110f7a`，version `0.2.5`）
- 原型参照：`source\sakiko\`（`LimitlessHPPK/Stronghold-Protocol-Sakiko-Mod`，只读）
- 本 overlay 的一切都在 `mods/sakiko/` 里；**应用后的状态不提交**，只留在工作树。

## 为什么这样做

把改动提交进基线会让下一次 `git pull` 变成 merge 并产生冲突；而 overlay 方式下基线始终是干净的 dust，上游更新用快进即可。代价是补丁必须**锚点式**——上游改了同一个文件时，只要锚点还在就能打；锚点没了就响亮地报冲突，绝不静默改错。

于是：`master` 保持纯净的 dust；本 mod 自己的东西（`mods/sakiko/**`）是唯一可以提交的东西。

## 用法

```powershell
cd StrongholdPro

node mods/sakiko/apply.mjs            # 应用（幂等：已应用的补丁跳过）
node mods/sakiko/apply.mjs --check    # 只检查能不能应用，不写任何文件
node mods/sakiko/apply.mjs --revert   # 撤回：git checkout 被改的文件 + 删掉仍与 overlay 一致的新增文件
node mods/sakiko/apply.mjs --json     # 机器可读输出
```

退出码：`0` = 全部成功 / `1` = 有冲突或错误。

## 目录

```
mods/sakiko/
  apply.mjs                锚点式补丁工具（零依赖 ESM）
  README.md                本文件
  patches/*.patch.json     对**基线已有文件**的增量改动
  files/**                 纯新增文件，按相对路径原样拷进仓库
  replaces/**              快照，**允许覆盖被 git 跟踪的目标**（生成物专用，见下）
```

`../.gitattributes` 把 `*.overlay` 钉成 `eol=lf`——根 `.gitattributes` 的 `*.js text eol=lf`
**命中不了 `.overlay` 后缀**，少了这一条，任何一次 Windows 克隆都会把 overlay 源写成 CRLF，
apply 出来的字节就和提交的版本不一致。

### `files/` 与 `replaces/` 的区别（**别搞混**）

| | `files/` | `replaces/` |
|---|---|---|
| 目标已存在且被 git 跟踪 | **拒绝**（`conflict-tracked`） | 允许覆盖 |
| `--revert` 怎么还原 | 内容仍与 overlay 一致才删 | 一律 `git checkout -- <目标>` |
| 用途 | 纯新增文件 | 生成物快照 |

`replaces/` 有四份。前三份是**压成一行的生成物**，锚点补丁表达不了（`git diff` 只有 1 个 hunk）：

```
replaces/data/assets.json        2,460,308 B  素材清单（她的音效、271 款皮肤、语音语言表）
replaces/data/backups.json       2,078,479 B  备份干员池（units 90 个，含她）
replaces/test/golden/diy.json      421,749 B  DIY 金样本（npm run golden:update 生成）
replaces/data/announcements.json         4 B  公告板整份清空（`[]`，维护者 2026-10-16 定的展示口径）
```

少了前三份，换一份新基线再 apply 之后，**她不在 DIY 池里（选不到）、她的音效不被清单认领（没声音）**，
而 `apply.mjs --check` 依然会报「全部通过，无冲突」；少了公告那份，上游的版本公告会随新基线一起回来。

### 补丁格式

```json
{
  "file": "public/js/render/style.js",
  "about": "一句话说明",
  "hunks": [
    { "id": "C1-note-fever-constants", "find": "……基线里的原文……", "replace": "……替换后的原文……" }
  ]
}
```

`apply.mjs` 的规则（**写新补丁前务必读一遍**）：

| 规则 | 原因 |
|---|---|
| `find` 在文件里必须**恰好出现一次** | 0 次 → `conflict-anchor-missing`；多次 → `conflict-anchor-ambiguous(n)`。两种都 exit 1，绝不猜 |
| 同一个补丁里两个 hunk **不许用完全相同的 `find`** | 第一个 hunk 应用后会把新文本插在锚点前，第二个 hunk 的 `replace` 就不再与锚点相邻，于是下一次运行第一个 hunk 又判成 `will-apply` 并**重复插入**。（真实事故：C9 让 `skillSfxUrl` 声明了两次，报 `SyntaxError: Identifier 'skillSfxUrl' has already been declared`。现在这条由 `validatePatch()` 硬性拦截。） |
| **跨补丁**也不许两个补丁共用同一个 `find` | 两个补丁都往同一锚点前插入时，第二个的位置有歧义，`already` 判据同时失效。（真实事故：C10b 与 C11a 都锚在 `export function pickUnitSfx(banks, opts = {}) {`，`PROJECTILE_SFX_BANKS` 被插了四份。现在由 `loadPatches()` 的 `seenGlobal` 硬性拦截。）正确做法是用 `_build/gen-patch-from-file.mjs` 把两个补丁合并成一个。 |
| **多个补丁可以打同一个文件**，`apply.mjs` 会串行累加 | 曾经每个补丁都从磁盘重新读原文，于是「后写者赢」——C12 给 `public/js/audio.js` 的 10 个 hunk 被 C9 整个盖掉，而 `--check` 还报一切正常。现在 `main()` 把上一个补丁的输出**串回**下一个的输入，每个文件只写一次。 |
| 幂等判据 = `文件里已包含 replace` | 所以 `replace` 必须保留锚点原文（新内容插在锚点前 / 后 / 夹在锚点之间），应用后能完整找到 |
| 新增文件的目标若是 git 跟踪文件 → 拒绝覆盖 | 防手滑把 overlay 文件盖到基线文件上（要覆盖就显式放进 `replaces/`） |
| 一个改动必须**同时**进 overlay 和分支 | 只在分支上直接改文件 = 这个改动**不会**被 overlay 复现。真实事故：6 个测试适配只改在分支上，换基线 apply 后测试全红 |
| `files/` 里以 **`.overlay`** 结尾的存储名，拷贝时去掉该后缀 | overlay 的补丁测试源存在 `files/test/**`。`node --test` 的发现规则是「任何 `*.test.js` **以及 `test/` 目录下的任何 `.js`**」，不加后缀它们会被当成第二份测试跑，而相对 import 在 `mods/` 下断掉 ⇒ `npm run ci` 无故变红。 |

## 补丁清单

| 层 | 补丁 | 目标 | 作用 |
|---|---|---|---|
| A 引擎出口 | `A1-projectile-steer` | `server/sim/projectiles.js` | 让内容方接管弹道飞行（`steer(p, dt)`）。**保留 dust 的 `detmath.hypot`** |
| | `A2-ai-no-attack-vis-damage` | `server/sim/ai.js` | `noAttackVis`（不画刀光）/ `noAttackDamage`（本次攻击不结算伤害，只走技能钩子） |
| | `A3-snapshot-proj-fever` | `server/sim/battle/events.js` | 快照里加 `proj`（内容方投射物的位置/种类）与 `fever`（计量表百分比） |
| | `A4-professions-profile-fields` | `server/sim/professions.js` | 文档：profile 上的两个新字段 |
| B 注册 | `B1-kits-register` | `server/sim/content/kits/index.js` | 把 `op-oblvns.js` 加进手工冻结的 `OPERATOR_KIT_FILES`（**无目录扫描，漏了不报错**） |
| | `B2-build-data-diy-pool` | `tools/build-data.mjs` | `DIY_INCLUDED_COLLAB` 白名单，把联动干员放进自选池 |
| C 客户端 | `C1-style-note-constants` | `public/js/render/style.js` | `NOTE_SIZE` / `NOTE_FX` / `NOTE_INK` / `FEVER_ROSE*` + `PROJ.note` / `PROJ.noteSkill` |
| | `C2-textures-note-glyphs` | `public/js/render/textures.js` | FX 图集里的三个音符字形（`drawNote` / `drawTreble`） |
| | `C3-fxsystem-notes` | `public/js/render/fx/system.js` | `FxNotes` 接进 `FX_PARTS` 与方法序（**dust 的 `officialNumber` 必须留着**） |
| | `C3b-fxsystem-container` | `public/js/render/fx/system.js` | `FxSystem` 的 note 容器：构造 / `clear()` / `update()` / `counts` / `destroy` |
| | `C4-fxprojectiles-note` | `public/js/render/fx/projectiles.js` | 音符不画拖尾、用字形当贴图；远程 `'none'` 攻击不画刀光 |
| | `C5-fx-reexport-notes` | `public/js/render/fx.js` | 再导出 `NOTE_FRAMES` / `pickNoteFrame` |
| | `C6-app-ctx-notes` | `public/js/render/app.js` | ctx 加 `rangedOf` / `units`（`_noteOwner` 反查单位）+ 每帧 `fx.syncNotes(interp.projAt(t))` |
| | `C7-interp-proj-fever` | `public/js/render/interp.js` | `normalizeSnapshot` 认 `proj` / `fever`，新增 `projAt()`，`sample()` 带出 `fever` |
| | `C8-units-fever-badge` | `public/js/render/units.js` | `FEVER_ICON` 玫瑰环徽标 + SP 条转玫红。**本层最危险的文件**：dust 比 sakiko 新 198 行，绝不能整文件覆盖 |
| | `C9-audio-playproj` | `public/js/audio.js` | `skillSfxUrl` / `projSfxUrl` / `playProj`。`playProj` 显式传 `pri: SFX_PRI.deco` —— `SFX_PRI.deco` 的文档注释点名的就是「内容方投射物的发射（音符诞生）」，不传就回落成 `event` 层，满声道时永远挤不掉别的声音 |
| | `C10c-audio-sfx-surface` | `tools/assets/audio.mjs` | 音效表全量：`PROJECTILE_SFX_BANKS` + `projSfx()`、`SKILL_START_BANKS` / `SKILL_SFX_BANKS` / `SKILL_SFX_ROLES` / `UNIT_SFX_BANKS` / `unitSfxBanks` / `skillSfx`。**由 `gen-patch-from-file.mjs` 从 pristine 一次生成**（原先的 C10b + C11a 撞锚点，已合并） |
| | `C10d-plan-sfx-surface` | `tools/assets/plan.mjs` | `projSfxLeaves()`、`VOICE_LANG_OVERRIDE` / `SOUND_ALTS` / `soundPathOfUrl` / `soundAltOfUrl`，导出 `voiceAlt` / `soundAlt`；unit 音效合并 + 每技能音效 + 语音语言重定向。**同样是生成的 9 个 hunk**（原先的 C10a + C11b 已合并）。**全部是加法**：dust 自己的 `pickUnitSfx(..., { projectile })` 调用原样保留，只在外层加 spread |
| | `C12-audio-limiter-loops` | `public/js/audio.js` | `SFX_PRI` 优先级 + `SfxLimiter`（`alive` / `tryAcquire(…, pri)` / `release` / `popOldest` / `popQuietest`）、`startLoop` / `stopLoop` / `stopAllLoops` 持续段循环、`activeSkill` 追踪，以及它的消费方（技能开始/结束/阵亡开停循环）。**按 URL 的间隔保持 dust 的全局 `lastByUrl`** —— sakiko 的按单位 `lastByUrlUnit` 已被撤掉，理由见下节分歧表第 ① 条。**由 `gen-patch-from-file.mjs` 从 C9-only 快照一次生成**（原先的 C12 + C13 撞锚点，已合并为 11 个 hunk） |
| D 测试适配 | `D1-audio-tests` | `test/ui/audio.test.js` | 她的音符音效用例接进 dust 的音频测试。**与原作者 0.1.4 的断言有 7 处分歧，按 dust 契约改写**（见下节）。改写后的结果是 **74 / 74 通过**（`node --test test/ui/audio.test.js`）；6 个 hunk、回放自检 PASS |
| E 基线计数 | `E1a-backups-pool-count` | `test/backups.test.js` | DIY 池 72→73、`emptyShip` 38→39、协防排除表去掉她、`isCollab()` 白名单 |
| | `E1b-potential-forms` | `test/potential.test.js` | 形态总数 259→262 |
| | `E1c-full-potential-forms` | `test/full-potential.test.js` | 同上（另一份副本） |
| | `E1d-docs-voicejp` | `test/docs-consistency.test.js` | 文档校验：她只有日配，`voiceJp` 计数 = `charIds.length + jpOnly.length` |
| E3 展示口径 | `E3a-lobby-notice-ready` | `public/js/screens/lobby.js` | 公告板清空后不再挂「查看」入口，卡片显示「暂无公告」 |
| | `E3b-lobby-feedback-hidden` | `public/js/ui/lobbyFeedback.js` | 大厅隐藏反馈群按钮（复制群号的函数保留、仍可导出调用） |
| | `E3c-announcements-tests` | `test/ui/announcements.test.js` | 公告测试改成断言「清空的公告板」 |
| | `E3d-cluster-status-tests` | `test/ui/cluster-status.test.js` | 集群状态测试不再依赖公告内容 |
| | `E3e-lobby-feedback-tests` | `test/ui/lobby-feedback.test.js` | 反馈群测试改成「这个部署不显示按钮」，复制路径仍测 |

E3c / E3d 的目标文件是 dust 自己也在改的测试（0.3.0 之后 `9b9dd3d4` 又重写了这两个块），
所以补丁的 `find` 一旦被上游改字就失效。重定基用 `_build\_relobby-tests.mjs --write`
（按**结构标记**在我们的断言前后切片、不用整块文本），再 `gen-patch-from-file.mjs` 重新生成，最后 `apply.mjs --check`。

`files/` 里的纯新增文件：

| 文件 | 作用 |
|---|---|
| `server/sim/content/kits/ops/op-oblvns.js` | 她的 kit 本体（Fever 计量、三形态、S3 免死）。**已改写为确定性版本**：顶部加了 `// ---- LOCAL OVERLAY PATCH: determinism ----` 说明与 `import { hypot, atan2, cos, sin } from '../../../detmath.js';`，并把她原本的 `Math.hypot`/`Math.atan2`/`Math.cos`/`Math.sin`（10 处，来自 0.2.1 基线）全部换成 `detmath` 的版本 —— 否则 `no-restricted-properties` 报 10 个 error，且 `test/sim/detmath.test.js` 的「the sim never calls an implementation-approximated Math function」会红 |
| `public/js/render/fx/notes.js` | 音符投射物的渲染池 |
| `tools/fetch-voice-override.mjs` | 拉她上游缺失的中文战斗语音与技能音效 |
| `test/content/op_oblvns.test.js` | kit 契约测试 |
| `test/render/fxnote.test.js` | 音符渲染测试 |
| `test/sfx-oblvns.test.js` | 技能/投射物音效清单测试 |

## 从零安装

```powershell
cd StrongholdPro
npm.cmd ci --no-audit --no-fund          # 生产+开发依赖；postinstall 会跑 tools/vendor.mjs 生成 public/vendor
node mods/sakiko/apply.mjs               # 打补丁 + 放新文件
node tools/build-data.mjs --offline      # 重新生成 data/（含 backups.json 的自选池）
```

`build-data --offline` 需要 `.cache/gamedata/` 里的官方数据表。若本机的 `raw.githubusercontent.com` 被 hosts 黑洞，用工作区外的两个助手脚本经 `ghproxy.net` 补齐：

```powershell
node ..\_build\fetch-gamedata.mjs          # 8 张总表
node ..\_build\fetch-gamedata-levels.mjs   # 50 张关卡表
node ..\_build\fetch-gamedata-extra.mjs    # charword_table.json + audio_data.json
```

### 素材与语音（E 层）

```powershell
$env:SP_GITHUB_PROXY = 'https://ghproxy.net/'
node tools/fetch-voice-override.mjs        # 她上游 404 的中文战斗语音（走 JP dump）
node tools/fetch-voice-override.mjs --sfx  # 她的技能音效
node tools/fetch-assets.mjs --offline --allow-shrink   # 让 data/assets.json 认领这些文件
```

`public/assets/` 与 `.cache/` 都在 `.gitignore` 里，永不提交。

## 验证

```powershell
node mods/sakiko/apply.mjs --check
node --test --test-timeout=45000 test/content/op_oblvns.test.js test/render/fxnote.test.js test/sfx-oblvns.test.js
node tools/golden.mjs            # 打了补丁的树必然与旧 golden 不符 —— 见下
```

`test/golden/diy.json` 记录了自选池的确定性结果。祥子进了 DIY 池 ⇒ 结果必然移动，必须用 dust 自己的工具重生成（**禁止抄 sakiko 的数字**）：

```powershell
npm run golden:update
```

### 证明 overlay 完整（**唯一可信的方法**）

抽查文件清单会骗人 —— 实测抽查报 38/38 全绿，却漏了 10 个真实差异。
必须在独立 worktree 里做**双向集合比对**：

```powershell
$live = 'D:\DSH\StrongholdPro\StrongholdPro'
$wt   = 'D:\DSH\StrongholdPro\_build\verify-master'
git -C $live worktree add --detach $wt master

# ⚠️ 顺序坑：worktree 里 `git checkout -- .` 是从**索引**还原，
#    而索引里那份 mods/ 是建 worktree 时的旧版 —— 会把刚铺进去的 overlay 盖回去。
#    所以：先重置，再铺 overlay，最后才 apply。
git -C $wt checkout -- . ; git -C $wt clean -fdq -- . ':(exclude)mods'
git -C $live archive -o mods.tar HEAD mods      # 别用 `git archive | tar`，PS 5.1 管道会打坏 tar
Remove-Item "$wt\mods" -Recurse -Force ; tar -x -f mods.tar -C $wt
node "$wt\mods\sakiko\apply.mjs"

# A：分支相对基准真改了什么（排除 mods/）
git -C $live diff --name-only master..mod/sakiko -- . ':(exclude)mods'
# B：overlay 真写出了什么
git -C $wt status --porcelain | Where-Object { $_ -notlike '*mods*' }
# C：A 与 B 双向差集必须都为 0
# D：交集逐文件 SHA256 必须全等
```

**A/B/C/D 全绿才算过。** 当前基线（`master` = dust `2b1cdb6b`）实测：A=37、B=37、C=0/0、D=0。

## 交付流程（维护者定下的硬规则）

**一个项目做完 ≠ 可以打包。** 顺序固定：

1. 代码 + 测试 + golden + `ci` 全绿；
2. **在本地把网页服务起起来，交给维护者实机试玩**；
3. 维护者说「可以打包」或「此项目已完成」之后，**才**能打包（`npm run package`）、才能算完成。

也就是说：**打包这一步永远由维护者的口令触发，不由测试通过触发。** 在维护者测试期间提出的问题先记下来、等他下令再改，不要一边测一边改。

## 与上游更新的兼容性

上游（official / dust）前进后：

1. `git -C StrongholdPro pull --ff-only`（`master` 是纯净基线，永远能快进）
2. `node mods/sakiko/apply.mjs --check`
   - 全 `already`/`will-apply` → 直接 `apply.mjs`
   - 出现 `conflict-anchor-*` → **人工重锚**：打开报冲突的那个 hunk，按上游的新原文改 `find`，必要时把它劈成两个 hunk（注意重复锚点规则）
3. `node tools/build-data.mjs --offline` 重跑（上游数据表变了就得重跑）
4. `npm run golden:update` 重跑
5. 跑一遍本 mod 的三个测试 + `npm run ci`

### 上游 0.2.6 的已知情况

`source\official` 的 `origin/master` 已到 0.2.6，而 dust 基线仍是 `2b1cdb6b`（= official `v0.2.5` 的分叉点）。合并时官方独有 54 个文件、dust 独有 570 个，**39 个文件双方都改过**。建议等本 mod 稳定后再单独开分支处理，不要中途升基线。

## 维护工具（都在工作区根的 `_build\`，不属于 overlay 本体）

| 脚本 | 用途 |
|---|---|
| `gen-patch-from-file.mjs` | **生成补丁的首选方式**：`node _build/gen-patch-from-file.mjs <仓库内相对路径> <目标文件> <输出补丁.json> [--label <id>]`。用 LCS 行级 diff 把「文件应该长成这样」变成 hunk，自动扩上下文直到 `find` 唯一、检查同补丁内不重复，最后**回放自检**（把 hunks 打回 pristine 必须与目标逐字节相同，否则 exit 1）。默认对 `git show HEAD:<路径>` 的 pristine 生成。C10c / C10d 就是这样产出的 |
| `diff-file.mjs` | `node _build\diff-file.mjs <相对路径> [上下文行数]` —— LCS 行级 diff，左边是 dust（`StrongholdPro/`）、右边是 sakiko（`source/sakiko/`）。**甄别「哪些是 dust 自己的新功能」必须用它** |
| `lines.mjs` | `node _build\lines.mjs <路径> <起> <止>`，`--sak/` 前缀走 sakiko |
| `diff-fx-order.mjs` | 比较两边 `FX_PARTS` / `FX_METHOD_ORDER` |
| `check-c-layer.mjs` | C 层 12 条断言（改完 C 层必跑） |
| `fetch-gamedata*.mjs` | 见上「从零安装」 |
| `regen-d1.mjs` | 从 pristine `test/ui/audio.test.js` 到当前工作树重生成 `D1-audio-tests.patch.json`，并自检「无两个 hunk 共用 find」 |
| `compare-suite.cjs` | `node _build\compare-suite.cjs <基线日志> <当前日志>` —— 按**测试文件**比对两份 `node --test` 日志的失败数并给 VERDICT（按唯一标题比会因父 suite 改名而严重高估）。注意 PowerShell 5.1 下 `node --test *> f` 写的是 **UTF-16LE**，脚本要按 BOM 解码 |


## 素材与清单（**做错会静默删掉基线的东西**）

她的语音、技能音效、投射物发射音都不在基线里，清单（`data/assets.json`）也不认识她。**正确顺序**（这台机器已经跑完，记录在此供重来时用）：

```powershell
cd StrongholdPro
node tools/fetch-voice-override.mjs                                  # 缺的战斗语音（上游任何地方都没有，只有日配）
node tools/fetch-voice-override.mjs --sfx                            # 缺的技能音效
node tools/prepare-operator-skins.mjs --source <缓存目录> --download --model-source metadata
node tools/fetch-assets.mjs --voice-langs=cn,jp,en --concurrency=8   # 顺带把英文配音树补齐
node tools/fetch-assets.mjs --offline --allow-shrink                  # 重写清单，让它描述磁盘的真实状态
```

⚠️ **`--allow-shrink` 会顺手删掉基线自己的两棵树 —— 除非先按上面的顺序把素材补齐。** `data/assets.json` 是**生成物但也被提交**，而它描述的两块内容默认重建不出来：

| 丢的东西 | 提交版 | 只跑 `fetch-assets` | 为什么 |
|---|---|---|---|
| `skins` | 271 条 | 0 | 由 `tools/prepare-operator-skins.mjs` 单独产出；`retainInstalledSkins` 只能保留**磁盘上确实装了的** skin |
| `audio.voiceByLang.en` | 182 个干员 | 0 | `fetch-assets` 默认只取 `voiceLang: 'cn'`，英文配音树根本不在盘上 |

本机踩过一次：`--allow-shrink` 的原意只是接受那 8 条**上游确实不存在**的叶子，结果把 650 KB 的 `skins` 和整棵 `en` 语音一起接受掉了，`test/render/spine-first-pose.test.js` 直接红（它读 `manifest.skins.char_332_archet_sale_14.spine[…]`），`test/assets.test.js` 也报 **5028 个清单引用在盘上不存在**。

**现在的正确做法不是合并清单，而是把素材真的装上**（上面的顺序）：装上之后 `--allow-shrink` 只会掉那 8 条该掉的，`test/assets.test.js` 报 0 缺失，skins 271/271。早先为此写的 `merge-manifest.mjs`（以提交版为基座深合并）**已经不需要了** —— 它只是把清单骗回完整，磁盘上依然缺文件，`test/assets.test.js:697`「every manifest path exists on disk」会正确报红。

两条容易踩的坑：

- **皮肤源要用 `--model-source metadata`**。默认的 `legacy` 模式靠猜 `https://static.prts.wiki/spine38/<stem>` 拼 URL，本机跑出来 **149 条 404**（`122 ready / 149 unavailable`）；metadata 模式读 `https://torappu.prts.wiki/assets/char_spine/<charId>/meta.json`，**0 失败**。`docs/ASSETS.md` 本来就写着「source rather than guessing legacy `/spine38/skin/` URLs」。
- **metadata 模式会跳过已经在 `manifest.skins` 里的皮肤**（它把这叫 `preserved`）。所以补装之前要先算出「目录里有、清单里没有」的那些 id，用 `--catalogue <只含这些 id 的 json>` 喂进去。
- 安装器写的是 `<skinId>.display.skel` 而**不是** `<skinId>.skel`；按固定文件名判「装没装」会把 124 个已装的报成 41 个，要按「该皮肤目录下存在任意 `*.skel`」判。

顺带一提：提交版清单的 `generator` 是 `tools/merge-generated-release.mjs`，和本机 `fetch-assets` 写的 `tools/fetch-assets.mjs` 不是一个工具 —— 基线清单本来就是在另一台跑过完整管线的机器上生成的。

## 与 sakiko 的分歧：**dust 的契约优先**

她的基线是 `0.2.1`，我们是 `0.2.5`，有几处**两边都能自圆其说、但只能留一个**的差异。项目的硬约束是「对之后的官方基础版 / dust 版更新没有影响」，所以**一律保 dust 的语义**：把她的旧行为搬回来，等于让下一次 `git pull` 撞上我们翻转过的、dust 自己的测试期望。她自带的测试因此要被改写成断言 dust 的真实契约，并在改动处留注释标明分歧。

| 分歧 | sakiko 0.1.4 | **dust 0.2.5（采用）** | 影响 |
|---|---|---|---|
| 同一 URL 的间隔 | **按单位**（`lastByUrlUnit`，键 `` `${unitKey}\u0000${url}` ``）—— 场上有两只同名干员时各响各的 | **全局** `lastByUrl` —— 同一时间戳下只有第一份起播，第二只要等满间隔 | `SfxLimiter`；`audio.js` 一行不改，测试改写 |
| 施放结束后的命中归属 | `recentSkill` + IMPACT_WINDOW_MS：施放已结束、音符稍后落地，落地仍算那个技能的命中 | 只有 `skillActive` 为真时才播 `hits[skillIndex]`；**没有 `recentSkill`** | 瞬时技能（S1）的音符落地不再算 S1 的命中音 |
| 技能结束音 | `skillSfx[i].finish` 在技能**结束**时播 | `skills[skillIndex]` 在技能**开始**时播，**不消费 `finish` role** | S2 的结束音不再单独响 |
| 技能形态命中音的数据来源 | 自带 `skillSfx` cue 层与显式点名表 | `pickModeHits` 读 `ON_ABILITY_HIT` 的 mode letter | 她的技能命中音 bank 挂在 `ON_CUSTOM_TRIGGER.projectile_chr_oblvns_s*_hit` 下 → 机制看不见 ⇒ 见下 |

`test/ui/audio.test.js` 里被改写的 7 条（新标题就是现在的标题，改动处都留了注明分歧的注释）：

| 原（0.1.4）标题 | 现在断言的是 |
|---|---|
| `the per-url gap is per unit: two units of one character each get their own copy` | `the per-url gap is GLOBAL, not per unit (dust 0.2.5 contract — a deliberate divergence)` |
| `two 丰川祥子 on one field: each unit rings (one batch, one timestamp)` | `two 丰川祥子 on one field: the first copy rings, the second waits for the GLOBAL gap (dust contract)` |
| `an INSTANT skill (her S1) ends in its own tick while its notes fly: their landing still counts as S1` | `an INSTANT skill (her S1) ends in its own tick: the later landing is an ORDINARY hit (dust contract)` |
| `a \`_d\` / \`_h\` / \`_s\` skill-mode hit IS the skill's sound` | 同名，但 fixture 改成写 **`hits['0']`**（dust 的槽位）并让施放**保持进行中**，这样 `mode` 才绕得开 `normalAttackSfx` 闸门 |
| `S2's end rings its own finish cue` | `the skill's end event is silent: dust never consumes \`skillSfx[i].finish\` (deliberate divergence)` |
| `the end cue` / `a.recentSkill.size` 那条 | 去掉 `recentSkill` 断言（dust 没有这个字段），改断 `pendingSkill.size` |
| （另 2 条 `shrinkGuard` 之外的）`low priority is not muted` | 保持原断言，靠 C9 补的 `pri: SFX_PRI.deco` 转绿 |

**唯一为她加的**：`tools/assets/plan.mjs` 里补一条通用回填 —— **技能的 `skillSfx[i].hit` 同时就是那个技能的 `hits[i]`**（只在 `pickModeHits` 留空时填，所以任何本来就解析得出的干员条目一字不变）。`public/js/audio.js` 仍然一行不加：客户端的 `unit()` 早就会给「技能施放中、归给该单位的伤害」播 `hits[skillIndex]`，缺的只是清单里那个字段。

**她缺中文战斗语音**：上游任何地方都没有（十四条 `voice_cn/char_4182_oblvns/cn_0*.mp3` 全 404，整个联动都这样），只有日配 ⇒ `audio.voiceJp` 有她、`audio.voice` 没有。这是数据事实，不是移植缺陷。



- **只移植她自己的新增**。sakiko 里「sakiko 有、dust 没有」的行大多是 dust 已经改写过的旧版本（`units.js` 少 198 行、`interp.js` 少 53 行、`app.js` 少 581 行），整文件覆盖会丢 dust 0.2.5 的功能（Fever 计量条就画在 `render/units.js` 的 `FEVER_ICON`）。
- **音频与清单侧一行都不能原样 apply**：dust 的 `sfx.units` 已改复数 `attacks`/`hits`、`tools/assets/audio.mjs` 的推断逻辑与 sakiko 的显式点名表不同。
- 每个音效 role 只放**一个**文件（sakiko 语义：清单播一个音），与 dust `soundLeaf`（最多 4 个备选、客户端随机抽）语义不同；mod 自带测试明确断言「first sound, not a list of takes」。
- `PROJECTILE_SFX_BANKS` 的 kind 集合是**闭合**的（只有 `note` / `noteSkill`）。
- **手改过某个被补丁覆盖的文件后，必须立刻重生成那个补丁**。`apply.mjs` 的幂等判据是「`replace` 已在文中」，某个 hunk 插进去的文本一旦被你手工改动，它的 `replace` 就不再连续 ⇒ 下一次 `apply` 会把这个 hunk **再插一遍**，产生整块重复（本项目在 `D1-audio-tests` 上真踩过一次：改写了 7 条测试却没重生成，随后 `apply` 把整块用例复制成两份，文件从 1675 行涨到 2076 行）。用 `_build\gen-patch-from-file.mjs` / `_build\regen-d1.mjs` 从 pristine 重生成，再看 `回放自检：PASS` 与 `apply.mjs --check` 全 `already`。收尾验证照旧跑一次 `--revert` + `apply` 并用 SHA256 比对，确保逐字节复现。
