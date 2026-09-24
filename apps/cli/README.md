# Chat Lite CLI 命令行交互终端

Chat Lite CLI 是一款面向开发者的现代化终端即时聊天客户端，采用类似 OpenAI Codex / Claude Code 的全屏命令行交互界面，具备极高的响应速度与极低的资源消耗。

---

## 特性亮点

- **全屏交互即时终端**：单命令 `chat-lite` 直达交互终端，打字回车即发，输入行自动原地替换为正式聊天气泡，无多余冗余行。
- **纯正工业质感（0 Emoji）**：界面与日志严格保持纯文本排版，搭配优雅的高对比度 ANSI 色彩高亮。
- **真正的端到端加密（E2EE）**：基于 RSA-OAEP 2048 + AES-256-GCM，私钥绝不出本机。
- **跨客户端密钥智能同步**：首次在命令行登录时，会自动识别并同步本机桌面端已有的身份私钥，完美解决历史加密消息无法查看的问题。
- **老板键 / 伪装掩护模式（`/mask`）**：一秒切换为伪装的 OpenAI Codex 代码生成终端，伪装期间好友发来的消息自动转换为静默后台遥测心跳日志，输入 `exit` 或 `/unmask` 瞬间切回。
- **隐私保护**：终端所有界面默认隐藏服务器真实地址，便于屏幕录制与公开演示。
- **双模支持**：既支持全屏即时交互 REPL，也支持单行脚本模式（方便管道重定向与 CI/CD 自动化通知）。

---

## 安装与环境配置

### 1. 编译构建

要求环境：Node.js 20+，pnpm 9+。

在项目根目录下执行：
```bash
# 安装依赖
pnpm install

# 编译 CLI
pnpm --filter @chat-lite/cli build
```

### 2. 配置全局快捷命令

将编译产物软链接到您的 PATH 路径（例如 `~/.local/bin` 或 `/usr/local/bin`）：

```bash
# 推荐链接至用户本地 bin 目录
ln -sf $(pwd)/apps/cli/dist/index.js ~/.local/bin/chat-lite

# 确保文件具有可执行权限
chmod +x apps/cli/dist/index.js
```

> **提示**：若终端提示 `zsh: command not found: chat-lite`，执行一次 `rehash` 刷新 zsh 缓存，或确保 `~/.local/bin` 已加入环境变量 `export PATH="$HOME/.local/bin:$PATH"`。

---

## 快速使用

### 1. 登录账号

```bash
# 登录远程服务器（支持自动补全 https 协议并自动加载项目内置私有 CA 证书）
chat-lite login --server 101.34.254.65

# 若使用默认本地服务 (http://localhost:3000)，可直接省略 --server：
chat-lite login
```

- 输入用户名与密码即可登录；
- 登录凭据与服务器信息会自动保存在本地配置 `~/.config/chat-lite/config.json` 中，**后续无需再次重复输入服务器地址**。

### 2. 注册新账号（需邀请码）

```bash
chat-lite register --server 101.34.254.65 --invite <邀请码>
```

### 3. 启动交互式聊天终端

登录成功后，在终端任意目录下直接运行：

```bash
chat-lite
```

---

## 交互终端快捷指令（支持 Tab 补全）

在 `chat-lite` 交互终端内，直接打字回车即可发送消息给当前会话。以 `/` 开头的指令支持 **Tab 键自动补全**：

| 指令 | 简写 | 说明 |
| :--- | :--- | :--- |
| `/help` | `/?` | 查看全部快捷指令帮助 |
| `/switch <名称\|ID>` | `/s` | 切换当前聊天会话（支持按会话序号、用户名、群名或 ID 切换；输入 `/s ` 配合 Tab 键可自动补全会话） |
| `/list` | `/ls` | 列出全部会话列表、未读数与最新消息摘要 |
| `/history [条数]` | `/h` | 查看当前会话的历史消息记录（默认加载 20 条） |
| `/open <用户名>` | - | 直接发起或进入与指定用户的私聊 |
| `/group <群名> <成员...>` | - | 快速创建新的加密群聊 |
| `/whoami` | - | 查看当前登录的账号信息与端到端加密状态 |
| `/mask` | `/boss` | **伪装模式**：快速隐藏聊天，模拟为 OpenAI Codex 交互终端 |
| `/unmask` | `/chat` | **解除伪装**：退出伪装模式，恢复即时聊天界面 |
| `/clear` | `/c` | 清屏并重新绘制当前会话与最新消息 |
| `/quit` | `/q` | 断开连接并退出终端 |

---

## 特色功能详解

### 1. 伪装掩护模式（`/mask`）
- 在终端输入 `/mask`：
  - 屏幕瞬间清屏，所有聊天内容、群名和联系人全部隐藏；
  - 替换为 `OpenAI Codex (v0.14.2) [Interactive Shell]` 面板，提示符变为 `codex > `；
  - 在提示符下输入任意文本，系统会模拟 Codex 思考并输出逼真的高质量代码片段（Rust/Python/TypeScript/SQL 等）；
  - 伪装期间若有好友发来消息，终端**绝不显示聊天内容**，仅显示静默遥测日志 `[daemon] background telemetry synced`；
  - 输入 `exit`、`quit` 或 `/unmask` 即可瞬间返回聊天。

### 2. 消息发送原地替换
- 在终端打字发送消息后，CLI 会通过光标行擦除机制直接将刚刚打字的内容原地替换为格式化的正式消息，杜绝终端留下双重重复内容的视觉冗余。

### 3. 单次命令模式（适合脚本调用）

除了交互终端，CLI 还支持一键发送与管道处理：

```bash
# 直接发送消息
chat-lite send weihh "构建任务已完成"

# 管道发送
cat build.log | xargs -0 chat-lite send weihh

# 实时监听新消息并自动标已读
chat-lite watch --read

# 查看历史消息
chat-lite history weihh --limit 50

# 下载并解密图片附件
chat-lite download <会话ID> <消息ID> --out ~/Downloads
```

---

## 本地存储与私钥安全

- **配置与凭据路径**：`~/.config/chat-lite/`
  - `config.json`：服务器地址、当前登录用户信息与根证书路径（权限 `0600`）
  - `secrets.json`：Refresh Token 与本地端到端加密 RSA 私钥（权限 `0600`）
- **环境变量自定义**：
  - `CHAT_LITE_HOME`：自定义配置与私钥存储目录；
  - `CHAT_LITE_API_URL`：覆盖默认服务器地址；
  - `NO_COLOR`：设置后关闭所有终端 ANSI 彩色输出。
