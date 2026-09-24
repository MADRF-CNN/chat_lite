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

`apps/cli` 是与桌面端共用同一套服务端和端到端加密协议的终端客户端。支持**类似 Codex 的全屏即时交互聊天终端（REPL）**，同时也支持单命令脚本调用。

详细安装与使用文档请参见 [CLI 使用指南](apps/cli/README.md)。

### 交互终端模式（推荐）

```bash
# 1. 登录服务器（可直接填 IP，自动补全 HTTPS 并加载私有 CA）
chat-lite login --server 101.34.254.65

# 2. 启动全屏即时交互聊天终端
chat-lite
```

在交互终端中打字回车即发，支持 Tab 补全的快捷斜杠指令：
- `/switch <名称|ID>` 或 `/s`：快速切换会话
- `/list` 或 `/ls`：查看会话列表与未读数
- `/history [条数]` 或 `/h`：翻阅历史加密消息
- `/mask` 或 `/boss`：**伪装模式**，一键隐藏聊天并模拟为 OpenAI Codex 代码终端，收到新消息自动转为静默遥测日志；输入 `exit` 或 `/unmask` 恢复
- `/clear` 或 `/c`：清屏并重绘会话
- `/quit` 或 `/q`：退出终端

### 单命令与脚本模式

```bash
chat-lite list
chat-lite send <用户名或会话 ID> "你好"
chat-lite watch --read
chat-lite history <用户名或会话 ID> --limit 50
```

### 端到端加密与密钥

- **跨客户端智能密钥同步**：首次在 macOS 终端登录与桌面端相同的账号时，CLI 会自动识别并同步本机桌面端已有的身份私钥（位于 `~/Library/Application Support/com.chatlite.desktop/secrets`），无需手动复制密钥，两者无缝共用同一加密身份。
- 若在未安装桌面端的纯服务器/SSH 机器上使用，CLI 会自动生成独立的端到端身份密钥。
- 登录凭据与私钥保存在 `~/.config/chat-lite`（目录 0700、文件 0600），可通过环境变量 `CHAT_LITE_HOME` 自定义目录。
- 自签证书部署支持自动从根目录或 `--ca <证书路径>` 导入信任，登录成功后会自动记忆配置。

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
