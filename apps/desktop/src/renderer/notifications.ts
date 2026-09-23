import type { MessageDto } from "@chat-lite/shared";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

type NotificationContext = {
  currentUserId: string;
  selectedConversationId?: string;
  windowFocused: boolean;
};

let permissionRequested = false;

function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

export function shouldNotifyIncoming(message: MessageDto, context: NotificationContext) {
  if (message.sender.id === context.currentUserId) return false;
  return !context.windowFocused || message.conversationId !== context.selectedConversationId;
}

export async function isChatWindowFocused() {
  if (!isTauri()) return document.hasFocus();
  try { return await getCurrentWindow().isFocused(); }
  catch { return false; }
}

export async function ensureNotificationPermission() {
  if (!isTauri()) return false;
  try {
    if (await isPermissionGranted()) return true;
    if (permissionRequested) return false;
    permissionRequested = true;
    return await requestPermission() === "granted";
  } catch {
    return false;
  }
}

export async function notifyIncomingMessage(message: MessageDto, conversationName: string) {
  if (!await ensureNotificationPermission()) return;
  sendNotification({
    title: `${message.sender.displayName} · ${conversationName}`,
    body: message.attachments.length ? "收到一条加密图片消息" : "收到一条加密消息",
  });
}
