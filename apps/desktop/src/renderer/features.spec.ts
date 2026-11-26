import { describe, expect, it } from "vitest";
import type { ConversationDto, UserSummary } from "@chat-lite/shared";
import { extractMentionQuery, findMentionSpans, isMentioningMe } from "./mention";
import { encodePixelStickerMessage, formatMessagePreview, parseColonStickerShortcut, parsePixelStickerMessage, PIXEL_STICKERS } from "./pixel";

const me: UserSummary = { id: "u1", username: "demo", displayName: "小莫" };
const alice: UserSummary = { id: "u2", username: "alice", displayName: "爱丽丝" };
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

describe("desktop pixel stickers", () => {
  it("supports 12 10x10 stickers, colon shortcut and preview formatting", () => {
    expect(PIXEL_STICKERS.length).toBe(12);
    for (const s of PIXEL_STICKERS) {
      expect(s.grid.length).toBe(10);
      expect(s.grid.every((row) => row.length === 10)).toBe(true);
    }

    const sc = parseColonStickerShortcut(":doge 摸鱼中");
    expect(sc?.sticker.id).toBe("doge");
    expect(sc?.caption).toBe("摸鱼中");

    const encoded = encodePixelStickerMessage(sc!.sticker, sc!.caption);
    expect(encoded).toBe("[px:doge] 摸鱼中");
    expect(parsePixelStickerMessage(encoded)?.sticker.id).toBe("doge");
    expect(formatMessagePreview(encoded)).toBe("[表情:狗头] 摸鱼中");
  });
});

describe("desktop group mentions", () => {
  it("highlights @me, @all and @other without false positives on email", () => {
    const spans = findMentionSpans("@demo 和 @alice 看下 @all，邮箱 a@demo.com", me, groupConv.members);
    expect(spans.map((s) => [s.raw, s.target])).toEqual([
      ["@demo", "me"],
      ["@alice", "other"],
      ["@all", "all"],
    ]);
    expect(isMentioningMe("hello @小莫", me, groupConv)).toBe(true);
    expect(isMentioningMe("hello @alice", me, groupConv)).toBe(false);
  });

  it("extracts autocomplete candidates at caret in group chat", () => {
    const q = extractMentionQuery("请 @a", 4, groupConv, me.id);
    expect(q?.candidates.map((c) => c.token)).toEqual(["all", "alice"]);
  });
});
