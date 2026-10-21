# 在 Linux 上开服（新手版）

这份说明假设你**完全没碰过 Linux**：一台刚买的全新阿里云服务器（Ubuntu 24.04），想把便携包放上去开服，
让朋友用浏览器连进来。照着从上往下做一遍就行，命令都可以直接复制。

> Windows 上双击 `start-windows.bat` 就能开服，不需要看这份；这份只讲 Linux。

---

## 0. 先确认你手里有什么

| 东西 | 从哪来 |
|---|---|
| 服务器公网 IP | 阿里云控制台 → ECS → 实例，形如 `47.100.12.34` |
| `root` 密码（或密钥） | 买机器时设的；忘了可以在控制台「重置实例密码」 |
| 便携包解压后的文件夹 | Releases 里的 `Stronghold-Protocol-v<版本>-Windows.zip`，解压得到 `便携包` 那个目录 |

服务器最低建议 **2 核 2 GB 内存**；1 核 1 GB 能跑起来，但人多或开 3D 特效会吃紧。

---

## 1. 连上服务器

**最简单的办法**：阿里云控制台 → 实例 → 远程连接 → Workbench（网页版终端，不用装任何软件）。
出现黑底白字的命令行，提示符大致是 `root@iZxxxx:~#`，就说明连上了。

想在 Windows 本地连，也可以打开「终端」（Win+X → 终端）：

```sh
ssh root@你的公网IP
```

第一次会问 `Are you sure you want to continue connecting (yes/no)?`，输入 `yes` 回车，再输入密码
（输密码时屏幕**不会**显示任何字符，这是正常的，输完直接回车）。

---

## 2. 装 Node 24

游戏需要 Node 24。Ubuntu 自带源里的版本太旧，用 NodeSource 的安装脚本：

```sh
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
```

装完检查：

```sh
node -v
```

要显示 `v24.x.x`（比 24 小就说明装错了，回到上一步）。`npm -v` 也应该有输出。

---

## 3. 把便携包传上去

在**你自己的 Windows 电脑**上开一个终端，`cd` 到解压出来的目录（里面有 `start-linux.sh` 的那一层），然后：

```sh
scp -r . root@你的公网IP:/opt/stronghold
```

- 会把当前目录整个传到服务器的 `/opt/stronghold`；密码就是第 1 步那个。
- 传 3 GB 左右，视上行带宽要几分钟到几十分钟；中途断了重跑一次即可（会覆盖）。
- 不想用命令行：装个 WinSCP，左边选本地文件夹、右边选 `/opt`，拖过去，再在服务器上把目录改名成 `stronghold`。

传完回到服务器终端，确认文件在：

```sh
ls /opt/stronghold
```

应该能看到 `app`、`start-linux.sh`、`start-windows.bat`、`README-quickstart.md` 等。

> **为什么放 `/opt`**：这是个放第三方程序的常规位置，不会被系统更新动到。也可以放
> `/home/你的用户名/stronghold`，后面所有命令里的路径跟着改就行。

---

## 4. 先在前台跑一次

```sh
cd /opt/stronghold
chmod +x start-linux.sh start-linux-sandbox.sh
./start-linux.sh --port 3000
```

看到类似 `listening on http://0.0.0.0:3000` 就成功了。**这个窗口先别关**，拿手机或另一台电脑的浏览器
打开 `http://你的公网IP:3000`，能进大厅就说明通了。按 `Ctrl+C` 停止。

打不开的话，八成是第 5 步的端口没放行。

---

## 5. 放行 3000 端口（必须做）

阿里云默认把端口全关着，要在**控制台**里放行：

1. 阿里云控制台 → ECS → 实例 → 点进这台机器 → 「安全组」→「配置规则」；
2. 入方向 → 手动添加：协议 `TCP`、端口范围 `3000/3000`、授权对象 `0.0.0.0/0`；
3. 保存。生效通常几秒钟。

服务器自己的防火墙（Ubuntu 默认没开 ufw，开了的话要放行）：

```sh
sudo ufw allow 3000/tcp
```

再试一次 `http://你的公网IP:3000`。

> 想用 80 端口直接访问（不带 `:3000`），把上面的 `--port 80` 和端口规则改成 80 —— 但 80 需要 root，
> 见第 8 步的 Nginx 方案更稳。

---

## 6. 让它一直跑（systemd）

前台窗口一关服务就停了。用 systemd 托管：

```sh
sudo tee /etc/systemd/system/stronghold.service >/dev/null <<'UNIT'
[Unit]
Description=Stronghold Protocol
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/stronghold
ExecStart=/opt/stronghold/start-linux.sh --no-open --port 3000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now stronghold
sudo systemctl status stronghold --no-pager
```

`active (running)` 就成了。看日志（出问题时最有用的东西）：

```sh
journalctl -u stronghold -f
```

`Ctrl+C` 只是退出日志，不会停服务。开机自启已经由 `enable` 办好。

常用命令：

```sh
sudo systemctl restart stronghold   # 重启（改了配置/更新后）
sudo systemctl stop stronghold      # 停止
sudo systemctl disable --now stronghold  # 取消开机自启并停止
```

---

## 7. 以后怎么更新

```sh
sudo systemctl stop stronghold
# 用第 3 步的办法把新包传到 /opt/stronghold（覆盖 app/、data/ 等，保留你自己的 packs/、plugins/、state/）
sudo systemctl start stronghold
```

更稳妥的做法：本地解压新包到 `stronghold-new`，传成 `/opt/stronghold-new`，然后把
`/opt/stronghold/state`（存档/头像/昵称）和 `packs/`、`plugins/` 拷过去，再改 systemd 的
`WorkingDirectory`/`ExecStart` 指向新目录，重启。旧目录留着，出问题能立刻切回去。

---

## 8. 可选：Nginx + 域名 + HTTPS

想要 `https://game.你的域名.com` 这种地址：

```sh
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

`/etc/nginx/sites-available/stronghold`：

```nginx
server {
  listen 80;
  server_name game.example.com;
  client_max_body_size 20m;          # 头像/素材导入要传图

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;      # WebSocket
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 1h;                        # 长连接别被掐
  }
}
```

```sh
sudo ln -s /etc/nginx/sites-available/stronghold /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d game.example.com      # 自动配 HTTPS 证书
```

同时把 systemd 里的 `--port 3000` 保持不动（只让本机 Nginx 访问），安全组**只放行 80/443**、关掉 3000。

---

## 9. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 浏览器打不开、一直在转 | 安全组没放行端口；或服务没起（`systemctl status stronghold`） |
| `node: command not found` | 第 2 步没做完，或没重开终端 |
| `Permission denied` 跑 `.sh` | `chmod +x start-linux.sh start-linux-sandbox.sh` |
| `EADDRINUSE` | 3000 被占了：`sudo ss -lptn 'sport = :3000'` 查进程，或换 `--port 3001` |
| `EACCES` 写不进 `state/` | 目录权限不对：`sudo chown -R root:root /opt/stronghold`（或你的运行用户） |
| 页面 404 / 样式全丢 | 传的时候漏了 `app/public`；重新完整传一遍 |
| 中文变成乱码 | 不需要额外设置；页面编码固定 UTF-8。终端里的中文乱码只是终端 locale，不影响游戏 |
| 磁盘满了 | `df -h`；素材+依赖约 3 GB，系统盘至少留 10 GB |
| 人多就卡或掉线 | 内存不足（看 `free -h`）或带宽不够；关掉「官方特效」降低客户端压力 |

> ⚠️ Linux **区分大小写**：`Start-Linux.sh` 和 `start-linux.sh` 是两个不同的文件。不要手动改包内文件名的大小写。

---

## 10. 几个提醒

- 服务默认没有账号系统：**谁能访问 IP 谁就能进大厅**。只给朋友玩的话，端口别公开宣传；要限制可用安全组只放行朋友 IP，或加 Nginx 的 `allow/deny`。
- 存档、昵称、上传的头像都在 `state/`（`state/avatars/` 是头像图片）；换机器时把 `state/` 一起带走。
- Luck 调试插件默认**不启动**；玩正式对局不用管它。
- 素材版权：本包是非官方同人作品，**严禁盈利**，详见包内 `NOTICE.md`。
