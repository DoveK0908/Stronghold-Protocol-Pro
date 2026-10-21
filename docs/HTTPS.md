# 让服务器有 https（免费隧道 / 自己的域名）

浏览器只在**安全上下文**（`https://…` 或 `http://localhost`）里给 Service Worker、Cache Storage、
`crypto.subtle`。所以用 `http://公网IP:3000` 打开时，「导入素材包」会提示不可用——那不是 bug，是浏览器规则。
这份文档给它补一条 https 的路子。

> 不导入素材包也能正常玩，只是素材从你的服务器下载（`/assets/…` 已带一年强缓存）。
> 如果你只是想让朋友别吃流量，看最后一节「Cloudflare 代理整站」更划算。

---

## 1. 免费隧道（cloudflared quick tunnel，5 分钟，不要域名、不要备案）

原理：本机跑一个小客户端，把 `127.0.0.1:3000` 反向连到 Cloudflare 边缘，它回你一个
`https://随机单词.trycloudflare.com` 的域名。玩家拿到的是 https，安全上下文成立。

### 1.1 装 cloudflared（Windows）

```powershell
winget install --id Cloudflare.cloudflared
```

装完**重开一个终端**（让 PATH 生效），检查：

```powershell
cloudflared --version
```

不想用 winget：从 <https://github.com/cloudflare/cloudflared/releases> 下 `cloudflared-windows-amd64.exe`，
改名 `cloudflared.exe` 放到 `C:\cloudflared\`，然后把这个目录加进 PATH（或用完整路径运行）。

### 1.2 启动顺序

1. 先开游戏服务器（双击 `start-pro-luck.cmd`，或 `start-windows.bat`，默认 3000 端口）；
2. 另开一个终端，跑：

```powershell
cloudflared tunnel --url http://127.0.0.1:3000
```

终端里会出现类似：

```
+--------------------------------------------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
|  https://random-three-words-here.trycloudflare.com                                         |
+--------------------------------------------------------------------------------------------+
```

把这个 `https://…trycloudflare.com` 发给朋友就是游戏地址。

### 1.3 确认生效

浏览器打开那个 https 地址 → 标题画面「导入素材包」不再是灰的，弹窗里能看到选择文件夹 / zip。
也可以按 F12 → Console 里 `isSecureContext` 应为 `true`。

### 1.4 注意

- **每次重启 cloudflared，域名都会变**；要让朋友一直用同一个地址，看第 2 节。
- 流量绕 Cloudflare，国内访问可能偏慢、偶尔断；WebSocket 走隧道是通的（游戏里会自己重连）。
- 快速隧道没有可用性承诺，别拿它跑公开大服；熟人小圈子够用。
- 只开一个隧道实例即可，多个实例各占一个随机域名。

### 1.5 和游戏一起启动（可选）

新建 `start-with-tunnel.cmd`（放在便携包根目录旁边）：

```bat
@echo off
cd /d "%~dp0"
start "" "%~dp0start-windows.bat" --no-open --port 3000
timeout /t 8 >nul
cloudflared tunnel --url http://127.0.0.1:3000
```

双击它：先起服务器，等 8 秒，再起隧道。关掉两个窗口就都停了。

---

## 2. 固定域名（named tunnel，需要 Cloudflare 账号）

需要：一个域名（托管到 Cloudflare 加站点即可，不用备案）、Cloudflare 账号。

```powershell
cloudflared tunnel login                       # 浏览器里授权一次，选你的域名
cloudflared tunnel create stronghold           # 生成 tunnel 凭证，记下 ID
cloudflared tunnel route dns stronghold game.你的域名.com
```

`%USERPROFILE%\.cloudflared\config.yml`：

```yaml
tunnel: <上一步的 tunnel ID>
credentials-file: C:\Users\<你>\.cloudflared\<tunnel ID>.json
ingress:
  - hostname: game.你的域名.com
    service: http://127.0.0.1:3000
  - service: http_status:404
```

```powershell
cloudflared tunnel run stronghold               # 先手动验证
cloudflared service install                     # 装成服务，开机自启（读上面那份 config.yml）
```

之后 `https://game.你的域名.com` 长期有效。玩家那边同样不需要装任何东西。

---

## 2b. 服务器是 Linux 时最简单的一条：面板建 tunnel，复制 token

不想在服务器上敲 `login` / `create` / 写 `config.yml`，就在 Cloudflare 后台点：

1. 打开 <https://one.dash.cloudflare.com/> → Networks → Tunnels → **Create a tunnel** → 选 **Cloudflared**；
2. 起个名字（如 `stronghold`），保存后页面会给一段**带 token 的安装命令**，形如：

   ```sh
   sudo cloudflared service install eyJhIjoi...（一长串）
   ```

3. 把这段**原样**在 Ubuntu 服务器上执行：它会装好 `cloudflared` 服务并开机自启；
4. 回到面板同一页 → **Public Hostname** → Add：

   | 字段 | 填什么 |
   |---|---|
   | Subdomain | `game` |
   | Domain | 你的域名 |
   | Service · Type | `HTTP` |
   | Service · URL | `127.0.0.1:3000` |

保存后 `https://game.你的域名.com` 立刻可用，**域名固定**、不用改任何配置文件。
以后换服务器只要在面板把这台机器重新加入 tunnel，地址不变。

确认：

```sh
sudo systemctl status cloudflared --no-pager     # active (running)
curl -I https://game.你的域名.com                 # 200
```

## 3. Linux 服务器上跑隧道

```sh
# Debian / Ubuntu
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared

# 快速隧道（前台试跑）
cloudflared tunnel --url http://127.0.0.1:3000

# 固定域名的服务（在 Cloudflare 后台建 tunnel 后拿到 token）
sudo cloudflared service install <TOKEN>
sudo systemctl status cloudflared --no-pager
```

游戏本体继续用 systemd 跑（见 [LINUX.md](LINUX.md)），隧道只是套在外面。
套上隧道后建议把游戏只绑本机、并从安全组里**删掉 3000**：

```ini
# /etc/systemd/system/stronghold.service 的 [Service] 段
Environment=PORT=3000 HOST=127.0.0.1
```

这样公网只能经 Cloudflare 进来（隧道是服务器主动外连，不需要放行任何入站端口）。

---

## 4. 为什么不用「自签名证书」

自己 `openssl` 签的证书，浏览器默认**不信任**：页面会拦一次警告，而且被当成不可信来源，
Service Worker / Cache Storage 依然不可用——所以导入素材包还是不能点。自签只适合临时直连，
不适合发给朋友。

## 5. 想省流量：Cloudflare 代理整站（比导入素材包更彻底）

域名加进 Cloudflare，DNS 记录指向服务器 IP 并**开橙色云**，源站继续监听 3000：

- 玩家访问 `https://game.你的域名.com`，Cloudflare 终止 TLS、回源 http；
- 在 Cloudflare → Caching → Cache Rules 里给 `/assets/*` 加一条「Eligible for cache / Edge TTL 一年」，
  素材从此由 Cloudflare 缓存，**服务器只出一次流量**；
- 别忘了 SSL/TLS 模式选 Full（源站 http 就用 Full，别用 Flexible）。

这条对**所有玩家**生效，不用每人导入 2.7 GB，适合"朋友比较多、流量吃紧"的情况。
