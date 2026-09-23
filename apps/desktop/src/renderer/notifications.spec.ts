import { describe, expect, it } from "vitest";
import type { MessageDto } from "@chat-lite/shared";
import { shouldNotifyIncoming } from "./notifications";

const message = {
  id: "m1", clientId: "client-1", conversationId: "c1", text: "hello", createdAt: new Date(0).toISOString(),
  sender: { id: "other", username: "alice", displayName: "Alice" }, attachments: [],
} satisfies MessageDto;

describe("shouldNotifyIncoming", () => {
  it("notifies when the app is unfocused", () => expect(shouldNotifyIncoming(message, { currentUserId: "me", selectedConversationId: "c1", windowFocused: false })).toBe(true));
  it("notifies when another conversation is selected", () => expect(shouldNotifyIncoming(message, { currentUserId: "me", selectedConversationId: "c2", windowFocused: true })).toBe(true));
  it("does not notify while viewing the conversation", () => expect(shouldNotifyIncoming(message, { currentUserId: "me", selectedConversationId: "c1", windowFocused: true })).toBe(false));
  it("does not notify for the current user's own message", () => expect(shouldNotifyIncoming({ ...message, sender: { ...message.sender, id: "me" } }, { currentUserId: "me", windowFocused: false })).toBe(false));
});
