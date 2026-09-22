import { BadRequestException } from "@nestjs/common";
import { MessagesService } from "../src/messages/messages.service";

describe("MessagesService end-to-end encryption enforcement", () => {
  const conversations = { assertMember: jest.fn().mockResolvedValue({}) };
  const realtime = { emitMessage: jest.fn(), emitConversationChanged: jest.fn() };

  it("rejects newly submitted plaintext messages", async () => {
    const service = new MessagesService({} as never, conversations as never, realtime as never);
    await expect(service.send("conversation", "sender", {
      clientId: "client-message-id",
      text: "plaintext",
      attachmentIds: [],
    })).rejects.toThrow("服务器只接受端到端加密消息");
  });

  it("rejects a stale key that does not cover current members", async () => {
    const prisma = {
      message: { findUnique: jest.fn().mockResolvedValue(null) },
      conversationKey: { findFirst: jest.fn().mockResolvedValue({ version: 1, envelopes: [{ userId: "sender" }] }) },
      conversationMember: { findMany: jest.fn().mockResolvedValue([{ userId: "sender" }, { userId: "recipient" }]) },
    };
    const service = new MessagesService(prisma as never, conversations as never, realtime as never);
    await expect(service.send("conversation", "sender", {
      clientId: "client-message-id",
      ciphertext: "A".repeat(32),
      nonce: "B".repeat(16),
      keyVersion: 1,
      attachmentIds: [],
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});
