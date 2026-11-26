import type { ConversationDto, QuotedMessageMetadata, UserSummary } from "@chat-lite/shared";
import type { DecryptedMessage } from "./crypto";
import { c } from "./color";
import { highlightMentions, isMentioningMe } from "./mention";
import { parsePixelStickerMessage, renderPixelSticker } from "./pixel";

export function shortId(id: string) {
  return id.slice(0, 8);
}

export function formatTime(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay ? time : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function conversationLine(conversation: ConversationDto, me: UserSummary, preview: string | null) {
  const title = conversation.type === "GROUP" ? conversation.name ?? "未命名群聊" : conversation.members.find((member) => member.id !== me.id)?.displayName ?? "私聊";
  const kind = conversation.type === "GROUP" ? c.blue("[群聊]") : c.magenta("[私聊]");
  const unread = conversation.unreadCount ? c.bold(c.brightRed(` · ${conversation.unreadCount} 条未读`)) : "";
  const suffix = preview ? c.gray(` — ${preview}`) : "";
  return `${c.gray(`[${shortId(conversation.id)}]`)} ${kind} ${c.bold(title)}${unread}${suffix}`;
}

function attachmentSummary(decrypted: DecryptedMessage, imageIndex?: (attachmentId: string) => number | undefined) {
  return (decrypted.content?.attachments ?? []).map((item) => {
    const idx = imageIndex?.(item.id);
    const badge = idx !== undefined ? `${c.bold(c.brightCyan(`#${idx}`))} ` : "";
    return `${c.cyan("[图片 ")}${badge}${c.cyan(`${item.originalName} ${formatSize(item.size)}]`)}`;
  }).join(" ");
}

export function formatMultilineBody(text: string, indent = "    "): string {
  return text
    .split(/\r?\n/)
    .map((line) => `${indent}${c.brightCyan(line)}`)
    .join("\n");
}

export function formatQuoteBlock(replyTo: QuotedMessageMetadata, indent = "      "): string {
  const safePreview = replyTo.preview.replace(/\r?\n/g, " ").trim();
  return `${indent}${c.dim("└")} ${c.gray(`引用 ${replyTo.senderName}: ${safePreview}`)}`;
}

export function quotePreviewOf(decrypted: DecryptedMessage, maxLen = 60): string {
  const rawText = decrypted.message.text?.trim() ?? "";
  const attachments = decrypted.content?.attachments ?? decrypted.message.attachments ?? [];
  let textPart = "";
  if (rawText) {
    const pixelMsg = parsePixelStickerMessage(rawText);
    if (pixelMsg) {
      textPart = pixelMsg.caption ? `[表情:${pixelMsg.sticker.label}] ${pixelMsg.caption}` : `[表情:${pixelMsg.sticker.label}]`;
    } else {
      textPart = rawText.replace(/\r?\n+/g, " ").trim();
    }
  }
  const imgPart = attachments.length > 0
    ? (attachments.length === 1 ? `[图片 ${attachments[0]!.originalName}]` : `[${attachments.length}张图片]`)
    : "";
  const combined = [textPart, imgPart].filter(Boolean).join(" ") || "[消息]";
  if (combined.length <= maxLen) return combined;
  return `${combined.slice(0, Math.max(1, maxLen - 1))}…`;
}

export function parseQuickQuoteShortcut(line: string): { targetToken: string; body: string } | null {
  const trimmed = line.trim();
  const match = trimmed.match(/^>#?(\d+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return {
    targetToken: match[1]!,
    body: (match[2] ?? "").trim(),
  };
}

export function decryptedLine(
  decrypted: DecryptedMessage,
  me: UserSummary,
  showId = false,
  imageIndex?: (attachmentId: string) => number | undefined,
  conversation?: ConversationDto,
  messageIndex?: number,
) {
  const own = decrypted.message.sender.id === me.id;
  const idxPrefix = messageIndex !== undefined ? `${c.dim(`#${messageIndex}`)} ` : "";
  const timeStr = c.gray(`[${formatTime(decrypted.message.createdAt)}]`);
  const nameStr = own
    ? c.bold(c.cyan(`${decrypted.message.sender.displayName}(我)`))
    : c.bold(c.brightYellow(decrypted.message.sender.displayName));
  const idStr = showId ? c.gray(` (${shortId(decrypted.message.id)})`) : "";
  const rawText = decrypted.message.text ?? "";
  const attachments = attachmentSummary(decrypted, imageIndex);
  const isGroup = conversation?.type === "GROUP";
  const groupMembers = isGroup ? conversation.members : [];
  const styleText = (text: string) => (isGroup ? highlightMentions(text, me, groupMembers) : c.brightWhite(text));
  const pingBadge = !own && isGroup && isMentioningMe(rawText, me, conversation)
    ? `${c.alertBadge(" @你 ")} `
    : "";
  const replyTo = decrypted.content?.replyTo;
  const quoteLine = replyTo ? `\n${formatQuoteBlock(replyTo)}` : "";

  const pixelMsg = rawText ? parsePixelStickerMessage(rawText) : null;
  if (pixelMsg) {
    const captionPart = pixelMsg.caption ? ` ${styleText(pixelMsg.caption)}` : "";
    const tag = c.dim(`[${pixelMsg.sticker.label}]`);
    const headerSuffix = [captionPart, attachments ? ` ${attachments}` : ""].join("");
    const artBlock = renderPixelSticker(pixelMsg.sticker, "      ");
    return `${idxPrefix}${pingBadge}${timeStr} ${nameStr}${idStr}: ${tag}${headerSuffix}${quoteLine}\n${artBlock}`;
  }

  if (rawText.includes("\n")) {
    const headerSuffix = attachments ? ` ${attachments}` : "";
    return `${idxPrefix}${pingBadge}${timeStr} ${nameStr}${idStr}:${headerSuffix}${quoteLine}\n${formatMultilineBody(rawText)}`;
  }

  const bodyText = rawText ? styleText(rawText) : "";
  const body = [bodyText, attachments].filter(Boolean).join(" ");
  return `${idxPrefix}${pingBadge}${timeStr} ${nameStr}${idStr}: ${body || c.gray("[空消息]")}${quoteLine}`;
}

export function previewOf(decrypted: DecryptedMessage) {
  const text = decrypted.message.text;
  if (text) {
    const pixelMsg = parsePixelStickerMessage(text);
    if (pixelMsg) {
      return pixelMsg.caption ? `[表情:${pixelMsg.sticker.label}] ${pixelMsg.caption}` : `[表情:${pixelMsg.sticker.label}]`;
    }
    if (text.includes("\n")) {
      const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
      return firstLine.slice(0, 28) || "[多行消息]";
    }
    return text;
  }
  return (decrypted.content?.attachments.length ?? 0) ? "[图片]" : "[空消息]";
}
