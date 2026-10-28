# mods/luck —— Stronghold-Luck 控制台（StrongholdPro 的第二件外挂）

> 2026-10-28：当前目标已改为本目录的 `runtime/`，固定上游 **v0.1.7 / c4dcba17**，不再改写 `source/luck`。
> `node mods/luck/launch.mjs --no-open --port 3000` 显式指定本主树；工作区 `start-pro-luck.cmd` 已指向该入口。
> `target.json` 指向 `runtime`；L2–L7 应用后随本仓库保存，再次检查/应用应保持幂等。
> 旧文中的 `source/luck` 表示历史目标；Selena 启动器及只读参考克隆保持原样。来源见 `upstream.json`。

这个目录是一份 **overlay**：它不改游戏本体的一个字节，只把「Stronghold-Luck 控制台」上我们需要的两件事，
以**锚点式补丁**的形式叠加上去，随时可以一条命令撤干净。

它和 `mods/sakiko/` 是同一套机制（同一份 `apply.mjs`），只有一处不同 —— 见下面「目标根」。

> **试验台（`mods/sandbox/`）已于 2026-10-15 移除**：维护者实机试过后判定那一页不好用，
> 决定「不做了，把需要的测试功能直接加进 Luck 插件」。原 overlay 与应用态归档在
> `_archive/old-mods-sandbox/`（含 `applied-state/` 静态副本），里面那些**引擎侧发现**
> （自选位/精锐 `goldenId`、`enemyKey`、盟约两套口径、`bondTier` 按成员数而非层数…）
> 仍然是做新功能时的第一手资料。原来那个「试验台」按钮（`L1`）已随之删除。

---

## 它做什么

| # | 补丁 | 目标文件 | 做什么 |
|---|---|---|---|
| **L2** | `L2-shop-level-server.patch.json` | `src/server-patch.mjs` | 服务端实现 **「调度中心 · 直接设置等级」**（新意图 `g.modShopLevel { level }`）。 |
| **L3** | `L3-shop-level-ui.patch.json` | `public/overlay.js` | 面板上的 **调度控件**：沙盒条上一个 1..6 的数字框 + 「设置调度」按钮 + 总开关页新增一行「调度中心 · 直接设置等级」。 |
| **L4** | `L4-test-server.patch.json` | `src/server-patch.mjs` | **测试页的服务端**：资金 / 当前回合 / 回合上限 / 两个时限 / 设置敌人 / 更换地图 / 盟约层数 / 自选 boss / 出怪组合全集，以及下面的 **L4-gate**。 |
| **L5** | `L5-test-page.patch.json` | `public/overlay.js` | **测试页的面板**：页签与页本体、搜索框的焦点与输入法、布局注入、沙盒条入口，以及下面的 **L5-gate / L5-gate2**。 |
| **L6** | `L6-skins.patch.json` | `public/overlay.js` | 面板里的干员卡片跟随玩家所选皮肤（`v.priv.skins[charId]` → `chessPortraitUrl(assets, c, { skin })`），不再永远画默认立绘。 |

（L4/L5 由 `_build/gen-luck-test.mjs` 生成 —— 那是它们唯一的真源，别手改这两个 JSON。）

### 开局前的实验性开关「Luck 测试插件」（L4-gate / L5-gate）

维护者 2026-10-16 定：这个控制台是**开局前可选的实验性选项** —— 房间没勾就整体休眠，普通房间碰不到它。

- 开关本体在游戏侧：`shared/experimental.js` 的 `EXPERIMENTAL_OPTIONAL`（键名 `luckConsole`）+ 房间界面
  的「实验性选项」弹窗（`public/js/ui/experimental.js`，复选框 `#experimental-luck-console`）。服务端把它经
  `m.public.experimental` 发给客户端。
- **L5-gate**（`public/overlay.js`）：`view()` 在这一局没勾时返回 `null` ⇒ 入口按钮与面板都不出现，每局
  推给服务端的 `g.modEnable` 也根本发不出去（`view()` 返回 null 本来就是上游支持的「这局用不上」状态）。
- **L5-gate2**（`public/overlay.js`）：`store` 的订阅里除了 `render()` 还会**直接**调 `renderUnits()` /
  `renderDiy()` / `renderEnable()`，它们内部的 `sendUnits()` / `sendDiy()` / `sendEnable()` 不经过 `view()`。
  实测（2026-10-16）只加 L5-gate 时，**关着开关的一局仍然发出** `g.modUnit` / `g.modDiy` / `g.modEnable`
  三条意图（服务端拒掉，但客户端不该发）⇒ 订阅开头补一句 `if (!view()) { root.hidden = true; lastSig = null; return; }`。
- **L4-gate**（`src/server-patch.mjs`）：`Match.prototype.handle` 里先把 `g.mod*` 意图一律拒掉（理由
  「这一局没有开启 Luck 测试插件（房间的实验性选项）」）⇒ 就算有人手改客户端也做不了什么。
- 实测（2026-10-16）：**没勾**的房间 —— 根节点 `hidden`、入口不可见、服务端日志里**一条 `[luck] … refused`
  都没有**（只有启动时那批 `[luck] hooked …` 安装行）；**勾了**的房间 —— 面板 23 pass / 0 fail。
- **装进进程的 hook 在没人推送时是惰性的**（同一份证据脚本 `_build\_chk-luck-inert.mjs`）：同一个 node 进程里
  先跑仓库的 `matches` golden（21 局）再 `installServerPatch()`（`ok=true missing=[]`）重跑一遍 —— 两遍都与
  `test/golden/matches.json` 逐字节相同，且两遍互相相同 ⇒ 「不开 luck 的对局结果不变」有对局侧证据。
- 只勾另一个新开关 `briefingSpecialEnemies`（策略阶段看特训敌人）时 Luck 依旧休眠 ⇒ 两个开关互相独立。
- 只勾另一个新开关 `briefingSpecialEnemies`（策略阶段看特训敌人）时 Luck 依旧休眠 ⇒ 两个开关互相独立。

（补丁编号 `L1` 留空 —— 那是已删除的「试验台」按钮，编号不回收，免得和旧记录对不上。）

### 为什么原来那个「试验台」按钮不用改代理（存档，做新功能时仍成立）

`src/launcher.mjs` 只重写两个路径：

```js
const isRewritePath = (p) => p === '/' || p === '/index.html';
```

它会往这两个响应里塞一个 `<link>` + 一个 `<script>`（`/mod/overlay.css` 与 `/mod/overlay.js`），
**其余请求一律原样透传**（`/sim/*`、`/data/*`、WebSocket 升级都在内）。
也就是说：**只要把文件放进 `source/luck/public/`，它就能通过 `/mod/...` 或者作为独立一页被访问，
根本不用碰代理。** 新的测试页面要走这条路。

### 「直接设置等级」为什么两个方向走两条路

上游 README 把「调度中心等级限制」明确列在**没改的东西**第一条里；代码里也确实只读不写
（`ps.shop.level` 出现 11 次全是读，`levelUp` 只出现在对局记录器的 `PS_ACTIONS` 动作表里）。

> **改版记录.** 第一版做的是「升级不花钱」——在外面包一层 `PlayerState.prototype.levelUp`，只把价钱拿掉。
> 维护者实测反馈**不好用**：钱是不要了，但升级仍然要自己点、仍然受每回合节奏约束，测起来还是绕。
> 于是改成**直接设等级**，并把那个全局猴补丁**整个撤掉**（少一处公共管道被改，风险也更小）。

游戏自己的实现是 `server/match/player/economy.js` 的 `levelUp()`：

```js
levelUp() {
  const g = this._gate(); if (g) return g;
  if (this.shop.level >= this.gd.maxShopLevel) return fail(ERR.MAX_LEVEL);
  const price = Math.max(0, this.shop.upgradePrice);
  if (this.funds < price) return fail(ERR.NO_FUNDS);   // ← 卡这里
  this.spend(price); this.shop.level++;
  this.shop.upgradePrice = this.gd.upgradeBase(this.shop.level) ?? 0;
  this._openLevelSlots();
  ...
}
```

**升级方向（`want > 现在`）走游戏自己的 `levelUp()`，连调 `want - 现在` 次**：每次调用前把价钱临时补上、返回后收回去。

```js
if (Number.isFinite(before)) ps.funds = before + price;   // 让游戏自己那道 `funds < price` 通过
const res = ps.levelUp();
...
if (Number.isFinite(before)) ps.funds = before;           // 收回去，资金一分不差
```

结果是：**等级上限（`maxShopLevel` = 6）、开槽（`_openLevelSlots`）、审计
（`server/match/audit.js` 的 `level → level+1`）与 `onLevelUp` 派发全部照原样逐级发生** ——
引擎看到的就是「连着升了几级」，不是被人硬写了一个数。

**降级方向（`want < 现在`）** 游戏自己没有路径，才直接写回 `ps.shop.level`，
并把 `upgradePrice` 用游戏自己的 `gd.upgradeBase(want)` 重算、调一次 `_openLevelSlots()`。

这不是「运气好」，是真变强 —— 所以它和别的一样挂在**总开关**（`g.modEnable` → `shopLevel`）下面，
可以整组关掉。

---

## 目标根（这个 overlay 与另两件不同的地方）

`mods/sakiko/` 打的是本项目自己的仓库（`StrongholdPro/`），
而这一件打的是工作区里那份 **Stronghold-Luck 上游克隆**：

```
D:\DSH\StrongholdPro\source\luck      ← 补丁的目标（另一个 git 仓库）
D:\DSH\StrongholdPro\StrongholdPro\mods\luck   ← 本目录
```

所以在 `target.json` 里写明了根：

```json
{ "root": "../../../source/luck" }
```

`apply.mjs` 把补丁里的 `file` 一律**相对于这个根**解析；没有 `target.json` 时默认是仓库根
（对 `sakiko` / `sandbox` 完全无影响）。同理，`isTracked()` 是在**文件自己所在的目录**里问 git 的，
所以「`files/` 拒绝覆盖被跟踪文件」那道闸门跨仓库也照样成立。

---

## 用法

```powershell
cd D:\DSH\StrongholdPro\StrongholdPro

node mods\luck\apply.mjs --check     # 只检查能不能打，不写任何文件
node mods\luck\apply.mjs             # 应用（幂等：已应用的跳过）
node mods\luck\apply.mjs --revert    # 撤回（git checkout 被改的文件）
node mods\luck\apply.mjs --json      # 机器可读输出
node mods\luck\apply.mjs --root <dir>   # 临时把目标根改成 <dir>（相对**当前目录**解析）
```

`--root` 是给**验证**用的：证明「纯净检出 + 整份 overlay ⇒ 实盘」时，要在临时目录里铺一份 overlay 去打那份检出。
**没有 `--root` 的话 `target.json` 会把它引回实盘**，于是每个 hunk 都报 `already`、`--check` 也报「全部通过」，
却什么都没验证到 —— 看起来全绿，实际是空转。

一条命令验完（`$wt` 是那份纯净检出）：

```powershell
node mods-luck\apply.mjs --check --root $wt
node mods-luck\apply.mjs        --root $wt
# 然后比 $wt 与实盘 source/luck 的 status（排除 mod.config.json）与逐文件 SHA256，双向差集必须都为 0
```

跑起来：

```powershell
D:\DSH\StrongholdPro\start-pro-luck.cmd          # 默认端口 3000
D:\DSH\StrongholdPro\start-pro-luck.cmd --port 3010
```

`mod.config.json` 里的 `gameRoot` 指向 `D:\DSH\StrongholdPro\StrongholdPro`（我们的 Pro 工作副本），
所以 Luck 挂的是 Pro，不是它自己那份游戏。

---

## 改补丁的正确姿势（不要手改 JSON）

补丁里的 `find` 必须与文件里的**字节**完全一致（`apply.mjs` 是精确匹配），而 UTF-8 的中文在 Windows
控制台上显示是乱码 —— 手抄必错。所以一律跑生成器：

```powershell
node D:\DSH\StrongholdPro\_build\gen-luck-patches.mjs
```

它从 `source/luck` 的真实字节里 `indexOf` 切片，并对**每个 hunk 做「`find` 在源文件里恰好出现一次」的断言**，
不合格直接 exit 1。19 个锚点全部要 OK。

### 两个踩过的坑（已写进生成器注释）

- **锚点是某一行的开头时，必须取整行。** 第一版用 `"  'shopFilter',    //"` 当前缀，`replace` 插进了那一行的
  中间，`阵营锁 (g.modShopFilter)` 被拼到了新插入的 `'shopLevel',` 那一行末尾。
  现在 `FEATURE_KEYS` 整块替换、面板功能表用 `wholeLine()`。
- **往「已经带逗号」的行后面接内容不要再补一个逗号。** 第一版 `L2-view` 写成了
  `L2_VIEW + ',\n    shopLevel: …'`，结果 `cap: state.sandbox.cap,,` —— 直接是语法错误。
  同理 `L1-lab-entry` 多写了一个 `);`，把 `overlay.js` 弄出 `Unexpected token ')'`。

**每次改完必须 `node --check` 两个目标文件**，再复跑 `--check` 确认幂等。

---

## 行尾（为什么补丁按 LF 写，工作树却是 CRLF）

`source/luck` 既没有 `.gitattributes`，又开着 `core.autocrlf=true` —— 所以：

```
git ls-files --eol public/overlay.js
i/lf    w/crlf  attr/          public/overlay.js
```

**索引里是 LF，工作树里是 CRLF。** 补丁一律按 LF 书写；`apply.mjs` 会在**归一化成 LF 的文本上匹配与替换**，
写回时再还原成文件原本的行尾。这样同一份补丁在 `core.autocrlf` 开或关的机器上都成立，也不会把整棵树的行尾
悄悄改掉（实测应用后仍是 100% CRLF、0 个裸 LF）。

`--revert` 走 `git checkout --`，git 自己会按 `autocrlf` 还原工作树，不需要特殊处理。

---

## 目标文件现状（2026-10-14）

| 文件 | 行数 | 备注 |
|---|---|---|
| `public/overlay.js` | 3,073 → 3,107 | `38 ++++++++++++++++++++++++++++++++++--`（2 处上下文改动） |
| `src/server-patch.mjs` | 2,586 → 2,641 | `55 ++++++++++…` |

合并起来 `git -C source/luck diff --stat` 是 `3 files changed, 92 insertions(+), 2 deletions(-)`
（第 3 个文件是 `mod.config.json`，见下）。

`--revert` 之后 `git -C source/luck status --porcelain` 只应剩 `M mod.config.json`（那是我们加的 `gameRoot`，
**不属于本 overlay**，`--revert` 不会碰它）。

### 起服务后的自检（应该看到这两行）

```
[luck] registered intent g.modShopLevel
[luck] hooked PlayerState.levelUp (调度中心升级不花钱)
```

HTTP 侧：

```powershell
(Invoke-WebRequest http://127.0.0.1:3000/mod/overlay.js -UseBasicParsing).Content.Contains("const SHOPLEVEL = 'g.modShopLevel';")  # True
(Invoke-WebRequest http://127.0.0.1:3000/mod/overlay.js -UseBasicParsing).StatusCode                                                       # 200
```

## 「直接设置等级」在真引擎上的功能验证

光看到日志里那句 `registered intent g.modShopLevel` 只能证明**意图注册上了**，不能证明**行为对**。
所以另有一个在真引擎上跑的探针：

```powershell
node D:\DSH\StrongholdPro\_build\probe-luck-shoplevel.mjs
# ==> 15 pass / 0 fail
```

它 `installServerPatch()` 打上 Luck 的全部钩子，然后按 `test/match/revival.test.js` 的办法造一场**真 Match**，
拿真的 `PlayerState` 逐条验：

| 用例 | 期望 | 实测 |
|---|---|---|
| 总开关关着时发 `{ level: 4 }` | 被拒，理由「调度中心·设置等级已关闭（总开关）」 | ✅ |
| 打开总开关后 `{ level: 4 }` | `{ok:true}`，`ps.shop.level === 4` | ✅ |
| 整个过程 | **资金一分没动** | ✅ |
| 升级后的价钱 | 由游戏自己的 `upgradeBase()` 算出（`upgradeBase(4)` = 12） | ✅ |
| `funds = 0` 时设 `{ level: 6 }` | 成功到 6，**`funds` 仍是 0** | ✅ |
| 升级方向真的是游戏自己的路径 | `onLevelUp` 派发了 **3** 次（1→4 逐级） | ✅ |
| `{ level: 9 }` / `{ level: 0 }` | 按 `gamedata.maxShopLevel` 夹到 6 / 1 | ✅ |
| 降级 `{ level: 2 }` | 成功，`upgradePrice` 重算成 8 | ✅ |
| 设成当前等级 | 空操作且 `{ok:true}` | ✅ |
| 关掉总开关后直接调 `ps.levelUp()` | 立刻回到原版规则（`NO_FUNDS`）—— 我们没再包过它 | ✅ |

注意游戏自己的返回形状：**失败是 `{ error: ERR.X }`**（没有 `ok` 字段），**成功是 `{ ok: true }`**（没有 `error`）——
写断言时别写成 `res.ok === false`。

⚠️ 另有个探针自己的坑：`economy.js` 的 `levelUp()` 是
`this.m.tickerFor('SHOP_LEVEL', …)` **+** `this.m.dispatch(this, 'onLevelUp', …)` ——
走 `dispatch` 的事件名是 **`onLevelUp`**，`SHOP_LEVEL` 是 ticker。第一版探针盯错了名字，报了个假红。

## 回归验证：我们没挤掉 Luck 原有的意图（11/11）

L2 动了 `shared/protocol.js` 的 `C2S` 表与 `Match.prototype.handle` —— 这两处都是 Luck 的**公共管道**，
改坏了不只是这个功能失效，而是整个面板失灵。所以另有一个探针：

```powershell
node D:\DSH\StrongholdPro\_build\probe-luck-regression.mjs
# ==> 11 pass / 0 fail
```

| 用例 | 结果 |
|---|---|
| 原版 11 个意图（`g.modPick` … `g.modEnable`）全部还在 `C2S` 里 | ✅ 11/11 |
| 新增的 `g.modShopLevel` 也在，且表项形状与其它 11 个一致 | ✅ |
| **没有**再包 `PlayerState.prototype.levelUp`（改版后已撤掉那个全局猴补丁） | ✅ |
| 原版意图 `g.modEnable` 仍被 `handle` 正常路由 | ✅ |
| 原版意图 `g.modSpeed`（字段是 **`n`**，不是 `speed`）仍被接受 `{ok:true}` | ✅ |
| 总开关关掉 `shopLevel` 后发意图 → 被拒且理由是「总开关」 | ✅ |
| 总开关打开后 → `{ok:true}` | ✅ |

⚠️ 两个查表坑（都踩过）：
1. **不装补丁时 `C2S` 里 `g.mod*` 一个都没有** —— Luck 是在 `installServerPatch()` 里把它们注册上去的。
   单独 `import protocol.js` 去查会拿到 `undefined`，后面接 `.slice` 之类会直接崩。
2. `C2S[k]` 是**「字段→校验器」的对象**（`{ on: isBool }`），**不是**函数；
   而 `handle()` 收的是**玩家 id 字符串**（`'p_0'`），不是座位对象。

## 面板在对局开始前是空的（上游设计，别当成回归）

Luck 的主面板内容由 `render(v)` 画，而 `v` 取自**对局私有视图** —— `view()` 在拿不到
`store.get()?.match?.private` 时返回 `null`，于是：

- **大厅里**面板是打开的但**一个子节点都没有**（`panel.innerHTML.length === 0`）；
- 「总开关」那一页（`local.page === 'enable'`，`drawEnablePage()`）**也只有在对局中才画得出来**；
- 沙盒条（数字框 / `设置调度` / `设置` 那一行）是**独立**挂在 `root` 上的，大厅里就在。

所以自检时别在大厅里找「调度中心 · 直接设置等级」那一行 —— **先开一局**。
大厅里能验的是这三件（`_build\probe-live-e2e.mjs` ①b 就是这么断的）：

1. 沙盒条渲染完整（`button.spmod-sbbtn` ≥ 3、`.spmod-fab` 在）；
2. 「设置调度」按钮在、有 `title`、旁边有 `input[type=number][min=1][max=6]`（`local.sb.level` 存本机记忆）；
3. **服务端发出去的那份字节**里确实有 `['shopLevel', '调度中心 · 直接设置等级'` 与
   `const SHOPLEVEL = 'g.modShopLevel'`（`fetch('/mod/overlay.js')` 直接读，不受面板状态影响）。
- `L7-gate.patch.json`：房间没有勾选「Luck 测试插件」时，补丁对整局完全惰性（每局 start 时把整进程的 sandbox / 自选位 / 技能与属性 / 调度中心收回到游戏自己的状态，倍速交回游戏，录制不写）。
