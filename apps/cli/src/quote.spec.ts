import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationDto, UserSummary } from "@chat-lite/shared";
import { decryptedLine, parseQuickQuoteShortcut, quotePreviewOf } from "./format";

const me: UserSummary = { id: "u1", username: "demo", displayName: "小莫" };
const alice: UserSummary = { id: "u2", username: "alice", displayName: "Alice" };
const groupConv: ConversationDto = {
  id: "g1",
  type: "GROUP",
  name: "研发群",
  ownerId: "u1",
  members: [me, alice],
  lastMessage: null,
  unreadCount: 0,
  updatedAt: new Date().toISOString(),
};

test("parseQuickQuoteShortcut 支持 >3 好的、>#3 :ok 与仅 >3 待引用，不误伤普通 > 100", () => {
  assert.deepEqual(parseQuickQuoteShortcut(">3 好的马上看"), { targetToken: "3", body: "好的马上看" });
  assert.deepEqual(parseQuickQuoteShortcut(">#12 :ok"), { targetToken: "12", body: ":ok" });
  assert.deepEqual(parseQuickQuoteShortcut(">5"), { targetToken: "5", body: "" });
  assert.equal(parseQuickQuoteShortcut("> 3 数学大于"), null);
  assert.equal(parseQuickQuoteShortcut(">= 100"), null);
  assert.equal(parseQuickQuoteShortcut("普通消息"), null);
});

test("quotePreviewOf 对纯文本、像素表情、图片和超长文本生成单行引用摘要", () => {
  const base = {
    id: "m1",
    clientId: "c1",
    conversationId: "g1",
    createdAt: new Date().toISOString(),
    sender: alice,
    attachments: [],
  };
  assert.equal(
    quotePreviewOf({ message: { ...base, text: "[px:doge] 摸鱼" }, content: { text: "[px:doge] 摸鱼", attachments: [] } }),
    "[表情:狗头] 摸鱼",
  );
  assert.equal(
    quotePreviewOf({
      message: { ...base, text: null, attachments: [{ id: "a1", originalName: "err.png", mimeType: "image/png", width: 10, height: 10, size: 100 }] },
      content: { text: undefined, attachments: [{ id: "a1", originalName: "err.png", mimeType: "image/png", width: 10, height: 10, size: 100, originalNonce: "n", thumbnailNonce: "t" }] },
    }),
    "[图片 err.png]",
  );
  const longText = "一".repeat(80);
  const clipped = quotePreviewOf({ message: { ...base, text: longText }, content: { text: longText, attachments: [] } }, 20);
  assert.equal(clipped.length, 20);
  assert.ok(clipped.endsWith("…"));
});

test("decryptedLine 正确渲染消息编号 #N 与底部引用行 └ 引用 ...", () => {
  const msg = {
    message: {
      id: "m2",
      clientId: "c2",
      conversationId: "g1",
      text: "收到，马上改 @alice",
      createdAt: new Date().toISOString(),
      sender: me,
      attachments: [],
    },
    content: {
      text: "收到，马上改 @alice",
      attachments: [],
      replyTo: { id: "m1", senderName: "Alice", preview: "今天三点发版吗？" },
    },
  };
  const rendered = decryptedLine(msg, me, false, undefined, groupConv, 4);
  const lines = rendered.split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[0]!.includes("#4"));
  assert.ok(lines[0]!.includes("收到，马上改"));
  assert.ok(lines[1]!.includes("└"));
  assert.ok(lines[1]!.includes("引用 Alice: 今天三点发版吗？"));
});
