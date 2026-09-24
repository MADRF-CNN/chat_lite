import type { ConversationDto, UserSummary } from "@chat-lite/shared";
import type { DecryptedMessage } from "./crypto";
import { c } from "./color";

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

function attachmentSummary(decrypted: DecryptedMessage) {
  return (decrypted.content?.attachments ?? []).map((item) => c.cyan(`[图片 ${item.originalName} ${formatSize(item.size)}]`)).join(" ");
}

export function decryptedLine(decrypted: DecryptedMessage, me: UserSummary, showId = false) {
  const own = decrypted.message.sender.id === me.id;
  const timeStr = c.gray(`[${formatTime(decrypted.message.createdAt)}]`);
  const nameStr = own
    ? c.bold(c.cyan(`${decrypted.message.sender.displayName}(我)`))
    : c.bold(c.brightYellow(decrypted.message.sender.displayName));
  const idStr = showId ? c.gray(` (${shortId(decrypted.message.id)})`) : "";
  const bodyText = decrypted.message.text ? c.brightWhite(decrypted.message.text) : "";
  const body = [bodyText, attachmentSummary(decrypted)].filter(Boolean).join(" ");
  return `${timeStr} ${nameStr}${idStr}: ${body || c.gray("[空消息]")}`;
}

export function previewOf(decrypted: DecryptedMessage) {
  return decrypted.message.text ?? ((decrypted.content?.attachments.length ?? 0) ? "[图片]" : "[空消息]");
}
