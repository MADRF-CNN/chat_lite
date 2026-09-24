import readline from "node:readline";
import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ConversationDto, ServerToClientEvents } from "@chat-lite/shared";
import { Client, conversationLabel } from "./client";
import { decryptedLine, formatSize, formatTime, shortId } from "./format";
import { fail, info, warn } from "./log";
import { parseFlags, serverFlag, flagString, type Values } from "./args";
import { c } from "./color";

const SLASH_COMMANDS = [
  "/help",
  "/switch",
  "/list",
  "/history",
  "/open",
  "/group",
  "/whoami",
  "/clear",
  "/mask",
  "/unmask",
  "/quit",
];

function printBorder(title?: string) {
  const width = 64;
  if (!title) {
    console.log(c.blue("+" + "-".repeat(width - 2) + "+"));
    return;
  }
  const prefix = "+-- " + title + " ";
  const pad = Math.max(0, width - prefix.length - 1);
  console.log(c.blue("+-- ") + c.bold(c.brightWhite(title)) + " " + c.blue("-".repeat(pad) + "+"));
}

function printBoxLine(label: string, value: string) {
  console.log(c.blue("| ") + c.dim(label.padEnd(8)) + " " + value);
}

function printSectionHeader(title: string) {
  console.log(c.gray("---") + " " + c.bold(c.brightCyan(title)) + " " + c.gray("---"));
}

function safePrint(rl: readline.Interface, text: string) {
  process.stdout.write("\r\x1b[2K");
  process.stdout.write(text + "\n");
  rl.prompt(true);
}

function visualWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x20000 && code <= 0x2a6df) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

function eraseSubmittedLine(promptText: string, inputText: string) {
  if (!process.stdout.isTTY) return;
  const cols = process.stdout.columns || 80;
  const totalWidth = visualWidth(promptText) + visualWidth(inputText);
  const rows = Math.max(1, Math.ceil(totalWidth / cols));
  process.stdout.write(`\x1b[${rows}A\r\x1b[0J`);
}

function conversationTitle(conversation: ConversationDto, meId: string) {
  if (conversation.type === "GROUP") return conversation.name ?? "未命名群聊";
  const other = conversation.members.find((member) => member.id !== meId);
  return other ? `${other.displayName} (@${other.username})` : "私聊";
}

function simulateCodexOutput(prompt: string) {
  const cleanPrompt = prompt.slice(0, 60);
  const snippets = [
    `// [Codex] Synthesized implementation for "${cleanPrompt}"
export async function processTask<T>(input: T[], options?: TaskOptions): Promise<Result<T>> {
  const pipeline = new StreamTransformer({ concurrency: 4, backpressure: true });
  const results = await pipeline.mapParallel(input, async (item) => {
    return transformNode(item, options?.strict ?? false);
  });
  return { status: "success", count: results.length, data: results };
}
// AST analysis complete: 0 warnings, optimized via inline heuristics.`,

    `# [Codex] Generated pipeline script for "${cleanPrompt}"
def optimize_execution_flow(records: list[dict], threshold: float = 0.95) -> dict:
    """Vectorized stream processor with sliding window aggregation."""
    filtered = [r for r in records if r.get("score", 0) >= threshold]
    summary = {
        "total": len(records),
        "retained": len(filtered),
        "ratio": round(len(filtered) / max(len(records), 1), 4),
    }
    return summary
# Compilation: LLVM IR generated (target: x86_64-apple-darwin).`,

    `// [Codex] Concurrent worker implementation for "${cleanPrompt}"
pub struct TaskDispatcher {
    pool: ThreadPool,
    metrics: Arc<AtomicU64>,
}

impl TaskDispatcher {
    pub fn dispatch<F>(&self, job: F) -> Result<(), DispatchError>
    where
        F: FnOnce() + Send + 'static,
    {
        self.metrics.fetch_add(1, Ordering::Relaxed);
        self.pool.execute(job);
        Ok(())
    }
}
// Benchmark: latency 1.4µs/op, memory footprint negligible.`,

    `-- [Codex] Query plan and optimizer for "${cleanPrompt}"
SELECT 
    DATE_TRUNC('hour', created_at) AS event_hour,
    COUNT(DISTINCT session_id) AS active_sessions,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms) AS p99_latency
FROM telemetry_events
WHERE status_code < 500 AND partition_key >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY 1
ORDER BY 1 DESC;
-- Query plan: Index Scan using idx_telemetry_created_at (cost=0.42..18.25 rows=240)`
  ];

  const selected = snippets[Math.floor(Math.random() * snippets.length)] ?? "";
  console.log(c.dim("[codex] Analyzing instruction..."));
  console.log(c.dim("[codex] Generating candidate implementation (temperature=0.2):"));
  console.log("");
  console.log(c.brightWhite(selected));
  console.log("");
}

export async function runRepl(client: Client) {
  let conversations = await client.listConversations();
  if (!conversations.length) {
    info("当前暂无任何会话。输入 /open <用户名> 发起私聊，或输入 /group <群名> <用户名...> 创建群聊。");
  }

  let activeConversation: ConversationDto | undefined = conversations[0];
  const conversationMap = new Map<string, ConversationDto>();
  for (const item of conversations) conversationMap.set(item.id, item);
  const localClientIds = new Set<string>();

  let isMasked = false;
  let maskedUnreadCount = 0;

  function printMaskedHeader() {
    console.clear();
    console.log(c.bold(c.brightWhite("OpenAI Codex (v0.14.2) [Interactive Shell]")));
    console.log(c.dim(`Workspace: ${process.cwd()}`));
    console.log(c.dim("Model: codex-davinci-002-optimized | Context: 8k tokens | Mode: Code Synthesis"));
    console.log(c.gray("-".repeat(70)));
    console.log(c.dim("Type instructions or code prompt. Type /unmask or exit to resume."));
    console.log("");
  }

  function getPrompt() {
    if (isMasked) {
      return `${c.bold(c.brightCyan("codex"))} ${c.gray(">")} `;
    }
    if (!activeConversation) return `${c.gray("[无会话]")} ${c.bold(c.cyan(">"))} `;
    const title = activeConversation.type === "GROUP"
      ? (activeConversation.name ?? "群聊")
      : (activeConversation.members.find((m) => m.id !== client.user.id)?.displayName ?? "私聊");
    return `${c.bold(c.brightGreen(`[${title}]`))} ${c.bold(c.cyan(">"))} `;
  }

  function printHeader() {
    console.clear();
    printBorder("Chat Lite 命令行客户端 [E2EE]");
    printBoxLine("当前用户:", `${c.bold(c.brightWhite(client.user.displayName))} ${c.gray(`(@${client.user.username})`)}`);
    if (activeConversation) {
      const kind = activeConversation.type === "GROUP"
        ? c.blue(`[群聊 ${activeConversation.members.length}人]`)
        : c.magenta("[私聊]");
      const title = conversationTitle(activeConversation, client.user.id);
      printBoxLine("当前会话:", `${c.bold(c.brightGreen(title))} ${kind} ${c.gray(`(ID: ${shortId(activeConversation.id)})`)}`);
    } else {
      printBoxLine("当前会话:", c.gray("无活跃会话 (输入 /list 查看，或 /open <用户名> 发起)"));
    }
    console.log(c.blue("| ") + c.gray("提示: 直接打字发送消息; 输入 /help 查看指令; 输入 /q 退出"));
    printBorder();
    console.log("");
  }

  async function showHistory(conversation: ConversationDto, limit = 10) {
    try {
      const page = await client.messages(conversation.id, undefined, limit);
      if (!page.items.length) {
        console.log(c.gray("  [暂无历史消息]"));
        console.log("");
        return;
      }
      for (const raw of page.items) {
        try {
          const decrypted = await client.e2ee.decryptMessage(raw, conversation);
          console.log("  " + decryptedLine(decrypted, client.user));
        } catch {
          const timeStr = c.gray(`[${formatTime(raw.createdAt)}]`);
          const nameStr = c.bold(c.brightYellow(raw.sender.displayName));
          console.log(`  ${timeStr} ${nameStr}: ${c.red("[解密失败]")}`);
        }
      }
      console.log("");
      const last = page.items[page.items.length - 1];
      if (last && last.sender.id !== client.user.id) {
        await client.markRead(conversation.id, last.id).catch(() => undefined);
      }
    } catch (cause) {
      console.log(c.red(`  [加载历史失败: ${cause instanceof Error ? cause.message : cause}]`));
      console.log("");
    }
  }

  printHeader();
  if (activeConversation) {
    printSectionHeader("最近消息");
    await showHistory(activeConversation, 10);
  }

  // Socket.io for live background updates
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(client.apiUrl, {
    auth: { token: client.accessToken },
  });

  const joined = new Set<string>();
  function joinConversation(id: string) {
    if (joined.has(id)) return;
    joined.add(id);
    socket.emit("conversation:join", id);
  }

  for (const id of conversationMap.keys()) joinConversation(id);

  socket.on("connect", () => {
    joined.clear();
    for (const id of conversationMap.keys()) joinConversation(id);
  });

  socket.on("connect_error", async () => {
    if (await client.renewSession()) {
      socket.auth = { token: client.accessToken };
      socket.connect();
    }
  });

  // Readline interface with auto-completion
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: getPrompt(),
    completer(line: string) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("/")) {
        const parts = trimmed.split(" ");
        if (parts.length === 1) {
          const hits = SLASH_COMMANDS.filter((cmd) => cmd.startsWith(parts[0]!));
          return [hits.length ? hits : SLASH_COMMANDS, parts[0]];
        }
        if ((parts[0] === "/s" || parts[0] === "/switch") && parts.length === 2) {
          const candidates: string[] = [];
          for (const item of conversations) {
            candidates.push(item.type === "GROUP" ? (item.name ?? item.id) : (item.members.find((m) => m.id !== client.user.id)?.username ?? item.id));
          }
          const hits = candidates.filter((item) => item.toLowerCase().startsWith(parts[1]!.toLowerCase()));
          return [hits.map((h) => `${parts[0]} ${h}`), line];
        }
      }
      return [[], line];
    },
  });

  // Background incoming message handler
  socket.on("message:new", async (incoming) => {
    if (incoming.clientId && localClientIds.has(incoming.clientId)) {
      localClientIds.delete(incoming.clientId);
      return;
    }

    let conversation = conversationMap.get(incoming.conversationId);
    if (!conversation) {
      conversations = await client.listConversations();
      for (const item of conversations) conversationMap.set(item.id, item);
      conversation = conversationMap.get(incoming.conversationId);
      if (conversation) joinConversation(conversation.id);
    }
    if (!conversation) return;

    if (isMasked) {
      maskedUnreadCount++;
      safePrint(rl, c.dim(`[daemon] background telemetry synced (${maskedUnreadCount} items)`));
      return;
    }

    if (activeConversation && incoming.conversationId === activeConversation.id) {
      try {
        const decrypted = await client.e2ee.decryptMessage(incoming, conversation);
        safePrint(rl, "  " + decryptedLine(decrypted, client.user));
        if (incoming.sender.id !== client.user.id) {
          await client.markRead(conversation.id, incoming.id).catch(() => undefined);
        }
      } catch {
        const timeStr = c.gray(`[${formatTime(incoming.createdAt)}]`);
        const nameStr = c.bold(c.brightYellow(incoming.sender.displayName));
        safePrint(rl, `  ${timeStr} ${nameStr}: ${c.red("[解密失败]")}`);
      }
    } else {
      const from = conversationTitle(conversation, client.user.id);
      safePrint(rl, `  ${c.brightMagenta(`[* 来自 ${incoming.sender.displayName} (${from}) 的新消息，输入 /s ${shortId(conversation.id)} 切换]`)}`);
    }
  });

  socket.on("conversation:updated", async () => {
    conversations = await client.listConversations();
    for (const item of conversations) conversationMap.set(item.id, item);
  });

  rl.prompt();

  rl.on("line", async (rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      rl.prompt();
      return;
    }

    if (line.startsWith("/")) {
      const [cmd, ...rest] = line.slice(1).split(" ");
      const arg = rest.join(" ").trim();
      eraseSubmittedLine(stripVTControlCharacters(getPrompt()), rawLine);

      switch (cmd?.toLowerCase()) {
        case "help":
        case "?":
          console.log("");
          printBorder("可用快捷指令");
          console.log(`  ${c.bold(c.brightYellow("/switch"))}  ${c.cyan("<名称|ID>")}     ${c.gray("(简写: /s)")}   切换当前聊天会话`);
          console.log(`  ${c.bold(c.brightYellow("/list"))}    ${c.gray(" ".repeat(13))}   ${c.gray("(简写: /ls)")}  列出全部会话及未读数`);
          console.log(`  ${c.bold(c.brightYellow("/history"))} ${c.cyan("[条数]")}        ${c.gray("(简写: /h)")}   查看历史记录 (默认 20 条)`);
          console.log(`  ${c.bold(c.brightYellow("/open"))}    ${c.cyan("<用户名>")}      ${c.gray(" ".repeat(14))} 发起或进入私聊`);
          console.log(`  ${c.bold(c.brightYellow("/group"))}   ${c.cyan("<群名> <成员>")}   ${c.gray(" ".repeat(10))} 创建新群聊`);
          console.log(`  ${c.bold(c.brightYellow("/whoami"))}  ${c.gray(" ".repeat(13))}   ${c.gray(" ".repeat(14))} 查看当前账号与加密状态`);
          console.log(`  ${c.bold(c.brightYellow("/mask"))}    ${c.gray(" ".repeat(13))}   ${c.gray("(伪装模式)")}   切换到 Codex 代码伪装掩护`);
          console.log(`  ${c.bold(c.brightYellow("/unmask"))}  ${c.gray(" ".repeat(13))}   ${c.gray("(解除伪装)")}   退出掩护恢复聊天 (简写: /chat)`);
          console.log(`  ${c.bold(c.brightYellow("/clear"))}   ${c.gray(" ".repeat(13))}   ${c.gray("(简写: /c)")}   清屏并刷新当前会话`);
          console.log(`  ${c.bold(c.brightYellow("/quit"))}    ${c.gray(" ".repeat(13))}   ${c.gray("(简写: /q)")}   退出交互会话`);
          printBorder();
          console.log("");
          break;

        case "mask":
        case "stealth":
        case "boss":
          isMasked = true;
          maskedUnreadCount = 0;
          printMaskedHeader();
          rl.setPrompt(getPrompt());
          break;

        case "unmask":
        case "chat":
          isMasked = false;
          printHeader();
          if (activeConversation) {
            printSectionHeader("最近消息");
            await showHistory(activeConversation, 10);
          }
          if (maskedUnreadCount > 0) {
            console.log(c.bold(c.brightYellow(`[* 掩护期间收到 ${maskedUnreadCount} 条新消息]`)));
            maskedUnreadCount = 0;
          }
          rl.setPrompt(getPrompt());
          break;

        case "list":
        case "ls":
          console.log("");
          conversations = await client.listConversations();
          for (const item of conversations) conversationMap.set(item.id, item);
          printSectionHeader("全部会话列表");
          conversations.forEach((item, index) => {
            const isCurrent = activeConversation && activeConversation.id === item.id;
            const currentMark = isCurrent ? c.bold(c.brightGreen("* ")) : "  ";
            const num = c.gray(`[${index + 1}]`);
            const id = c.gray(`[${shortId(item.id)}]`);
            const kind = item.type === "GROUP" ? c.blue("[群聊]") : c.magenta("[私聊]");
            const title = isCurrent
              ? c.bold(c.brightGreen(conversationTitle(item, client.user.id)))
              : c.bold(c.brightWhite(conversationTitle(item, client.user.id)));
            const unread = item.unreadCount > 0 ? c.bold(c.brightRed(` [${item.unreadCount} 条未读]`)) : "";
            const lastText = item.lastMessage?.text
              ? c.gray(` — ${item.lastMessage.text}`)
              : item.lastMessage?.attachments.length
              ? c.cyan(" — [图片]")
              : "";
            console.log(`${currentMark}${num} ${id} ${kind} ${title}${unread}${lastText}`);
          });
          console.log("");
          console.log(c.gray("提示: 可输入 /s <序号> 或 /s <名称/ID> 快速切换"));
          console.log("");
          break;

        case "switch":
        case "s":
          if (!arg) {
            console.log(c.gray("用法: /s <序号 | 用户名 | 群名 | 会话ID前缀>"));
            console.log(c.gray("例如: /s 1  或  /s admin"));
            break;
          }
          const num = parseInt(arg, 10);
          let targetConv: ConversationDto | undefined;
          if (!isNaN(num) && num >= 1 && num <= conversations.length) {
            targetConv = conversations[num - 1];
          } else {
            try {
              targetConv = await client.resolveConversation(arg);
            } catch (err) {
              console.log(c.red(`切换失败: ${err instanceof Error ? err.message : err}`));
            }
          }
          if (targetConv) {
            activeConversation = targetConv;
            conversationMap.set(targetConv.id, targetConv);
            joinConversation(targetConv.id);
            printHeader();
            console.log(`已切换至: ${c.bold(c.brightGreen(conversationTitle(targetConv, client.user.id)))}`);
            printSectionHeader("最近消息");
            await showHistory(targetConv, 10);
            rl.setPrompt(getPrompt());
          }
          break;

        case "history":
        case "h":
          if (!activeConversation) {
            console.log(c.yellow("暂无活跃会话，请先 /list 选择会话"));
            break;
          }
          const count = arg ? parseInt(arg, 10) : 20;
          console.log("");
          printSectionHeader(`历史记录 (${isNaN(count) ? 20 : count} 条)`);
          await showHistory(activeConversation, isNaN(count) ? 20 : count);
          break;

        case "open":
          if (!arg) {
            console.log(c.gray("用法: /open <用户名>"));
            break;
          }
          try {
            const user = await client.findUser(arg);
            const res = await client.createDirect(user.id);
            conversations = await client.listConversations();
            for (const item of conversations) conversationMap.set(item.id, item);
            activeConversation = conversations.find((item) => item.id === res.id) || conversations[0];
            if (activeConversation) {
              joinConversation(activeConversation.id);
              printHeader();
              console.log(`已打开与 ${c.bold(c.brightWhite(user.displayName))} ${c.gray(`(@${user.username})`)} 的私聊`);
              printSectionHeader("最近消息");
              await showHistory(activeConversation, 10);
              rl.setPrompt(getPrompt());
            }
          } catch (err) {
            console.log(c.red(`发起私聊失败: ${err instanceof Error ? err.message : err}`));
          }
          break;

        case "group":
          const [grpName, ...grpMembers] = arg.split(" ").filter(Boolean);
          if (!grpName || !grpMembers.length) {
            console.log(c.gray("用法: /group <群聊名称> <成员用户名1> <成员用户名2...>"));
            break;
          }
          try {
            const memberUsers = await Promise.all(grpMembers.map((m) => client.findUser(m)));
            const created = await client.createGroup(grpName, memberUsers.map((u) => u.id));
            conversations = await client.listConversations();
            for (const item of conversations) conversationMap.set(item.id, item);
            activeConversation = conversations.find((item) => item.id === created.id);
            if (activeConversation) {
              joinConversation(activeConversation.id);
              printHeader();
              console.log(`已创建群聊 "${c.bold(c.brightWhite(grpName))}"，成员: ${memberUsers.map((u) => u.displayName).join(", ")}`);
              rl.setPrompt(getPrompt());
            }
          } catch (err) {
            console.log(c.red(`创建群聊失败: ${err instanceof Error ? err.message : err}`));
          }
          break;

        case "whoami":
          console.log("");
          printBorder("当前账号信息");
          console.log(`  ${c.dim("用户名:".padEnd(8))}   ${c.bold(c.brightWhite(client.user.username))}`);
          console.log(`  ${c.dim("显示名:".padEnd(8))}   ${c.bold(c.brightWhite(client.user.displayName))}`);
          console.log(`  ${c.dim("用户 ID:".padEnd(8))}  ${c.gray(client.user.id)}`);
          console.log(`  ${c.dim("加密状态:".padEnd(8))} ${c.bold(c.brightGreen("端到端加密已启用"))} ${c.gray("(RSA-OAEP 2048 + AES-256-GCM)")}`);
          printBorder();
          console.log("");
          break;

        case "clear":
        case "c":
          if (isMasked) {
            printMaskedHeader();
          } else {
            printHeader();
            if (activeConversation) {
              printSectionHeader("最近消息");
              await showHistory(activeConversation, 10);
            }
          }
          break;

        case "quit":
        case "exit":
        case "q":
          socket.disconnect();
          rl.close();
          process.exit(0);

        default:
          console.log(c.yellow(`未知指令 "/${cmd}"，输入 /help 查看全部指令`));
          break;
      }

      rl.prompt();
      return;
    }

    // If in masked mode, simulate Codex response instead of sending chat message!
    if (isMasked) {
      if (line.toLowerCase() === "exit" || line.toLowerCase() === "quit" || line.toLowerCase() === "unmask") {
        isMasked = false;
        printHeader();
        if (activeConversation) {
          printSectionHeader("最近消息");
          await showHistory(activeConversation, 10);
        }
        if (maskedUnreadCount > 0) {
          console.log(c.bold(c.brightYellow(`[* 掩护期间收到 ${maskedUnreadCount} 条新消息]`)));
          maskedUnreadCount = 0;
        }
        rl.setPrompt(getPrompt());
        rl.prompt();
        return;
      }

      simulateCodexOutput(line);
      rl.prompt();
      return;
    }

    // Normal message sending
    if (!activeConversation) {
      console.log(c.yellow("当前暂无活跃会话，请先输入 /list 或 /open <用户名> 选择会话"));
      rl.prompt();
      return;
    }

    if (line.length > 4000) {
      console.log(c.red("消息长度不能超过 4000 个字符"));
      rl.prompt();
      return;
    }

    const clientId = randomUUID();
    localClientIds.add(clientId);

    try {
      const encrypted = await client.e2ee.encryptContent(activeConversation, { text: line, attachments: [] });
      await client.sendMessage(activeConversation.id, encrypted.ciphertext, encrypted.nonce, encrypted.keyVersion, clientId);
      const now = new Date().toISOString();
      const timeStr = c.gray(`[${formatTime(now)}]`);
      const nameStr = c.bold(c.cyan(`${client.user.displayName}(我)`));
      eraseSubmittedLine(stripVTControlCharacters(getPrompt()), rawLine);
      console.log(`  ${timeStr} ${nameStr}: ${c.brightWhite(line)}`);
    } catch (err) {
      localClientIds.delete(clientId);
      console.log(c.red(`  [发送失败: ${err instanceof Error ? err.message : err}]`));
    }

    rl.prompt();
  });

  rl.on("close", () => {
    socket.disconnect();
    console.log(`\n${c.gray("已退出 Chat Lite CLI。")}`);
    process.exit(0);
  });
}
