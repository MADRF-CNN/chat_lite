# Chat Lite

一款面向小团队的 macOS 桌面聊天应用，支持邀请码注册、私聊、群聊、未读消息以及图片发送。

生产模式会强制所有 REST、WebSocket 和图片请求使用 TLS（HTTPS/WSS），Nginx 仅开放 TLS 1.2/1.3 并发送 HSTS。在此基础上，新版客户端还会对消息内容和图片执行端到端加密：每个账号的 RSA-OAEP 私钥仅保存在本机（桌面端位于 `~/Library/Application Support/com.chatlite.desktop/secrets`，命令行客户端位于 `~/.config/chat-lite`，目录 0700、文件 0600），会话内容使用 AES-256-GCM 加密，服务器只保存会话密钥信封、密文和必要的路由元数据。

私钥文件只受文件权限保护：同一账号下的其他进程可以读取。需要更强隔离时应改用系统钥匙串或磁盘加密（FileVault）。

首版端到端加密采用单设备模型。更换设备或删除本机密钥文件后无法恢复旧加密消息；新设备会创建新的身份密钥。服务器仍可看到账号、会话成员、发送时间、消息及图片密文大小等元数据。升级前已经发送的明文历史消息仍可读取，但服务器拒绝新版上线后的任何新增明文消息和图片。

会话中的每位成员都必须至少登录一次 0.2.0 或更高版本，以注册自己的加密公钥；在此之前，其他成员无法向该会话发送新的加密消息。

## 技术栈

- Tauri 2、Rust、React、Vite、TypeScript
- NestJS、Socket.IO、Prisma、PostgreSQL
- S3 兼容对象存储（开发/自托管使用 MinIO）

## 本地开发

要求 Node.js 22+、pnpm 10+、Rust stable（建议通过 rustup 安装）和 Docker Desktop。

```bash
cp .env.example .env
cp apps/server/.env.example apps/server/.env
pnpm install
docker compose up -d postgres minio
pnpm db:generate
pnpm db:migrate
pnpm invite:create -- 5 30
pnpm dev
```

最后一条命令会启动 API 和 Tauri 桌面客户端。邀请码命令的参数分别是最大使用次数和有效天数。

## 命令行客户端（CLI）

`apps/cli` 是与桌面端共用同一套服务端和端到端加密协议的终端客户端，适合在服务器或 SSH 会话中收发消息。

```bash
pnpm cli -- help
pnpm cli -- login --server https://chat.example.com
pnpm cli -- register --invite <邀请码>            # 密码省略时交互输入
pnpm cli -- list
pnpm cli -- send <用户名或会话 ID> "你好"
pnpm cli -- watch --read
```

命令包括 `login`、`register`、`logout`、`whoami`、`list`、`search`、`open`、`group`、`send`、`history`、`read`、`download` 和 `watch`，`pnpm cli -- help <命令>` 可查看单个命令用法。会话参数可以是会话 ID（支持前缀）、私聊对方的用户名或群名；`history --ids` 配合 `download` 可把加密图片解密到本地。

由于首版端到端加密是单设备模型，**CLI 请使用独立账号**：服务端每个账号只保存一把身份公钥，CLI 与桌面端登录同一账号会互相覆盖公钥，导致对方无法解密之后轮换的会话密钥。会话密钥由发送方在成员公钥齐备时生成，因此对方需要至少登录过一次 0.2.0 或更高版本客户端（含 CLI）。

登录令牌与身份私钥保存在 `~/.config/chat-lite`（目录 0700、文件 0600），可用 `CHAT_LITE_HOME` 指定其他位置；CLI 不使用 macOS 钥匙串，请确保该目录所在磁盘已加密。`logout` 只清除登录令牌并保留身份私钥（保留账号的加密身份），`logout --forget-identity` 会连同私钥一起删除。

服务器地址依次取自 `--server`、`CHAT_LITE_API_URL` 和上次登录保存的地址。自签证书部署时用 `--ca <证书路径>` 指定根证书，登录成功后会记住该路径，后续命令无需重复传入：

```bash
pnpm cli -- login --server https://<服务器 IP> --ca ./chat-lite-private-ca.crt
```

也可以全局设置 `export NODE_EXTRA_CA_CERTS=./chat-lite-private-ca.crt`（注意 `sudo` 下 Node 会忽略该变量）；使用受信任 CA 签发的域名证书时无需任何额外配置。

## 公网部署

1. 将 `.env.example` 复制为 `.env`，设置两个不少于 32 字符且彼此不同的 JWT 密钥、域名和强数据库/对象存储密码。`CLIENT_ORIGIN` 必须包含 `tauri://localhost`，多个来源以逗号分隔。
2. 将域名证书放到 `infra/certs/fullchain.pem` 和 `infra/certs/privkey.pem`。
3. 执行 `docker compose up -d --build`；API 启动时自动应用数据库迁移。
4. 使用 `pnpm invite:create -- 1 30` 创建邀请码。若只在服务器容器中安装依赖，可执行 `docker compose exec api pnpm --filter @chat-lite/server invite:create -- 1 30`。脚本同时兼容 pnpm 传入的 `--` 分隔符。

公网部署必须保持 `NODE_ENV=production` 与 `ENFORCE_TLS=true`，并将桌面端的两个服务地址配置为 `https://`；WebSocket 会自动升级为 WSS。

### 无域名、使用服务器 IP

无域名部署使用私有 CA 为服务器 IP 签发证书。每台 Mac 必须先信任项目根目录中的 `chat-lite-private-ca.crt`：

```bash
./scripts/install-private-ca-macos.sh
```

该命令需要输入当前 Mac 的管理员密码，并把根证书加入系统钥匙串。只应安装从可信部署者处获得的证书；私有 CA 密钥始终保留在服务器，不应分发。

定期执行 `./scripts/backup.sh /安全的备份目录`，同时备份 PostgreSQL 与 MinIO 数据。恢复前应先停止 API，并分别使用 `pg_restore` 与 MinIO 数据卷恢复。

## 构建 macOS 安装包

将 `apps/desktop/.env.production.example` 复制为 `apps/desktop/.env.production`，把其中的 `VITE_API_URL` 和 `VITE_SOCKET_URL` 设置为公网 HTTPS 地址，然后执行：

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
pnpm --filter @chat-lite/desktop build
```

产物位于 `apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/dmg`，是同时支持 Apple Silicon 与 Intel Mac 的通用 DMG。Tauri 使用系统 WebView，因此安装包远小于 Electron 版本。当前内部测试包未签名、公证；首次安装若被 Gatekeeper 阻止，请在“系统设置 → 隐私与安全性”中确认打开。正式分发前应配置 Apple Developer ID 签名与公证。

## API 概览

- `POST /api/auth/register|login|refresh|logout`
- `GET /api/users/search?q=`
- `GET|POST|PATCH /api/conversations/...`
- `GET|POST /api/conversations/:id/messages`
- `POST|GET /api/attachments/...`

除注册、登录和刷新外均需 `Authorization: Bearer <access token>`。Socket.IO 连接通过 `auth.token` 传递访问令牌。
