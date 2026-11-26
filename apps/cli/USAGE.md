# Chat Lite CLI 使用手册（macOS & Windows）

Chat Lite CLI 是一款轻量、高速的终端即时聊天客户端，与 Chat Lite 桌面端共用同一套服务端和端到端加密（E2EE）协议。它提供类似 Codex / Claude Code 的全屏即时交互终端，也支持单行命令与脚本调用。

本分发包为**轻量级开箱即用版本**：复用本机已有的 **Node.js 20+** 环境（兼容 Node 20 / 22 / 24），包内已预装对应平台的全部依赖与服务器私有 CA 证书，**无需执行 `npm install`**，解压即可使用。

---

## 目录

1. [特性一览](#1-特性一览)
2. [安装与卸载](#2-安装与卸载)
   - [macOS 安装指南（Apple Silicon & Intel 通用）](#21-macos-安装指南apple-silicon--intel-通用)
   - [Windows 安装指南（64 位 Windows 10 / 11）](#22-windows-安装指南64-位-windows-10--11)
3. [快速上手（3 步开始聊天）](#3-快速上手3-步开始聊天)
4. [交互式聊天终端（REPL）指南](#4-交互式聊天终端repl指南)
5. [终端发图与看图全攻略](#5-终端发图与看图全攻略)
6. [老板键 / 伪装掩护模式](#6-老板键--伪装掩护模式)
7. [单命令与脚本自动化模式](#7-单命令与脚本自动化模式)
8. [端到端加密、证书与本地存储](#8-端到端加密证书与本地存储)
9. [环境变量参考](#9-环境变量参考)
10. [常见问题排查（FAQ）](#10-常见问题排查faq)

---

## 1. 特性一览

- **轻量免安装依赖**：直接复用本机 Node.js 20+（无需 `npm install`、不挑网络与镜像源），已预装对应平台 `sharp` 原生图像模块与私有 CA 证书；macOS 版同时兼容 Apple Silicon（M1–M4）与 Intel Mac，Windows 版支持 64 位 Windows 10/11。
- **全屏即时交互终端**：运行 `chat-lite` 即可直达聊天终端，输入文字回车即发，实时推送新消息，输入行自动原地替换为格式化消息，不产生重复残影。
- **端到端加密（E2EE）**：消息文本与图片附件均采用 RSA-OAEP 2048 + AES-256-GCM 端到端加密，私钥仅保存在本机。
- **与桌面端自动同步私钥**：同一台电脑上若已登录过 Chat Lite 桌面端，CLI 首次登录时会自动识别并同步桌面端身份私钥，无需手动拷贝，历史加密消息直接可读。
- **终端内发图与高清看图**：支持剪贴板贴图、拖入/粘贴图片路径直接发送，支持 Ghostty / Kitty / WezTerm 原生高清内联、iTerm2 内联、Windows Terminal 真彩色字符画以及系统预览器放大。
- **8-bit 彩色像素表情**：内置 12 款透明抠底真彩色像素贴纸，`:doge` / `:ok` / `:6` 一键极速发送，支持 `Tab` 补全与 `/e` 面板预览。
- **引用回复、群聊 `@` 高亮与 `/more` 翻页**：支持 `>编号` / `/r` 端到端加密引用回复、群聊 `@成员` `Tab` 补全与 `@你` 强提醒高亮、以及 `/more` 连续往前翻阅更早历史消息。
- **老板键伪装模式**：连按两次 `Esc` 或按 `Ctrl+B`（或敲 `m` 回车），瞬间清屏并销毁内联图片和外部预览窗口，切换为逼真的 OpenAI Codex 代码交互终端。
- **双模式支持**：既可作为日常交互聊天终端，也支持单命令脚本调用、管道输入和后台消息监听。

---

## 2. 安装与卸载

> **前置要求**：本机已安装 **Node.js 20 或更高版本**（终端执行 `node -v` 确认；支持 nvm / fnm / Volta / Homebrew 等任意方式管理的 Node）。

### 2.1 macOS 安装指南（Apple Silicon & Intel 通用）

获取压缩包：`chat-lite-cli-macos-v0.1.2.zip`

#### 方式一：一键全局安装（推荐）

解压压缩包后，打开终端进入解压目录并执行安装脚本：

```bash
cd ~/Downloads/chat-lite-cli-macos
./install.sh
```

安装脚本会自动完成以下操作：
1. 清除 macOS 下载文件的隔离属性（`com.apple.quarantine`），避免 Gatekeeper 拦截；
2. 将程序与内置 CA 证书安装到 `~/.local/share/chat-lite-cli`；
3. 创建全局命令软链接 `~/.local/bin/chat-lite`；
4. 若 `~/.local/bin` 不在 `PATH` 中，自动追加到 `~/.zshrc`（或 `~/.bash_profile`）。

安装完成后，**重新打开终端**（或执行 `source ~/.zshrc && rehash`），然后验证：

```bash
chat-lite --version
```

#### 方式二：免安装绿色运行

若不想写入系统路径，直接在解压目录中运行即可：

```bash
# 首次运行若被 macOS 拦截，先解除隔离属性：
xattr -dr com.apple.quarantine .

# 直接启动或查看帮助
./chat-lite --help
```

#### macOS 卸载

在解压目录或安装目录中执行：

```bash
~/.local/share/chat-lite-cli/uninstall.sh
```

> 默认**保留**您的登录配置与端到端私钥（`~/.config/chat-lite`），重新安装后仍可解密历史消息。如需彻底清除所有数据，可追加 `--purge` 参数。

---

### 2.2 Windows 安装指南（64 位 Windows 10 / 11）

获取压缩包：`chat-lite-cli-windows-x64-v0.1.2.zip`

> **终端推荐**：强烈建议使用 **Windows Terminal**（Windows 11 已自带，Windows 10 可在 Microsoft Store 免费安装）搭配 PowerShell，或使用 **WezTerm**（支持高清内联看图）。请尽量避免使用老旧的默认 CMD 窗口，以获得最佳的中文显示、ANSI 色彩与图片渲染体验。

#### 方式一：一键全局安装（推荐，无需管理员权限）

1. 将压缩包完整解压到一个文件夹（不要直接在压缩包预览窗口里双击运行）；
2. **双击 `install.bat`**（或在 PowerShell 中进入解压目录运行 `.\install.ps1`）；
3. 脚本会自动将程序安装到 `%LOCALAPPDATA%\chat-lite-cli`，并将该路径加入当前用户的 `PATH` 环境变量；
4. **重新打开一个 Windows Terminal / PowerShell 窗口**，验证安装：

```powershell
chat-lite --version
```

#### 方式二：免安装绿色运行

进入解压后的目录，直接运行：

```powershell
# PowerShell 或 CMD
.\chat-lite.cmd --help
```

#### Windows 卸载

双击 `%LOCALAPPDATA%\chat-lite-cli\uninstall.bat`（或在 PowerShell 运行 `uninstall.ps1`），会自动清理程序目录并从用户 `PATH` 中移除，默认保留聊天配置与私钥。如需同时删除配置与私钥，可运行 `uninstall.ps1 -Purge`。

---

## 3. 快速上手（3 步开始聊天）

### 第 1 步：登录（或使用邀请码注册）

#### 已有账号直接登录

```bash
# 将 <服务器地址> 替换为管理员提供的域名或 IP（例如 101.34.254.65）
# 填 IP 时会自动补全 https://，并自动加载随包附带的私有 CA 证书
chat-lite login --server <服务器地址>
```

按提示依次输入用户名和密码即可完成登录（密码输入时显示为 `*`）。

> **提示**：登录成功后，服务器地址、登录状态和证书路径会自动保存到本地配置中，**以后再启动无需重复输入 `--server` 和 `--ca`**。

#### 新用户凭邀请码注册

```bash
chat-lite register --server <服务器地址> --invite <邀请码>
```

按提示输入用户名（3–32 位）、显示名称和密码（8–128 位）即可完成注册并自动登录。

### 第 2 步：启动全屏交互式聊天终端

在终端任意目录下直接运行：

```bash
chat-lite
```

如果想一启动就处于“代码终端伪装”状态，可以加上 `-m` 参数：

```bash
chat-lite -m
```

### 第 3 步：开始聊天

- 进入后默认选中最近活跃的会话，**直接打字按回车即可发送加密消息**；
- 如果还没有任何会话，输入 `/open <对方用户名>` 发起私聊，或输入 `/group <群名> <成员1> <成员2>` 创建群聊；
- 输入 `/help` 可随时查看全部快捷指令。

---

## 4. 交互式聊天终端（REPL）指南

在 `chat-lite` 交互终端中，以 `/` 开头的指令均支持 **`Tab` 键自动补全**（包括指令名、`/s` 后的会话名、`/img`/`/view`/`/save` 后的图片编号，以及 `/autoimg on|off`）。

### 全部快捷指令速查表

| 指令 | 简写 | 功能说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `/help` | `/?` | 查看全部快捷指令与发图方式 | `/help` |
| `/list` | `/ls` | 列出所有会话、序号、未读数与最新摘要 | `/ls` |
| `/switch <目标>` | `/s` | 切换当前会话（支持序号、用户名、群名、会话 ID 前缀） | `/s 2`、`/s alice` |
| `/history [条数]` | `/h` | 加载当前会话的最近历史消息（默认 20 条，支持跨页拉取至多 500 条） | `/h 50`、`/h 200` |
| `/more [条数]` | `/mo`、`/prev` | 继续往前翻一页更早的历史消息（默认每次 20 条，自动编号支持引用与看图） | `/more`、`/mo 50` |
| `/reply [编号] [内容]` | `/r`、`/quote` | 引用指定 `#编号` 消息回复（省略编号默认引用对方最新消息；不带内容进入待引用状态） | `/r 3 收到`、`/r 3 :ok` |
| `/emo [名称\|编号] [字]` | `/e`、`/art` | 预览 8-bit 彩色像素表情图鉴，或发送像素表情（更推荐直接打 `:表情名`） | `/e`、`/e doge 摸鱼中` |
| `/open <用户名>` | - | 发起或进入与指定用户的私聊 | `/open alice` |
| `/group <群名> <成员...>` | - | 创建新群聊并邀请多名成员 | `/group 项目组 alice bob` |
| `/img [编号] [选项]` | `/i` | 在终端内联看图（默认最新一张；支持 `ls`、`--open`、`--thumb`、`--ascii`） | `/i`、`/i 2`、`/i ls` |
| `/view [编号]` | `/v` | 调用系统预览器无损放大原图（macOS QuickLook / Windows 照片） | `/v`、`/v 1` |
| `/pic <路径> [文字]` | `/sendimg` | 发送指定路径的图片，可同时附带文字说明 | `/pic ~/a.png 看下这里` |
| `/paste [文字]` | `/p` | 读取系统剪贴板中的截图/图片直接发送，可附带文字 | `/p 报错截图` |
| `/save [编号] [目录]` | - | 将指定图片解密并保存到本地目录（默认最新一张、当前目录） | `/save 1 ~/Downloads` |
| `/autoimg [on\|off]` | - | 开启或关闭收到新图片时自动内联预览缩略图 | `/autoimg on` |
| `/whoami` | - | 查看当前登录账号、加密状态与当前终端看图协议 | `/whoami` |
| `/mask` | `/mk`、`/m`、`/boss` | 瞬间进入 Codex 伪装模式（也可直接敲 `m` 回车或按快捷键） | `/m` |
| `/unmask` | `/umk`、`/um`、`/chat` | 退出伪装模式，恢复聊天界面 | `/um` |
| `/clear` | `/c` | 清屏并重新绘制当前会话与最近消息 | `/c` |
| `/quit` | `/exit`、`/q` | 清理临时预览、断开连接并退出终端 | `/q` |

### 高效聊天快捷玩法

#### 1. 极速发送 8-bit 彩色像素表情（`:表情`）
- 输入 **`/e`** 可查看全部 12 款 8-bit 像素贴纸（`smile`、`laugh`、`cry`、`angry`、`sweat`、`ok`、`heart`、`fire`、`coffee`、`doge`、`cat`、`rocket`）；
- 发送无需敲斜杠，直接在输入框以 **`:`** 开头即可极速发送（输入 `:` 按 **`Tab`** 自动补全）：
  - `:doge`、`:ok`、`:6 收到`、`:fire 线上炸了`、`:狗头 摸鱼中`。

#### 2. 引用消息回复（`>编号` / `/r`）
当前会话加载的每条消息前会自动分配编号 `#1`、`#2`、`#3`…（含 `/more` 翻出来的历史消息）：
- **极速一行引用**：直接输入 `>3 好的我马上看`，或搭配像素表情 `>3 :ok`；
- **待引用模式（支持配图/截图）**：只输入 `>3` 或 `/r 3`（不带文字）回车，提示符会变为 `[群名] [引用 #3 Alice] > `，之后可打字、按 `Ctrl+V` 贴截图、拖入图片或发 `:表情` 一起回复；**空行按 `Backspace` 可取消引用**；
- **快捷引用最新消息**：输入 `/r 没问题`（省略编号）自动引用对方发来的最新一条消息。

#### 3. 群聊 `@` 提及与强提醒
- 在群聊中打 `@`（如 `请 @a`）按 **`Tab`** 可自动补全群内成员名及 `@all`；
- 消息里 **`@到你`**（你的用户名/显示名）或 **`@all` / `@所有人`** 会以**亮黄底黑字**高亮，并在行首显示醒目红底 **`@你`** 徽章与提示音（伪装模式下绝对静默）；`@其他成员` 以亮青色高亮；
- 停留在其他会话时，若后台群聊有人 `@` 你，会弹出专属的 `@你` 高亮提醒并附带 `/s <短ID>` 一键切换指令。

#### 4. `/more` 历史向前翻页
- 进入或切换会话默认加载最近 10 条消息，若上方还有更早消息会提示输入 `/more`；
- 每次输入 **`/more`**（简写 `/mo`）自动利用游标继续往前翻 20 条（或 `/more 50`），翻出的老消息同样支持引用和 `/i` 看图。

### 使用小贴士

- **跨会话新消息提醒**：当非当前活跃会话收到消息时，终端会输出高亮提示（含会话短 ID），直接输入 `/s <短ID>` 即可一键切过去。
- **字数与附件上限**：单条消息文本最长 4000 字符；单条消息最多附带 10 张图片，单张图片上限 10MB。
- **自动已读**：切换会话加载历史或停留在当前会话收到新消息时，系统会自动同步已读状态。

---

## 5. 终端发图与看图全攻略

### 5.1 三种发图方式

#### 方式 A：剪贴板截图直接发（最快）

- **macOS**：
  1. 截屏到剪贴板（系统快捷键 `Cmd+Ctrl+Shift+4`）或复制任意图片；
  2. 在聊天输入框按 **`Ctrl+V`**，图片会进入待发区（提示符显示 `[待发 1 图]`）；
  3. 可继续连按 `Ctrl+V` 追加多张图片，也可直接输入附带文字说明；若贴错了，**空行按 `Backspace`** 可撤销最后一张；
  4. 按 **回车** 即可加密发送（也可以直接输入 `/p 附带文字` 一步发送）。
- **Windows**：
  1. 截屏到剪贴板（系统快捷键 `Win+Shift+S`）或复制任意图片/图片文件；
  2. 在聊天输入框输入 **`/p`**（或 `/p 这里报错了`）回车即可直接发送剪贴板图片。
  > **说明**：Windows Terminal 默认把 `Ctrl+V` 劫持为“粘贴纯文本”，因此推荐直接用 `/p` 或 `/paste`。如果你在 Windows Terminal 设置中取消了 `Ctrl+V` 绑定，同样可以直接按 `Ctrl+V` 贴图。

#### 方式 B：拖入或粘贴图片文件路径（最自然）

直接把本地图片文件从 Finder（macOS）或资源管理器（Windows）**拖入终端窗口**，或直接粘贴图片路径，支持在**同一行**写上说明文字，回车即可自动识别并发送：

```text
# macOS 示例（支持 Ghostty/iTerm2 拖入的转义空格路径与引号路径）
'/Users/alice/Desktop/Screen Shot.png' 帮我看下这个界面

# Windows 示例（支持带盘符路径与双引号路径）
"C:\Users\alice\Desktop\Screen Shot.png" 帮我看下这个报错
```

> 支持 PNG、JPEG、WebP、GIF 等格式；macOS 的 TIFF / HEIC 或 BMP 等格式会自动转换为 PNG 后加密上传，并自动生成加密缩略图。

#### 方式 C：显式命令发图

```text
/pic ~/Desktop/demo.png 这是新版设计稿
```

---

### 5.2 终端内联看图与系统放大预览

聊天记录中的每张图片都会自动分配一个递增编号，例如：`[图片 #1 screenshot.png 240.5KB]`。

- **终端内联查看**：
  - `/i` 或 `/img`：查看当前会话最新一张图片；
  - `/i 2`：查看编号 `#2` 的图片；
  - `/i ls`：列出当前会话已加载的所有图片及编号、尺寸、大小；
  - `/i 2 --thumb`：仅加载缩略图（速度更快）；
  - `/i 2 --ascii`：强制以 24-bit 真彩色半块字符画模式显示。
- **系统无损放大查看**：
  - `/v` 或 `/view [编号]`（等价于 `/i [编号] --open`）：
    - **macOS**：调用系统 **QuickLook** 悬浮预览，按空格或 `Esc` 关闭；
    - **Windows**：调用系统默认图片查看器打开。
  - 所有预览临时文件均为受限权限临时文件，**触发老板键伪装或退出程序时会自动销毁**。
- **自动预览模式**：输入 `/autoimg on`，收到新图片时会自动在终端内联渲染缩略图。
- **保存原图到本地**：输入 `/save 1 ~/Downloads` 将图片 `#1` 解密后保存到指定目录。

### 5.3 各终端看图协议支持对照

| 终端软件 | 支持平台 | 自动使用的协议 | 显示效果 |
| :--- | :--- | :--- | :--- |
| **Ghostty / Kitty / WezTerm** | macOS / Windows (WezTerm) | Kitty 图形协议 | 原生高清像素内联，零明文落盘，支持伪装一键清图 |
| **iTerm2 / Warp / VS Code / Tabby / Hyper** | macOS / Windows | iTerm2 协议（OSC 1337） | 原生高清内联 |
| **Windows Terminal / macOS Terminal.app** | Windows / macOS | 24-bit 真彩色半块字符画 | 无需额外配置即可直接内联预览，高清可搭配 `/v` |

> 可通过环境变量 `CHAT_LITE_IMAGE_PROTOCOL` 手动覆盖（可选值：`kitty`、`iterm2`、`halfblock`、`none`）。

---

## 6. 老板键 / 伪装掩护模式

### 如何瞬间开启伪装

以下任意一种方式均可 0 延迟瞬间触发（即使输入框里打了一半字也会自动清空）：

1. **快速连按两次 `Esc`**（双击防误触，0ms 响应）；
2. **按快捷键 `Ctrl+B`**；
3. 输入单字母 **`m`**（或 `mk`、`mask`、`boss`、`/m`、`/mask`）并回车；
4. 启动时直接带参数：`chat-lite -m`。

### 伪装期间会发生什么

- 硬件级清空当前终端屏幕与回滚历史缓冲区，向上滚动也看不到任何聊天记录；
- 自动发送 Kitty 清图指令销毁内联图片，关闭正在显示的 QuickLook 窗口，并清除本地临时预览文件与内存图片缓存；
- 屏幕切换为 `OpenAI Codex (v0.14.2) [Interactive Shell]` 界面，提示符变为 `codex > `；
- 在 `codex > ` 下输入任何文字，都会模拟 Codex 思考并输出逼真的 TypeScript / Python / Rust / SQL 代码片段；
- 伪装期间如果好友发来新消息，**绝不显示聊天内容与发送者**，只会静默输出一行后台日志：
  `[daemon] background telemetry synced (1 items)`。

### 如何解除伪装恢复聊天

以下任意一种方式即可无缝切回聊天界面，并汇总提示掩护期间收到的未读消息条数：

- 再次 **连按两次 `Esc`**；
- 再次按 **`Ctrl+B`**；
- 输入 `exit`、`quit`、`q`、`unmask`、`/um` 或 `:q` 并回车。

---

## 7. 单命令与脚本自动化模式

除交互终端外，Chat Lite CLI 同样支持单次命令执行，非常适合配合 shell 脚本、定时任务或构建告警使用。

### 账号与会话管理

```bash
# 登录 / 注册 / 退出
chat-lite login --server 101.34.254.65 --username alice
chat-lite register --server 101.34.254.65 --invite <邀请码> --username bob --display-name "Bob"
chat-lite logout                      # 退出登录（默认保留本机身份私钥）
chat-lite logout --forget-identity    # 退出并删除本机身份私钥（谨慎使用！）
chat-lite whoami                      # 查看当前账号与身份密钥指纹

# 搜索用户与管理会话
chat-lite list                        # 查看全部会话、未读数和最后一条消息
chat-lite search ali                  # 按用户名或显示名搜索用户（至少 2 个字符）
chat-lite open alice                  # 发起或打开与 alice 的私聊
chat-lite group "研发群" alice bob     # 创建群聊
```

### 消息收发、历史与附件下载

```bash
# 发送纯文本消息（<会话> 支持用户名、群名或会话 ID 前缀）
chat-lite send alice "构建已完成，准备发布"

# 发送本地图片（可多次指定 --image，最多 10 张）或剪贴板截图
chat-lite send alice "看下这两张截图" --image ./a.png --image ./b.png
chat-lite send alice --paste "刚截的图"

# 查看并解密历史消息
chat-lite history alice --limit 50    # 查看最近 50 条
chat-lite history alice --all         # 拉取最多最近 2000 条
chat-lite history alice --ids         # 显示每条消息的短 ID（供下载附件用）
chat-lite history alice --read        # 查看后自动标记已读

# 标记已读
chat-lite read alice

# 下载并解密指定消息的图片附件（消息 ID 可通过 history --ids 获取）
chat-lite download alice <消息ID> --out ./downloads

# 持续监听实时消息（Ctrl+C 退出，加 --read 自动标已读）
chat-lite watch --read

# 查看命令帮助或版本
chat-lite help
chat-lite help send
chat-lite --version
```

---

## 8. 端到端加密、证书与本地存储

### 8.1 私有 CA 证书说明

- 若团队服务器采用无域名 IP 部署（自签私有 CA），本分发包根目录已内置 `chat-lite-private-ca.crt`；
- CLI 启动时会自动探测并加载该证书，并在首次登录成功后记住证书路径，**一般无需额外操作**；
- 如需手动指定其他证书，可在命令中加 `--ca <证书路径>`，或设置环境变量 `NODE_EXTRA_CA_CERTS`；
- 如果您同时使用桌面端或浏览器访问同一服务器，需要让系统全局信任该私有 CA：
  - **macOS**：在安装包目录运行 `./install-private-ca.sh`（需输入本机管理员密码）；
  - **Windows**：双击运行 `install-private-ca.bat`（安装到当前用户的“受信任的根证书颁发机构”，弹窗点“是”确认即可）。

### 8.2 本地配置文件与私钥位置

| 系统 | 配置目录 | 说明 |
| :--- | :--- | :--- |
| **macOS** | `~/.config/chat-lite/` | 目录权限 `0700`，文件权限 `0600` |
| **Windows** | `C:\Users\<用户名>\.config\chat-lite\` | 包含 `config.json` 与 `secrets.json` |

目录内文件说明：
- `config.json`：记录服务器地址、当前登录用户信息与私有 CA 证书路径；
- `secrets.json`：保存登录刷新令牌（Refresh Token）与本机端到端加密 RSA 私钥。

### 8.3 与桌面端跨客户端密钥同步

如果同一台电脑上已经安装并登录过 Chat Lite 桌面端：
- **macOS** 会自动读取 `~/Library/Application Support/com.chatlite.desktop/secrets/`
- **Windows** 会自动读取 `%APPDATA%\com.chatlite.desktop\secrets\`

CLI 登录同一账号时会自动同步桌面端身份私钥，两个客户端共享同一加密身份，彼此的历史加密消息完全互通。

> **安全提醒**：端到端加密采用单设备密钥模型。**切勿随意删除 `secrets.json` 或执行 `chat-lite logout --forget-identity`**，否则更换身份密钥后，此前收到的旧加密消息将无法再解密。

---

## 9. 环境变量参考

| 环境变量 | 说明 | 示例 |
| :--- | :--- | :--- |
| `CHAT_LITE_HOME` | 自定义配置与私钥存储目录 | `export CHAT_LITE_HOME=~/.chat-lite-work` |
| `CHAT_LITE_API_URL` | 覆盖默认服务器地址 | `export CHAT_LITE_API_URL=https://101.34.254.65` |
| `CHAT_LITE_IMAGE_PROTOCOL` | 强制指定终端看图协议（`kitty` / `iterm2` / `halfblock` / `none`） | `export CHAT_LITE_IMAGE_PROTOCOL=halfblock` |
| `NODE_EXTRA_CA_CERTS` | 全局指定额外信任的私有 CA 证书路径 | `export NODE_EXTRA_CA_CERTS=/path/to/ca.crt` |
| `NO_COLOR` | 设置任意非空值以关闭所有终端 ANSI 颜色输出 | `NO_COLOR=1 chat-lite list` |
| `FORCE_COLOR` | 非 TTY 管道模式下强制保留 ANSI 颜色 | `FORCE_COLOR=1 chat-lite list` |

---

## 10. 常见问题排查（FAQ）

### Q1：macOS 运行时弹窗提示“无法打开，因为无法验证开发者”？
如果直接双击或运行解压文件，macOS 会对网络下载的文件添加隔离标记。执行以下任一操作即可解决：
- 运行随包提供的 `./install.sh`（会自动清理隔离标记）；
- 或在解压目录执行：`xattr -dr com.apple.quarantine .`。

### Q2：安装完成后提示 `command not found: chat-lite`（macOS）或“不是内部或外部命令”（Windows）？
- **macOS**：关闭当前终端并重开一个新窗口，或执行 `source ~/.zshrc && rehash`；
- **Windows**：关闭并重新打开一个新的 Windows Terminal / PowerShell 窗口，使新写入的用户 `PATH` 生效。

### Q3：Windows 终端显示中文乱码或边框错位？
请使用 **Windows Terminal**（或 PowerShell 7+ / WezTerm），避免使用旧版 Windows 控制台（conhost）。`chat-lite.cmd` 已自动启用 UTF-8 代码页（`chcp 65001`）。

### Q4：Windows 上按 `Ctrl+V` 贴图没有反应或粘贴成了乱码？
Windows Terminal 默认将 `Ctrl+V` 绑定为系统的文本粘贴快捷键，按键事件不会传给终端内的 CLI 程序。请直接使用 **`/p`**（或 `/paste 附带文字`）读取剪贴板图片发送，或者把图片文件直接拖入终端回车发送。

### Q5：连接服务器时报自签证书 / TLS 校验错误？
1. 确认安装目录中存在 `chat-lite-private-ca.crt`；
2. 或登录时显式指定证书：`chat-lite login --server <地址> --ca <证书路径>`（登录成功后会自动记住）。

### Q6：历史消息显示 `[无法解密的消息]`？
通常是因为本机缺少当初加密该消息时的旧身份私钥（例如更换了电脑、删除了 `secrets.json`、或使用过 `logout --forget-identity`）。如果原电脑上装有桌面端，在原电脑上使用 CLI 登录会自动同步桌面端私钥；新设备发送的新消息均会正常加密解密。

### Q7：无法给某个会话发消息，提示“部分成员尚未启用端到端加密”？
会话中的每位成员都需要至少登录一次新版客户端（桌面端 0.2.0+ 或本 CLI）以注册自己的加密公钥，之后即可正常加密通信。
