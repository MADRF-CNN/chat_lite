import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ConversationDto, ServerToClientEvents } from "@chat-lite/shared";
import type { Client } from "./client";
import { decryptedLine } from "./format";
import { fail, info } from "./log";

export async function watch(client: Client, autoRead: boolean) {
  const conversations = new Map<string, ConversationDto>();
  const joined = new Set<string>();
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(client.apiUrl, { auth: { token: client.accessToken } });

  function join(conversationId: string) {
    if (joined.has(conversationId)) return;
    joined.add(conversationId);
    socket.emit("conversation:join", conversationId);
  }

  async function sync() {
    for (const conversation of await client.listConversations()) conversations.set(conversation.id, conversation);
    for (const id of conversations.keys()) join(id);
  }

  await sync();

  socket.on("connect", () => {
    info(`已连接 ${client.apiUrl}，正在监听新消息（Ctrl+C 退出）`);
    joined.clear();
    for (const id of conversations.keys()) join(id);
  });

  socket.on("connect_error", async (error: Error) => {
    if (await client.renewSession()) {
      socket.auth = { token: client.accessToken };
      socket.connect();
      return;
    }
    fail(`连接失败：${error.message}；请重新执行 chat-lite login`);
  });

  socket.on("message:new", async (message) => {
    const conversation = conversations.get(message.conversationId);
    if (!conversation) {
      await sync();
      return;
    }
    const decrypted = await client.e2ee.decryptMessage(message, conversation);
    info(decryptedLine(decrypted, client.user));
    if (autoRead && message.sender.id !== client.user.id) await client.markRead(conversation.id, message.id).catch(() => undefined);
  });

  const resync = async () => {
    conversations.clear();
    await sync();
  };

  socket.on("membership:changed", () => void resync());
  socket.on("conversation:updated", (conversationId) => {
    if (conversations.has(conversationId)) join(conversationId);
    else void resync();
  });

  process.on("SIGINT", () => {
    socket.close();
    info("\n已停止监听");
    process.exit(0);
  });
}
