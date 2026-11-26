import readline from "node:readline";
import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ConversationDto, EncryptedAttachmentMetadata, QuotedMessageMetadata, ServerToClientEvents } from "@chat-lite/shared";
import type { DecryptedMessage } from "./crypto";
import { Client, conversationLabel } from "./client";
import {
  PIXEL_STICKERS,
  allStickerCompletionKeys,
  completeColonSticker,
  encodePixelStickerMessage,
  parseColonStickerShortcut,
  parsePixelStickerMessage,
  renderPixelSticker,
  renderPixelStickerLines,
  resolvePixelSticker,
  type PixelSticker,
} from "./pixel";
import { completeGroupMention, highlightMentions, isMentioningMe } from "./mention";
import { decryptedLine, formatQuoteBlock, formatSize, formatTime, parseQuickQuoteShortcut, quotePreviewOf, shortId } from "./format";
import {
  PreviewManager,
  clearTerminalImages,
  detectImageProtocol,
  extractImagePathsFromLine,
  looksLikeImageFilePath,
  parsePathAndCaption,
  prepareImageFileForUpload,
  prepareImageForUpload,
  protocolLabel,
  readClipboardImage,
  renderTerminalImage,
  saveImageToDir,
  type PreparedUploadImage,
} from "./image";
import { fail, info, warn } from "./log";
import { parseFlags, serverFlag, flagString, type Values } from "./args";
import { c } from "./color";

const SLASH_COMMANDS = [
  "/help",
  "/reply",
  "/r",
  "/quote",
  "/emo",
  "/e",
  "/art",
  "/img",
  "/i",
  "/view",
  "/v",
  "/pic",
  "/paste",
  "/p",
  "/save",
  "/autoimg",
  "/switch",
  "/s",
  "/list",
  "/ls",
  "/history",
  "/h",
  "/more",
  "/mo",
  "/open",
  "/group",
  "/whoami",
  "/clear",
  "/c",
  "/mask",
  "/mk",
  "/m",
  "/boss",
  "/unmask",
  "/umk",
  "/um",
  "/chat",
  "/quit",
  "/q",
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
      (code >= 0x3000 && code <= 0x30ff) ||
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

export async function runRepl(client: Client, options?: { initialMasked?: boolean }) {
  let conversations = await client.listConversations();
  if (!conversations.length) {
    info("当前暂无任何会话。输入 /open <用户名> 发起私聊，或输入 /group <群名> <用户名...> 创建群聊。");
  }

  let activeConversation: ConversationDto | undefined = conversations[0];
  const conversationMap = new Map<string, ConversationDto>();
  for (const item of conversations) conversationMap.set(item.id, item);
  const localClientIds = new Set<string>();

  let isMasked = Boolean(options?.initialMasked);
  let maskedUnreadCount = 0;

  type IndexedImage = {
    index: number;
    attachment: EncryptedAttachmentMetadata;
    conversation: ConversationDto;
    keyVersion: number;
    senderName: string;
    createdAt: string;
  };

  type IndexedMessage = {
    index: number;
    id: string;
    senderId: string;
    senderName: string;
    preview: string;
  };

  let imageEntries: IndexedImage[] = [];
  const imageIndexById = new Map<string, number>();
  const imageCache = new Map<string, Uint8Array>();
  let messageEntries: IndexedMessage[] = [];
  const messageIndexById = new Map<string, number>();
  let pendingQuote: { index: number; meta: QuotedMessageMetadata } | null = null;
  let pendingImages: PreparedUploadImage[] = [];
  const previewManager = new PreviewManager();
  let autoImg = false;
  let historyCursor: string | null = null;
  let historyHasMore = false;

  const onProcessExit = () => {
    previewManager.cleanup();
  };
  process.once("exit", onProcessExit);

  function resetImages() {
    imageEntries = [];
    imageIndexById.clear();
    imageCache.clear();
    messageEntries = [];
    messageIndexById.clear();
    pendingQuote = null;
    pendingImages = [];
    historyCursor = null;
    historyHasMore = false;
  }

  function registerMessage(decrypted: DecryptedMessage): IndexedMessage {
    const existingIdx = messageIndexById.get(decrypted.message.id);
    if (existingIdx !== undefined) {
      const existing = messageEntries.find((item) => item.index === existingIdx);
      if (existing) return existing;
    }
    const entry: IndexedMessage = {
      index: messageEntries.length + 1,
      id: decrypted.message.id,
      senderId: decrypted.message.sender.id,
      senderName: decrypted.message.sender.displayName,
      preview: quotePreviewOf(decrypted),
    };
    messageEntries.push(entry);
    messageIndexById.set(entry.id, entry.index);
    return entry;
  }

  function resolveMessageEntry(token?: string): IndexedMessage | null {
    if (!messageEntries.length) {
      console.log(c.yellow("当前会话还没有已加载的消息可引用"));
      return null;
    }
    if (!token) {
      // Default: latest message from someone else, falling back to latest overall
      for (let i = messageEntries.length - 1; i >= 0; i -= 1) {
        if (messageEntries[i]!.senderId !== client.user.id) return messageEntries[i]!;
      }
      return messageEntries[messageEntries.length - 1]!;
    }
    const normalized = token.startsWith("#") ? token.slice(1) : token;
    const idx = Number.parseInt(normalized, 10);
    if (!Number.isInteger(idx) || idx < 1 || idx > messageEntries.length) {
      console.log(c.yellow(`找不到消息 #${normalized}，当前可引用范围：#1 ~ #${messageEntries.length}`));
      return null;
    }
    return messageEntries[idx - 1] ?? null;
  }

  function toQuotedMetadata(entry: IndexedMessage): QuotedMessageMetadata {
    return { id: entry.id, senderName: entry.senderName, preview: entry.preview };
  }

  function registerImages(decrypted: DecryptedMessage, conversation: ConversationDto): IndexedImage[] {
    const attachments = decrypted.content?.attachments ?? [];
    const keyVersion = decrypted.message.keyVersion;
    if (!attachments.length || !keyVersion) return [];

    const registered: IndexedImage[] = [];
    for (const attachment of attachments) {
      const existingIdx = imageIndexById.get(attachment.id);
      if (existingIdx !== undefined) {
        const existing = imageEntries.find((item) => item.index === existingIdx);
        if (existing) registered.push(existing);
        continue;
      }
      const entry: IndexedImage = {
        index: imageEntries.length + 1,
        attachment,
        conversation,
        keyVersion,
        senderName: decrypted.message.sender.displayName,
        createdAt: decrypted.message.createdAt,
      };
      imageEntries.push(entry);
      imageIndexById.set(attachment.id, entry.index);
      registered.push(entry);
    }
    return registered;
  }

  function lookupImageIndex(attachmentId: string): number | undefined {
    return imageIndexById.get(attachmentId);
  }

  function resolveImageEntry(token?: string): IndexedImage | null {
    if (!imageEntries.length) {
      console.log(c.yellow("当前会话还没有已加载的图片（可输入 /history 加载更多历史消息）"));
      return null;
    }
    if (!token) {
      return imageEntries[imageEntries.length - 1]!;
    }
    const normalized = token.startsWith("#") ? token.slice(1) : token;
    const idx = Number.parseInt(normalized, 10);
    if (!Number.isInteger(idx) || idx < 1 || idx > imageEntries.length) {
      console.log(c.yellow(`找不到图片 #${normalized}，当前会话共有 ${imageEntries.length} 张图片（可用 /img 1 ~ ${imageEntries.length} 或 /img ls 查看列表）`));
      return null;
    }
    return imageEntries[idx - 1] ?? null;
  }

  async function loadImageBytes(entry: IndexedImage, variant: "original" | "thumbnail"): Promise<Uint8Array> {
    const cacheKey = `${entry.attachment.id}:${variant}`;
    const cached = imageCache.get(cacheKey);
    if (cached) return cached;
    const bytes = await client.e2ee.decryptAttachment(entry.attachment, entry.conversation, entry.keyVersion, variant);
    if (imageCache.size >= 20) {
      const oldestKey = imageCache.keys().next().value;
      if (oldestKey) imageCache.delete(oldestKey);
    }
    imageCache.set(cacheKey, bytes);
    return bytes;
  }

  async function displayImage(
    entry: IndexedImage,
    opts?: {
      open?: boolean;
      variant?: "original" | "thumbnail";
      forceAscii?: boolean;
      quietMeta?: boolean;
      printer?: (text: string) => void;
    },
  ) {
    const print = opts?.printer ?? ((text: string) => console.log(text));
    const dims = entry.attachment.width && entry.attachment.height
      ? `${entry.attachment.width}x${entry.attachment.height} · `
      : "";

    if (opts?.open) {
      const bytes = await loadImageBytes(entry, "original");
      if (isMasked) return;
      const opened = previewManager.open(bytes, entry.attachment.originalName, entry.attachment.mimeType);
      print(`  ${c.cyan(`[图片 #${entry.index}]`)} 已通过 ${c.bold(opened.viewer)} 打开 ${c.brightWhite(entry.attachment.originalName)} ${c.gray(`(${dims}${formatSize(entry.attachment.size)})`)}`);
      return;
    }

    const protocol = opts?.forceAscii ? "halfblock" : detectImageProtocol();
    if (protocol === "none") {
      const bytes = await loadImageBytes(entry, "original");
      if (isMasked) return;
      const opened = previewManager.open(bytes, entry.attachment.originalName, entry.attachment.mimeType);
      print(`  ${c.gray("当前终端不支持内联显示，已自动改用")} ${c.bold(opened.viewer)} 打开 ${c.cyan(`[图片 #${entry.index}]`)} ${c.brightWhite(entry.attachment.originalName)}`);
      return;
    }

    const variant = opts?.variant ?? "original";
    const bytes = await loadImageBytes(entry, variant);
    if (isMasked) return;
    const rendered = await renderTerminalImage(bytes, {
      protocol,
      name: entry.attachment.originalName,
      maxPixels: variant === "thumbnail" ? 720 : 1280,
    });
    if (isMasked) return;

    if (!opts?.quietMeta) {
      print(`  ${c.cyan(`[图片 #${entry.index}]`)} ${c.brightWhite(entry.attachment.originalName)} ${c.gray(`(${dims}${formatSize(entry.attachment.size)} · ${protocolLabel(rendered.protocol)})`)}`);
    }
    print(rendered.output);
  }

  async function sendPreparedImages(
    images: PreparedUploadImage[],
    caption: string,
    eraseRawLine?: { promptText: string; rawLine: string },
    replyTo?: QuotedMessageMetadata,
  ) {
    if (!activeConversation) {
      console.log(c.yellow("当前暂无活跃会话，请先输入 /list 或 /open <用户名> 选择会话"));
      return false;
    }
    if (!images.length) return false;
    if (images.length > 10) {
      console.log(c.red("单条消息最多发送 10 张图片"));
      return false;
    }
    if (caption.length > 4000) {
      console.log(c.red("附带文字不能超过 4000 个字符"));
      return false;
    }

    const conv = activeConversation;
    const clientId = randomUUID();
    localClientIds.add(clientId);

    try {
      const metadataList: EncryptedAttachmentMetadata[] = [];
      let keyVersion: number | undefined;
      for (const prepared of images) {
        const encryptedAtt = await client.e2ee.encryptAttachment(
          conv,
          prepared.originalBytes,
          prepared.thumbnailBytes,
          keyVersion,
        );
        keyVersion = encryptedAtt.keyVersion;
        const uploaded = await client.uploadEncryptedAttachment(encryptedAtt.originalBytes, encryptedAtt.thumbnailBytes);
        metadataList.push({
          id: uploaded.id,
          originalName: prepared.originalName,
          mimeType: prepared.mimeType,
          size: prepared.size,
          width: prepared.width,
          height: prepared.height,
          originalNonce: encryptedAtt.originalNonce,
          thumbnailNonce: encryptedAtt.thumbnailNonce,
        });
      }

      const encrypted = await client.e2ee.encryptContent(
        conv,
        { text: caption || undefined, attachments: metadataList, ...(replyTo ? { replyTo } : {}) },
        keyVersion,
      );
      const sent = await client.sendMessage(
        conv.id,
        encrypted.ciphertext,
        encrypted.nonce,
        encrypted.keyVersion,
        clientId,
        metadataList.map((item) => item.id),
      );
      client.syncUser(sent.sender);

      const decrypted: DecryptedMessage = {
        message: {
          ...sent,
          text: caption || null,
          attachments: metadataList.map((item) => ({ ...item, encrypted: true })),
        },
        content: { text: caption || undefined, attachments: metadataList, ...(replyTo ? { replyTo } : {}) },
      };
      registerImages(decrypted, conv);
      const msgEntry = registerMessage(decrypted);
      for (let idx = 0; idx < images.length; idx += 1) {
        const prepared = images[idx]!;
        const meta = metadataList[idx]!;
        if (imageCache.size >= 20) {
          const oldestKey = imageCache.keys().next().value;
          if (oldestKey) imageCache.delete(oldestKey);
        }
        imageCache.set(`${meta.id}:original`, prepared.originalBytes);
        imageCache.set(`${meta.id}:thumbnail`, prepared.thumbnailBytes);
      }

      if (!isMasked) {
        if (eraseRawLine) {
          eraseSubmittedLine(eraseRawLine.promptText, eraseRawLine.rawLine);
        }
        console.log("  " + decryptedLine(decrypted, client.user, false, lookupImageIndex, conv, msgEntry.index));
      }
      return true;
    } catch (err) {
      localClientIds.delete(clientId);
      console.log(c.red(`  [发送图片失败: ${err instanceof Error ? err.message : err}]`));
      return false;
    }
  }

  async function sendPixelSticker(
    sticker: PixelSticker,
    caption: string,
    eraseRawLine?: { promptText: string; rawLine: string },
    replyTo?: QuotedMessageMetadata,
  ) {
    if (!activeConversation) {
      console.log(c.yellow("当前暂无活跃会话，请先输入 /list 或 /open <用户名> 选择会话"));
      return false;
    }
    const conv = activeConversation;
    const textPayload = encodePixelStickerMessage(sticker, caption);
    if (textPayload.length > 4000) {
      console.log(c.red("消息长度不能超过 4000 个字符"));
      return false;
    }
    const clientId = randomUUID();
    localClientIds.add(clientId);
    try {
      const encrypted = await client.e2ee.encryptContent(
        conv,
        { text: textPayload, attachments: [], ...(replyTo ? { replyTo } : {}) },
      );
      const sent = await client.sendMessage(conv.id, encrypted.ciphertext, encrypted.nonce, encrypted.keyVersion, clientId);
      client.syncUser(sent.sender);
      const decrypted: DecryptedMessage = {
        message: { ...sent, text: textPayload, attachments: [] },
        content: { text: textPayload, attachments: [], ...(replyTo ? { replyTo } : {}) },
      };
      const msgEntry = registerMessage(decrypted);
      if (!isMasked) {
        if (eraseRawLine) {
          eraseSubmittedLine(eraseRawLine.promptText, eraseRawLine.rawLine);
        }
        const idxPrefix = `${c.dim(`#${msgEntry.index}`)} `;
        const timeStr = c.gray(`[${formatTime(sent.createdAt)}]`);
        const nameStr = c.bold(c.cyan(`${sent.sender.displayName}(我)`));
        const styledCaption = caption
          ? ` ${conv.type === "GROUP" ? highlightMentions(caption, client.user, conv.members) : c.brightWhite(caption)}`
          : "";
        const quoteLine = replyTo ? `\n${formatQuoteBlock(replyTo)}` : "";
        console.log(`  ${idxPrefix}${timeStr} ${nameStr}: ${c.dim(`[${sticker.label}]`)}${styledCaption}${quoteLine}\n${renderPixelSticker(sticker, "      ")}`);
      }
      return true;
    } catch (err) {
      localClientIds.delete(clientId);
      console.log(c.red(`  [发送表情失败: ${err instanceof Error ? err.message : err}]`));
      return false;
    }
  }

  async function sendTextMessage(
    text: string,
    eraseRawLine?: { promptText: string; rawLine: string },
    replyTo?: QuotedMessageMetadata,
  ) {
    if (!activeConversation) {
      console.log(c.yellow("当前暂无活跃会话，请先输入 /list 或 /open <用户名> 选择会话"));
      return false;
    }
    if (text.length > 4000) {
      console.log(c.red("消息长度不能超过 4000 个字符"));
      return false;
    }
    const conv = activeConversation;
    const clientId = randomUUID();
    localClientIds.add(clientId);
    try {
      const encrypted = await client.e2ee.encryptContent(
        conv,
        { text, attachments: [], ...(replyTo ? { replyTo } : {}) },
      );
      const sent = await client.sendMessage(conv.id, encrypted.ciphertext, encrypted.nonce, encrypted.keyVersion, clientId);
      client.syncUser(sent.sender);
      const decrypted: DecryptedMessage = {
        message: { ...sent, text, attachments: [] },
        content: { text, attachments: [], ...(replyTo ? { replyTo } : {}) },
      };
      const msgEntry = registerMessage(decrypted);
      if (!isMasked) {
        if (eraseRawLine) {
          eraseSubmittedLine(eraseRawLine.promptText, eraseRawLine.rawLine);
        }
        const idxPrefix = `${c.dim(`#${msgEntry.index}`)} `;
        const timeStr = c.gray(`[${formatTime(sent.createdAt)}]`);
        const nameStr = c.bold(c.cyan(`${sent.sender.displayName}(我)`));
        const formattedBody = conv.type === "GROUP"
          ? highlightMentions(text, client.user, conv.members)
          : c.brightWhite(text);
        const quoteLine = replyTo ? `\n${formatQuoteBlock(replyTo)}` : "";
        console.log(`  ${idxPrefix}${timeStr} ${nameStr}: ${formattedBody}${quoteLine}`);
      }
      return true;
    } catch (err) {
      localClientIds.delete(clientId);
      console.log(c.red(`  [发送失败: ${err instanceof Error ? err.message : err}]`));
      return false;
    }
  }

  function printMaskedHeader() {
    process.stdout.write(`${clearTerminalImages()}\x1b[2J\x1b[3J\x1b[H`);
    console.log(c.bold(c.brightWhite("OpenAI Codex (v0.14.2) [Interactive Shell]")));
    console.log(c.dim(`Workspace: ${process.cwd()}`));
    console.log(c.dim("Model: codex-davinci-002-optimized | Context: 8k tokens | Mode: Code Synthesis"));
    console.log(c.gray("-".repeat(70)));
    console.log(c.dim("Type instructions or code prompt."));
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
    const quoteBadge = pendingQuote ? ` ${c.bold(c.brightYellow(`[引用 #${pendingQuote.index} ${pendingQuote.meta.senderName}]`))}` : "";
    const pendingBadge = pendingImages.length > 0 ? ` ${c.bold(c.brightCyan(`[待发 ${pendingImages.length} 图]`))}` : "";
    return `${c.bold(c.brightGreen(`[${title}]`))}${quoteBadge}${pendingBadge} ${c.bold(c.cyan(">"))} `;
  }

  function printHeader() {
    process.stdout.write(`${clearTerminalImages()}\x1b[2J\x1b[3J\x1b[H`);
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
    console.log(c.blue("| ") + c.gray("提示: 直接打字发消息; >编号/r 引用回复; :doge 发像素表情; 群聊 @Tab 提及; /more 翻页; 两次Esc 伪装"));
    printBorder();
    console.log("");
  }

  async function fetchMessageBatch(conversationId: string, startCursor: string | undefined, targetCount: number) {
    const capped = Math.min(Math.max(1, targetCount), 500);
    const collected: Awaited<ReturnType<typeof client.messages>>["items"] = [];
    let cursor = startCursor;
    while (collected.length < capped) {
      const remaining = capped - collected.length;
      const page = await client.messages(conversationId, cursor, Math.min(100, remaining));
      collected.unshift(...page.items);
      cursor = page.nextCursor ?? undefined;
      if (!cursor || page.items.length === 0) break;
    }
    return { items: collected, nextCursor: cursor ?? null };
  }

  async function printMessageBatch(
    conversation: ConversationDto,
    items: Awaited<ReturnType<typeof client.messages>>["items"],
  ) {
    for (const raw of items) {
      try {
        const decrypted = await client.e2ee.decryptMessage(raw, conversation);
        registerImages(decrypted, conversation);
        const msgEntry = registerMessage(decrypted);
        console.log("  " + decryptedLine(decrypted, client.user, false, lookupImageIndex, conversation, msgEntry.index));
      } catch {
        const timeStr = c.gray(`[${formatTime(raw.createdAt)}]`);
        const nameStr = c.bold(c.brightYellow(raw.sender.displayName));
        console.log(`  ${timeStr} ${nameStr}: ${c.red("[解密失败]")}`);
      }
    }
  }

  async function showHistory(conversation: ConversationDto, limit = 10) {
    try {
      const batch = await fetchMessageBatch(conversation.id, undefined, limit);
      historyCursor = batch.nextCursor;
      historyHasMore = Boolean(batch.nextCursor);
      if (!batch.items.length) {
        console.log(c.gray("  [暂无历史消息]"));
        console.log("");
        return;
      }
      if (historyHasMore) {
        console.log(c.dim("  [上方还有更早消息，输入 /more 继续往前翻页]"));
      }
      await printMessageBatch(conversation, batch.items);
      console.log("");
      const last = batch.items[batch.items.length - 1];
      if (last && last.sender.id !== client.user.id) {
        await client.markRead(conversation.id, last.id).catch(() => undefined);
      }
    } catch (cause) {
      console.log(c.red(`  [加载历史失败: ${cause instanceof Error ? cause.message : cause}]`));
      console.log("");
    }
  }

  async function showOlderHistory(conversation: ConversationDto, limit = 20) {
    if (!historyHasMore || !historyCursor) {
      console.log(c.gray("  [已经到顶了，没有更早的历史消息]"));
      console.log("");
      return;
    }
    try {
      const batch = await fetchMessageBatch(conversation.id, historyCursor, limit);
      historyCursor = batch.nextCursor;
      historyHasMore = Boolean(batch.nextCursor);
      if (!batch.items.length) {
        console.log(c.gray("  [已经到顶了，没有更早的历史消息]"));
        console.log("");
        return;
      }
      console.log("");
      printSectionHeader(`更早的历史消息 (${batch.items.length} 条)`);
      await printMessageBatch(conversation, batch.items);
      console.log(historyHasMore ? c.dim("  [继续输入 /more 查看更早消息]") : c.gray("  [已加载至最早一条消息]"));
      console.log("");
    } catch (cause) {
      console.log(c.red(`  [翻页加载失败: ${cause instanceof Error ? cause.message : cause}]`));
      console.log("");
    }
  }

  if (isMasked) {
    printMaskedHeader();
  } else {
    printHeader();
    if (activeConversation) {
      printSectionHeader("最近消息");
      await showHistory(activeConversation, 10);
    }
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
        if (["/img", "/i", "/view", "/v", "/save"].includes(parts[0]!) && parts.length === 2) {
          const candidates = [
            ...(parts[0] === "/img" || parts[0] === "/i" ? ["ls"] : []),
            ...imageEntries.map((entry) => String(entry.index)),
          ];
          const hits = candidates.filter((item) => item.startsWith(parts[1]!));
          return [hits.map((h) => `${parts[0]} ${h}`), line];
        }
        if (parts[0] === "/autoimg" && parts.length === 2) {
          const hits = ["on", "off"].filter((item) => item.startsWith(parts[1]!.toLowerCase()));
          return [hits.map((h) => `${parts[0]} ${h}`), line];
        }
        if (["/e", "/emo", "/emoji", "/art"].includes(parts[0]!) && parts.length === 2) {
          const hits = allStickerCompletionKeys().filter((item) => item.startsWith(parts[1]!.toLowerCase()));
          return [hits.map((h) => `${parts[0]} ${h}`), line];
        }
        if (["/r", "/reply", "/quote"].includes(parts[0]!) && parts.length === 2) {
          const candidates = messageEntries.slice(-20).reverse().map((m) => String(m.index));
          const hits = candidates.filter((item) => item.startsWith(parts[1]!));
          return [hits.map((h) => `${parts[0]} ${h}`), line];
        }
      }
      const colonComp = completeColonSticker(line);
      if (colonComp) return colonComp;
      const mentionComp = completeGroupMention(line, activeConversation, client.user.id);
      if (mentionComp) return mentionComp;
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
        const images = registerImages(decrypted, conversation);
        const msgEntry = registerMessage(decrypted);
        const mentionedMe = incoming.sender.id !== client.user.id && isMentioningMe(decrypted.message.text, client.user, conversation);
        if (mentionedMe && process.stdout.isTTY) process.stdout.write("\x07");
        safePrint(rl, "  " + decryptedLine(decrypted, client.user, false, lookupImageIndex, conversation, msgEntry.index));
        if (autoImg && !isMasked && images.length > 0 && detectImageProtocol() !== "none") {
          for (const entry of images) {
            if (isMasked) break;
            try {
              await displayImage(entry, {
                variant: "thumbnail",
                quietMeta: true,
                printer: (text) => safePrint(rl, text),
              });
            } catch (err) {
              safePrint(rl, c.red(`  [图片 #${entry.index} 预览失败: ${err instanceof Error ? err.message : err}]`));
            }
          }
        }
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
      let mentionedMe = false;
      if (conversation.type === "GROUP" && incoming.sender.id !== client.user.id) {
        try {
          const decrypted = await client.e2ee.decryptMessage(incoming, conversation);
          mentionedMe = isMentioningMe(decrypted.message.text, client.user, conversation);
        } catch {
          // Ignore decrypt errors on background notification
        }
      }
      if (mentionedMe) {
        if (process.stdout.isTTY) process.stdout.write("\x07");
        safePrint(rl, `  ${c.alertBadge(" @你 ")} ${c.bold(c.brightYellow(`来自 ${incoming.sender.displayName} (${from}) 在群里提到了你，输入 /s ${shortId(conversation.id)} 切换`))}`);
      } else {
        safePrint(rl, `  ${c.brightMagenta(`[* 来自 ${incoming.sender.displayName} (${from}) 的新消息，输入 /s ${shortId(conversation.id)} 切换]`)}`);
      }
    }
  });

  socket.on("conversation:updated", async () => {
    conversations = await client.listConversations();
    for (const item of conversations) conversationMap.set(item.id, item);
  });

  function enterMaskMode() {
    isMasked = true;
    maskedUnreadCount = 0;
    previewManager.cleanup();
    imageCache.clear();
    pendingImages = [];
    pendingQuote = null;
    printMaskedHeader();
    rl.setPrompt(getPrompt());
  }

  async function exitMaskMode() {
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
  }

  // Hotkey listener for instant mask toggle (Double Esc or Ctrl+B)
  let isToggling = false;
  let lastEscTime = 0;
  let lastToggleTime = 0;
  const ESC_DOUBLE_PRESS_INTERVAL = 700;
  const TOGGLE_COOLDOWN = 600;

  async function performMaskToggle() {
    isToggling = true;
    lastToggleTime = Date.now();
    try {
      const mutableRl = rl as unknown as { line: string; cursor: number };
      mutableRl.line = "";
      mutableRl.cursor = 0;
      if (!isMasked) {
        enterMaskMode();
      } else {
        await exitMaskMode();
      }
      rl.prompt();
    } finally {
      isToggling = false;
    }
  }

  // 1. Raw stdin listener: detects Esc with 0ms delay without waiting for Node's 500ms escape sequence timeout
  const onRawData = async (chunk: Buffer | string) => {
    if (isToggling) return;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const now = Date.now();
    if (now - lastToggleTime < TOGGLE_COOLDOWN) return;

    // Fast double Esc in a single chunk: [0x1b, 0x1b]
    if (buf.length === 2 && buf[0] === 0x1b && buf[1] === 0x1b) {
      lastEscTime = 0;
      await performMaskToggle();
      return;
    }

    // Single Esc byte: [0x1b]
    if (buf.length === 1 && buf[0] === 0x1b) {
      if (now - lastEscTime <= ESC_DOUBLE_PRESS_INTERVAL) {
        lastEscTime = 0;
        await performMaskToggle();
      } else {
        lastEscTime = now;
      }
      return;
    }

    // Any other key clears lastEscTime so arrow keys or typing don't count towards double-Esc
    if (!buf.includes(0x1b)) {
      lastEscTime = 0;
    }
  };

  // 2. Pre-readline keypress listener: Backspace on an already-empty line removes the last pending Ctrl+V image or pending quote
  let isPastingClipboard = false;
  const onBeforeKeypress = (_str: string, key?: { name?: string; ctrl?: boolean }) => {
    if (isMasked || isToggling || !key) return;
    if (key.name === "backspace" && !key.ctrl && rl.line.length === 0) {
      if (pendingImages.length > 0) {
        const removed = pendingImages.pop()!;
        rl.setPrompt(getPrompt());
        safePrint(rl, `  ${c.gray(`[已撤销待发图片] ${removed.originalName} (剩余 ${pendingImages.length} 张)`)}`);
      } else if (pendingQuote) {
        const removed = pendingQuote;
        pendingQuote = null;
        rl.setPrompt(getPrompt());
        safePrint(rl, `  ${c.gray(`[已取消引用 #${removed.index} ${removed.meta.senderName}]`)}`);
      }
    }
  };

  // 3. Keypress listener for Ctrl+B, Ctrl+V (paste clipboard image), and fallback double-Esc
  const onKeypress = async (str: string, key?: { name?: string; ctrl?: boolean; sequence?: string }) => {
    if (!key || isToggling) return;

    const isCtrlV = key.ctrl && (key.name === "v" || str === "\x16");
    if (isCtrlV && !isMasked) {
      // Strip the literal \x16 character that readline inserts for unbound Ctrl+V
      const mutableRl = rl as unknown as { line: string; cursor: number };
      const ctrlIdx = mutableRl.line.lastIndexOf("\x16");
      if (ctrlIdx !== -1) {
        mutableRl.line = mutableRl.line.slice(0, ctrlIdx) + mutableRl.line.slice(ctrlIdx + 1);
        mutableRl.cursor = Math.min(mutableRl.cursor, mutableRl.line.length);
      }
      if (isPastingClipboard) {
        rl.prompt(true);
        return;
      }
      if (pendingImages.length >= 10) {
        safePrint(rl, c.yellow("  [单条消息最多附加 10 张图片，请先回车发送]"));
        return;
      }
      isPastingClipboard = true;
      try {
        const clip = await readClipboardImage();
        const prepared = await prepareImageForUpload(clip.bytes, clip.name);
        if (isMasked) return;
        pendingImages.push(prepared);
        rl.setPrompt(getPrompt());
        safePrint(
          rl,
          `  ${c.cyan(`[已粘贴图片 #${pendingImages.length}]`)} ${c.brightWhite(prepared.originalName)} ${c.gray(`(${prepared.width}x${prepared.height} · ${formatSize(prepared.size)})`)} ${c.dim("— 回车发送，可继续打字配文字，空行按 Backspace 撤销")}`,
        );
      } catch (err) {
        if (!isMasked) {
          safePrint(rl, c.yellow(`  [${err instanceof Error ? err.message : err}]`));
        }
      } finally {
        isPastingClipboard = false;
      }
      return;
    }

    const now = Date.now();
    if (now - lastToggleTime < TOGGLE_COOLDOWN) return;

    const isCtrlB = key.ctrl && (key.name === "b" || str === "\x02");
    const isDoubleEscSeq = key.sequence === "\x1b\x1b";
    const isEsc = key.name === "escape";

    let triggered = false;
    if (isCtrlB || isDoubleEscSeq) {
      triggered = true;
      lastEscTime = 0;
    } else if (isEsc) {
      if (now - lastEscTime <= ESC_DOUBLE_PRESS_INTERVAL) {
        triggered = true;
        lastEscTime = 0;
      } else {
        lastEscTime = now;
      }
    }

    if (triggered) {
      await performMaskToggle();
    }
  };

  process.stdin.on("data", onRawData);
  process.stdin.prependListener("keypress", onBeforeKeypress);
  process.stdin.on("keypress", onKeypress);

  rl.prompt();

  rl.on("line", async (rawLine) => {
    const promptBeforeSubmit = stripVTControlCharacters(getPrompt());
    const line = rawLine.trim();
    if (!line) {
      if (!isMasked && pendingImages.length > 0) {
        const toSend = pendingImages;
        const quote = pendingQuote;
        pendingImages = [];
        pendingQuote = null;
        rl.setPrompt(getPrompt());
        const ok = await sendPreparedImages(toSend, "", { promptText: promptBeforeSubmit, rawLine }, quote?.meta);
        if (!ok) {
          pendingImages = toSend;
          pendingQuote = quote;
          rl.setPrompt(getPrompt());
        }
      }
      rl.prompt();
      return;
    }

    // In masked mode: only unmask triggers restore chat; everything else simulates Codex response!
    if (isMasked) {
      const lower = line.toLowerCase();
      if (["exit", "quit", "q", "unmask", "umk", "um", "chat", ":q", "/unmask", "/umk", "/um", "/chat"].includes(lower)) {
        eraseSubmittedLine(stripVTControlCharacters(getPrompt()), rawLine);
        await exitMaskMode();
        rl.prompt();
        return;
      }

      simulateCodexOutput(line);
      rl.prompt();
      return;
    }

    // Direct fast mask triggers (m, mk, mask, boss) without requiring slash /
    const lower = line.toLowerCase();
    if (lower === "m" || lower === "mk" || lower === "mask" || lower === "boss") {
      eraseSubmittedLine(promptBeforeSubmit, rawLine);
      enterMaskMode();
      rl.prompt();
      return;
    }

    // Auto-detect pasted or dragged local image file paths (just like Codex / AGY / Claude Code)
    // Run BEFORE slash-command matching because POSIX absolute paths start with "/"
    const isExplicitImageCmd = /^\/(pic|sendimg|img|i|view|v|save)\b/i.test(line);
    if (!isExplicitImageCmd) {
      const extracted = extractImagePathsFromLine(line);
      if (extracted.imagePaths.length > 0) {
        const preparedFromPaths: PreparedUploadImage[] = [];
        let prepFailed = false;
        for (const imgPath of extracted.imagePaths) {
          try {
            preparedFromPaths.push(await prepareImageFileForUpload(imgPath));
          } catch (err) {
            console.log(c.red(`  [准备图片失败: ${err instanceof Error ? err.message : err}]`));
            prepFailed = true;
            break;
          }
        }
        if (!prepFailed) {
          const prevPending = pendingImages;
          const prevQuote = pendingQuote;
          const combined = [...prevPending, ...preparedFromPaths];
          pendingImages = [];
          pendingQuote = null;
          rl.setPrompt(getPrompt());
          const ok = await sendPreparedImages(
            combined,
            extracted.caption,
            { promptText: promptBeforeSubmit, rawLine },
            prevQuote?.meta,
          );
          if (!ok) {
            pendingImages = prevPending;
            pendingQuote = prevQuote;
            rl.setPrompt(getPrompt());
          }
        }
        rl.prompt();
        return;
      }
      const trimmedStart = line.replace(/^['"]/, "");
      if ((line.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(trimmedStart) || trimmedStart.startsWith("\\\\")) && looksLikeImageFilePath(line)) {
        console.log(c.red(`  [找不到图片文件: ${line}]`));
        rl.prompt();
        return;
      }
    }

    if (line.startsWith("/")) {
      const [cmd, ...rest] = line.slice(1).split(" ");
      const arg = rest.join(" ").trim();
      eraseSubmittedLine(promptBeforeSubmit, rawLine);

      switch (cmd?.toLowerCase()) {
        case "help":
        case "?":
          console.log("");
          printBorder("可用快捷指令与发图方式");
          console.log(`  ${c.bold(c.brightCyan("Ctrl+V"))}   ${c.cyan("(快捷键)")}      ${c.gray(" ".repeat(14))} 粘贴剪贴板截图/图片到待发区，回车即发 (空行退格撤销)`);
          console.log(`  ${c.bold(c.brightCyan("拖入/粘贴路径"))} ${c.cyan("<图片路径>")}  ${c.gray(" ".repeat(10))} 直接把图片拖进终端或粘贴路径即可发图 (可同行配文字)`);
          console.log(`  ${c.bold(c.brightCyan(":表情名"))}  ${c.cyan("[附带文字]")}     ${c.gray("(如 :doge / :6)")} 极速发送 8-bit 像素表情 (输入 : 按 Tab 补全)`);
          console.log(`  ${c.bold(c.brightCyan(">编号"))}    ${c.cyan("[回复内容]")}     ${c.gray("(如 >3 好的)")}   极速引用 #编号 消息回复 (仅输 >3 进入待引用状态)`);
          console.log(`  ${c.bold(c.brightCyan("@成员"))}    ${c.cyan("(群聊 Tab 补全)")} ${c.gray(" ".repeat(8))} 群聊提及成员或 @all，@到你时高亮并提醒`);
          console.log(`  ${c.bold(c.brightYellow("/reply"))}   ${c.cyan("[编号] [内容]")}  ${c.gray("(简写: /r)")}   引用消息回复 (支持 :表情 / 空行退格取消引用)`);
          console.log(`  ${c.bold(c.brightYellow("/img"))}     ${c.cyan("[编号] [选项]")}  ${c.gray("(简写: /i)")}   终端高清看图 (默认最新; 支持 --open/--thumb/--ascii/ls)`);
          console.log(`  ${c.bold(c.brightYellow("/emo"))}     ${c.cyan("[名称|编号] [字]")} ${c.gray("(简写: /e)")}   预览 8-bit 彩色像素表情面板或发送表情`);
          console.log(`  ${c.bold(c.brightYellow("/view"))}    ${c.cyan("[编号]")}        ${c.gray("(简写: /v)")}   系统 QuickLook / 预览器无损放大原图`);
          console.log(`  ${c.bold(c.brightYellow("/save"))}    ${c.cyan("[编号] [目录]")}  ${c.gray(" ".repeat(12))} 解密并保存原图到本地目录 (默认当前目录)`);
          console.log(`  ${c.bold(c.brightYellow("/autoimg"))} ${c.cyan("[on|off]")}      ${c.gray(" ".repeat(12))} 开启/关闭收到图片时自动内联预览缩略图`);
          console.log(`  ${c.bold(c.brightYellow("/switch"))}  ${c.cyan("<名称|ID>")}     ${c.gray("(简写: /s)")}   切换当前聊天会话`);
          console.log(`  ${c.bold(c.brightYellow("/list"))}    ${c.gray(" ".repeat(13))}   ${c.gray("(简写: /ls)")}  列出全部会话及未读数`);
          console.log(`  ${c.bold(c.brightYellow("/history"))} ${c.cyan("[条数]")}        ${c.gray("(简写: /h)")}   查看最近历史记录 (默认 20 条，支持跨页拉取)`);
          console.log(`  ${c.bold(c.brightYellow("/more"))}    ${c.cyan("[条数]")}        ${c.gray("(简写: /mo)")}  继续往前翻一页更早的历史消息 (默认每次 20 条)`);
          console.log(`  ${c.bold(c.brightYellow("/open"))}    ${c.cyan("<用户名>")}      ${c.gray(" ".repeat(14))} 发起或进入私聊`);
          console.log(`  ${c.bold(c.brightYellow("/group"))}   ${c.cyan("<群名> <成员>")}   ${c.gray(" ".repeat(10))} 创建新群聊`);
          console.log(`  ${c.bold(c.brightYellow("/whoami"))}  ${c.gray(" ".repeat(13))}   ${c.gray(" ".repeat(14))} 查看当前账号、加密与看图协议状态`);
          console.log(`  ${c.bold(c.brightYellow("/mask"))}    ${c.gray(" ".repeat(13))}   ${c.gray("(简写: /mk, /m; 或直接敲 m 回车 / 连按两次Esc / Ctrl+B)")} 极速切换到 Codex 伪装`);
          console.log(`  ${c.bold(c.brightYellow("/unmask"))}  ${c.gray(" ".repeat(13))}   ${c.gray("(简写: /umk, /um; 亦可按两次Esc / Ctrl+B 或输入 exit)")} 退出掩护恢复聊天`);
          console.log(`  ${c.bold(c.brightYellow("/clear"))}   ${c.gray(" ".repeat(13))}   ${c.gray("(简写: /c)")}   清屏并刷新当前会话`);
          console.log(`  ${c.bold(c.brightYellow("/quit"))}    ${c.gray(" ".repeat(13))}   ${c.gray("(简写: /q)")}   退出交互会话`);
          printBorder();
          console.log("");
          break;

        case "reply":
        case "quote":
        case "r": {
          if (!activeConversation) {
            console.log(c.yellow("当前暂无活跃会话，请先输入 /list 或 /open <用户名> 选择会话"));
            break;
          }
          const tokens = arg.split(/\s+/).filter(Boolean);
          const firstToken = tokens[0];
          let entry: IndexedMessage | null = null;
          let replyBody = "";

          if (!firstToken) {
            entry = resolveMessageEntry();
          } else if (/^#?\d+$/.test(firstToken)) {
            entry = resolveMessageEntry(firstToken);
            replyBody = arg.slice(firstToken.length).trim();
          } else {
            entry = resolveMessageEntry();
            replyBody = arg;
          }

          if (!entry) break;
          const meta = toQuotedMetadata(entry);

          if (!replyBody) {
            pendingQuote = { index: entry.index, meta };
            rl.setPrompt(getPrompt());
            console.log(`  ${c.yellow(`[正在引用 #${entry.index}]`)} ${c.gray(`${entry.senderName}: ${entry.preview}`)} ${c.dim("— 直接输入文字/表情/截图发送，空行按 Backspace 取消")}`);
            break;
          }

          const stickerShortcut = parseColonStickerShortcut(replyBody);
          if (stickerShortcut) {
            await sendPixelSticker(stickerShortcut.sticker, stickerShortcut.caption, undefined, meta);
          } else {
            await sendTextMessage(replyBody, undefined, meta);
          }
          break;
        }

        case "emo":
        case "emoji":
        case "art":
        case "e": {
          const tokens = arg.split(/\s+/).filter(Boolean);
          const key = tokens[0];
          if (!key || key.toLowerCase() === "ls" || key.toLowerCase() === "list") {
            console.log("");
            printSectionHeader("8-bit 像素表情库 (/e <名称|编号|中文> [附带文字])");
            const cols = 4;
            const cellWidth = 18;
            for (let rowStart = 0; rowStart < PIXEL_STICKERS.length; rowStart += cols) {
              const rowItems = PIXEL_STICKERS.slice(rowStart, rowStart + cols);
              const headers = rowItems.map((item, offset) => {
                const idx = rowStart + offset + 1;
                const plain = `#${idx} ${item.id} ${item.label}`;
                const styled = `${c.gray(`#${idx}`)} ${c.bold(c.brightYellow(item.id))} ${c.dim(item.label)}`;
                const pad = " ".repeat(Math.max(2, cellWidth - visualWidth(plain)));
                return `${styled}${pad}`;
              });
              console.log(`  ${headers.join("")}`);

              const rendered = rowItems.map((item) => renderPixelStickerLines(item));
              const lineCount = rendered[0]?.length ?? 5;
              for (let r = 0; r < lineCount; r += 1) {
                const cells = rendered.map((lines) => {
                  const spriteLine = lines[r] ?? " ".repeat(10);
                  return `${spriteLine}${" ".repeat(cellWidth - 10)}`;
                });
                console.log(`  ${cells.join("")}`);
              }
              console.log("");
            }
            break;
          }

          if (!activeConversation) {
            console.log(c.yellow("当前暂无活跃会话，请先输入 /list 或 /open <用户名> 选择会话"));
            break;
          }

          const sticker = resolvePixelSticker(key);
          if (!sticker) {
            console.log(c.yellow(`找不到像素表情 "${key}"，输入 /e 查看全部可用表情`));
            break;
          }

          const caption = arg.slice(key.length).trim();
          await sendPixelSticker(sticker, caption);
          break;
        }

        case "pic":
        case "sendimg": {
          if (!arg) {
            console.log(c.gray("提示: 直接拖入/粘贴图片路径回车即可发图，或按 Ctrl+V 粘贴剪贴板截图；也可 /pic <路径> [文字]"));
            break;
          }
          if (arg === "--paste" || arg.startsWith("--paste ")) {
            const caption = arg.slice("--paste".length).trim();
            try {
              const clip = await readClipboardImage();
              const prepared = await prepareImageForUpload(clip.bytes, clip.name);
              await sendPreparedImages([prepared], caption);
            } catch (err) {
              console.log(c.red(`  [读取剪贴板图片失败: ${err instanceof Error ? err.message : err}]`));
            }
            break;
          }
          const { path: imgPath, caption } = parsePathAndCaption(arg);
          try {
            const prepared = await prepareImageFileForUpload(imgPath);
            await sendPreparedImages([prepared], caption);
          } catch (err) {
            console.log(c.red(`  [准备图片失败: ${err instanceof Error ? err.message : err}]`));
          }
          break;
        }

        case "paste":
        case "p": {
          try {
            const clip = await readClipboardImage();
            const prepared = await prepareImageForUpload(clip.bytes, clip.name);
            await sendPreparedImages([prepared], arg);
          } catch (err) {
            console.log(c.red(`  [读取剪贴板图片失败: ${err instanceof Error ? err.message : err}]`));
          }
          break;
        }

        case "img":
        case "i": {
          const tokens = arg.split(/\s+/).filter(Boolean);
          if (tokens[0] === "ls" || tokens[0] === "list") {
            console.log("");
            printSectionHeader("当前会话已加载的图片");
            if (!imageEntries.length) {
              console.log(c.gray("  [暂无已加载图片，可输入 /history 加载更多历史]"));
            } else {
              for (const entry of imageEntries) {
                const dims = entry.attachment.width && entry.attachment.height
                  ? `${entry.attachment.width}x${entry.attachment.height} `
                  : "";
                console.log(
                  `  ${c.bold(c.brightCyan(`#${entry.index}`))} ${c.gray(`[${formatTime(entry.createdAt)}]`)} ${c.brightYellow(entry.senderName)}  ${c.brightWhite(entry.attachment.originalName)} ${c.gray(`(${dims}${formatSize(entry.attachment.size)})`)}`,
                );
              }
            }
            console.log("");
            break;
          }

          let openExternal = false;
          let forceAscii = false;
          let variant: "original" | "thumbnail" = "original";
          let idToken: string | undefined;

          for (const token of tokens) {
            if (token === "--open" || token === "-o") openExternal = true;
            else if (token === "--ascii") forceAscii = true;
            else if (token === "--thumb" || token === "-t") variant = "thumbnail";
            else if (token === "--hd" || token === "--orig") variant = "original";
            else if (!idToken) idToken = token;
          }

          const entry = resolveImageEntry(idToken);
          if (!entry) break;

          try {
            await displayImage(entry, { open: openExternal, variant, forceAscii });
            console.log("");
          } catch (err) {
            console.log(c.red(`  [加载图片 #${entry.index} 失败: ${err instanceof Error ? err.message : err}]`));
          }
          break;
        }

        case "view":
        case "v": {
          const idToken = arg.split(/\s+/).filter(Boolean)[0];
          const entry = resolveImageEntry(idToken);
          if (!entry) break;
          try {
            await displayImage(entry, { open: true });
          } catch (err) {
            console.log(c.red(`  [打开图片 #${entry.index} 失败: ${err instanceof Error ? err.message : err}]`));
          }
          break;
        }

        case "save": {
          const tokens = arg.split(/\s+/).filter(Boolean);
          let idToken: string | undefined;
          let outDir = ".";
          if (tokens.length === 1) {
            if (/^#?\d+$/.test(tokens[0]!)) idToken = tokens[0];
            else outDir = tokens[0]!;
          } else if (tokens.length >= 2) {
            idToken = tokens[0];
            outDir = tokens.slice(1).join(" ");
          }
          const entry = resolveImageEntry(idToken);
          if (!entry) break;
          try {
            const bytes = await loadImageBytes(entry, "original");
            const savedPath = saveImageToDir(bytes, outDir, entry.attachment.originalName, entry.attachment.mimeType);
            console.log(`  ${c.green("已保存")} ${c.cyan(`[图片 #${entry.index}]`)} -> ${c.brightWhite(savedPath)} ${c.gray(`(${formatSize(bytes.length)})`)}`);
          } catch (err) {
            console.log(c.red(`  [保存图片 #${entry.index} 失败: ${err instanceof Error ? err.message : err}]`));
          }
          break;
        }

        case "autoimg": {
          const mode = arg.toLowerCase();
          if (!mode) {
            autoImg = !autoImg;
          } else if (mode === "on" || mode === "1" || mode === "true") {
            autoImg = true;
          } else if (mode === "off" || mode === "0" || mode === "false") {
            autoImg = false;
          } else {
            console.log(c.gray("用法: /autoimg [on|off]"));
            break;
          }
          console.log(
            `  收到新图片自动内联预览: ${autoImg ? c.bold(c.brightGreen("已开启")) : c.gray("已关闭")} ${c.gray(`(当前协议: ${protocolLabel(detectImageProtocol())})`)}`,
          );
          break;
        }

        case "mask":
        case "mk":
        case "m":
        case "stealth":
        case "boss":
          enterMaskMode();
          break;

        case "unmask":
        case "umk":
        case "um":
        case "chat":
          await exitMaskMode();
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
            const rawLast = item.lastMessage?.text;
            const parsedLastPixel = rawLast ? parsePixelStickerMessage(rawLast) : null;
            const lastText = parsedLastPixel
              ? c.cyan(` — [表情:${parsedLastPixel.sticker.label}]${parsedLastPixel.caption ? ` ${parsedLastPixel.caption}` : ""}`)
              : rawLast
              ? c.gray(` — ${rawLast.includes("\n") ? (rawLast.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "[多行消息]") : rawLast}`)
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
            if (activeConversation?.id !== targetConv.id) resetImages();
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

        case "more":
        case "mo":
        case "prev":
        case "older": {
          if (!activeConversation) {
            console.log(c.yellow("暂无活跃会话，请先 /list 选择会话"));
            break;
          }
          const moreCount = arg ? parseInt(arg, 10) : 20;
          await showOlderHistory(activeConversation, isNaN(moreCount) || moreCount <= 0 ? 20 : moreCount);
          break;
        }

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
            const nextConv = conversations.find((item) => item.id === res.id) || conversations[0];
            if (activeConversation?.id !== nextConv?.id) resetImages();
            activeConversation = nextConv;
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
            const nextGroup = conversations.find((item) => item.id === created.id);
            if (activeConversation?.id !== nextGroup?.id) resetImages();
            activeConversation = nextGroup;
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
          console.log(`  ${c.dim("看图协议:".padEnd(8))} ${c.cyan(protocolLabel(detectImageProtocol()))} ${c.gray(`(自动预览: ${autoImg ? "开" : "关"})`)}`);
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
          previewManager.cleanup();
          imageCache.clear();
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

    // Normal message sending (or pending Ctrl+V images + accompanying text)
    if (!activeConversation) {
      console.log(c.yellow("当前暂无活跃会话，请先输入 /list 或 /open <用户名> 选择会话"));
      rl.prompt();
      return;
    }

    if (pendingImages.length > 0) {
      const toSend = pendingImages;
      const quote = pendingQuote;
      pendingImages = [];
      pendingQuote = null;
      rl.setPrompt(getPrompt());
      const ok = await sendPreparedImages(toSend, line, { promptText: promptBeforeSubmit, rawLine }, quote?.meta);
      if (!ok) {
        pendingImages = toSend;
        pendingQuote = quote;
        rl.setPrompt(getPrompt());
      }
      rl.prompt();
      return;
    }

    // Fast Markdown-style quote shortcut (e.g. >3 好的, >3 :ok, or >3 to arm pending quote)
    const quickQuote = parseQuickQuoteShortcut(line);
    if (quickQuote) {
      const entry = resolveMessageEntry(quickQuote.targetToken);
      if (entry) {
        const meta = toQuotedMetadata(entry);
        if (!quickQuote.body) {
          eraseSubmittedLine(promptBeforeSubmit, rawLine);
          pendingQuote = { index: entry.index, meta };
          rl.setPrompt(getPrompt());
          console.log(`  ${c.yellow(`[正在引用 #${entry.index}]`)} ${c.gray(`${entry.senderName}: ${entry.preview}`)} ${c.dim("— 直接输入文字/表情/截图发送，空行按 Backspace 取消")}`);
        } else {
          const stickerShortcut = parseColonStickerShortcut(quickQuote.body);
          if (stickerShortcut) {
            await sendPixelSticker(stickerShortcut.sticker, stickerShortcut.caption, { promptText: promptBeforeSubmit, rawLine }, meta);
          } else {
            await sendTextMessage(quickQuote.body, { promptText: promptBeforeSubmit, rawLine }, meta);
          }
        }
      }
      rl.prompt();
      return;
    }

    // Fast colon shortcut for pixel stickers (e.g. :doge, :ok 收到, :6, :狗头)
    const colonSticker = parseColonStickerShortcut(line);
    if (colonSticker) {
      const quote = pendingQuote;
      pendingQuote = null;
      rl.setPrompt(getPrompt());
      const ok = await sendPixelSticker(
        colonSticker.sticker,
        colonSticker.caption,
        { promptText: promptBeforeSubmit, rawLine },
        quote?.meta,
      );
      if (!ok && quote) {
        pendingQuote = quote;
        rl.setPrompt(getPrompt());
      }
      rl.prompt();
      return;
    }

    const activeQuote = pendingQuote;
    pendingQuote = null;
    rl.setPrompt(getPrompt());
    const sentOk = await sendTextMessage(line, { promptText: promptBeforeSubmit, rawLine }, activeQuote?.meta);
    if (!sentOk && activeQuote) {
      pendingQuote = activeQuote;
      rl.setPrompt(getPrompt());
    }

    rl.prompt();
  });

  rl.on("close", () => {
    process.off("exit", onProcessExit);
    previewManager.cleanup();
    imageCache.clear();
    pendingImages = [];
    process.stdin.off("data", onRawData);
    process.stdin.off("keypress", onBeforeKeypress);
    process.stdin.off("keypress", onKeypress);
    socket.disconnect();
    console.log(`\n${c.gray("已退出 Chat Lite CLI。")}`);
    process.exit(0);
  });
}
