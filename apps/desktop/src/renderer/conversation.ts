import type { ConversationDto, UserSummary } from "@chat-lite/shared";

export function conversationTitle(conversation: ConversationDto, me: UserSummary) {
  if (conversation.type === "GROUP") return conversation.name ?? "未命名群聊";
  return conversation.members.find((member) => member.id !== me.id)?.displayName ?? "私聊";
}
