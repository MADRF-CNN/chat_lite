import { describe, expect, it } from "vitest";
import type { ConversationDto, UserSummary } from "@chat-lite/shared";
import { conversationTitle } from "./conversation";

const me: UserSummary = { id: "me", username: "me", displayName: "Me" };
const base: ConversationDto = { id: "c", type: "DIRECT", name: null, ownerId: null, members: [me, { id: "u2", username: "alice", displayName: "Alice" }], lastMessage: null, unreadCount: 0, updatedAt: new Date(0).toISOString() };

describe("conversationTitle", () => {
  it("uses the other participant for direct conversations", () => expect(conversationTitle(base, me)).toBe("Alice"));
  it("uses the explicit group name", () => expect(conversationTitle({ ...base, type: "GROUP", name: "Design" }, me)).toBe("Design"));
});
