import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationDto, UserSummary } from "@chat-lite/shared";
import { completeGroupMention, findMentionSpans, highlightMentions, isMentioningMe } from "./mention";

const me: UserSummary = { id: "u1", username: "demo", displayName: "小莫" };
const alice: UserSummary = { id: "u2", username: "alice", displayName: "爱丽丝" };
const bob: UserSummary = { id: "u3", username: "bob", displayName: "Bob" };

const groupConv: ConversationDto = {
  id: "g1",
  type: "GROUP",
  name: "前端研发群",
  ownerId: "u1",
  members: [me, alice, bob],
  lastMessage: null,
  unreadCount: 0,
  updatedAt: new Date().toISOString(),
};

const directConv: ConversationDto = {
  id: "d1",
  type: "DIRECT",
  name: null,
  ownerId: null,
  members: [me, alice],
  lastMessage: null,
  unreadCount: 0,
  updatedAt: new Date().toISOString(),
};

test("findMentionSpans 准确识别 @我、@all、@其他成员，不误伤邮箱", () => {
  const spans = findMentionSpans("请 @demo 和 @alice 看看，邮箱 test@demo.com 不算，@all 注意", me, groupConv.members);
  assert.deepEqual(
    spans.map((s) => ({ raw: s.raw, target: s.target })),
    [
      { raw: "@demo", target: "me" },
      { raw: "@alice", target: "other" },
      { raw: "@all", target: "all" },
    ],
  );
});

test("findMentionSpans 支持中文显示名 @小莫 与 @所有人，不部分匹配前缀", () => {
  const spans = findMentionSpans("@小莫 来看下 @所有人，注意 @bob123 不是 bob", me, groupConv.members);
  assert.deepEqual(
    spans.map((s) => ({ raw: s.raw, target: s.target })),
    [
      { raw: "@小莫", target: "me" },
      { raw: "@所有人", target: "all" },
    ],
  );
});

test("isMentioningMe 仅在群聊中触发 @我 或 @all 提醒", () => {
  assert.equal(isMentioningMe("hello @demo", me, groupConv), true);
  assert.equal(isMentioningMe("hello @所有人", me, groupConv), true);
  assert.equal(isMentioningMe("hello @alice", me, groupConv), false);
  assert.equal(isMentioningMe("hello @demo", me, directConv), false);
});

test("highlightMentions 保持原始文本完整并高亮提及片段", () => {
  const res = highlightMentions("请 @alice 和 @demo 看一下", me, groupConv.members, (s) => s);
  assert.ok(res.includes("@alice"));
  assert.ok(res.includes("@demo"));
});

test("completeGroupMention 在群聊句中自动补全 @成员 和 @all", () => {
  const res1 = completeGroupMention("请 @a", groupConv, me.id);
  assert.ok(res1);
  assert.deepEqual(res1[0], ["请 @all ", "请 @alice "]);

  const res2 = completeGroupMention("@b", groupConv, me.id);
  assert.ok(res2);
  assert.deepEqual(res2[0], ["@bob "]);

  // Direct chats don't trigger group mention completion
  assert.equal(completeGroupMention("@a", directConv, me.id), null);
});
