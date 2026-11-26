import assert from "node:assert/strict";
import test from "node:test";
import { decryptedLine, previewOf } from "./format";
import {
  PIXEL_STICKERS,
  completeColonSticker,
  encodePixelStickerMessage,
  parseColonStickerShortcut,
  parsePixelStickerMessage,
  renderPixelStickerLines,
  resolvePixelSticker,
} from "./pixel";

test("PIXEL_STICKERS 每个贴纸网格尺寸严格一致（10x10 偶数行）", () => {
  for (const sticker of PIXEL_STICKERS) {
    assert.equal(sticker.grid.length, 10, `${sticker.id} should be 10px tall`);
    for (const row of sticker.grid) {
      assert.equal(row.length, 10, `${sticker.id} rows should be 10px wide`);
    }
  }
});

test("resolvePixelSticker 支持 ID、编号和中文别名查找", () => {
  assert.equal(resolvePixelSticker("doge")?.id, "doge");
  assert.equal(resolvePixelSticker("狗头")?.id, "doge");
  assert.equal(resolvePixelSticker("1")?.id, "smile");
  assert.equal(resolvePixelSticker("#8")?.id, "fire");
  assert.equal(resolvePixelSticker("unknown"), null);
});

test("encodePixelStickerMessage 与 parsePixelStickerMessage 往返一致", () => {
  const fire = resolvePixelSticker("fire")!;
  const encoded = encodePixelStickerMessage(fire, "线上炸了");
  assert.equal(encoded, "[px:fire] 线上炸了");

  const parsed = parsePixelStickerMessage(encoded);
  assert.equal(parsed?.sticker.id, "fire");
  assert.equal(parsed?.caption, "线上炸了");
  assert.equal(parsePixelStickerMessage("普通消息"), null);
});

test("renderPixelStickerLines 渲染 5 行 24-bit 真彩色半块字符（透明背景使用 49m）", () => {
  const heart = resolvePixelSticker("heart")!;
  const colored = renderPixelStickerLines(heart, { color: true });
  assert.equal(colored.length, 5);
  assert.ok(colored.some((line) => line.includes("\x1b[38;2;") || line.includes("\x1b[49;38;2;")));
  assert.ok(colored.every((line) => line.endsWith("\x1b[0m")));

  const mono = renderPixelStickerLines(heart, { color: false });
  assert.equal(mono.length, 5);
  assert.equal(mono.some((line) => line.includes("\x1b[")), false);
});

test("decryptedLine 渲染像素贴纸消息，previewOf 返回简洁中文摘要", () => {
  const me = { id: "u1", username: "demo", displayName: "Demo" };
  const msg = {
    message: {
      id: "m1",
      clientId: "c1",
      conversationId: "conv1",
      text: "[px:doge] 摸鱼中",
      createdAt: new Date().toISOString(),
      sender: me,
      attachments: [],
    },
    content: { text: "[px:doge] 摸鱼中", attachments: [] },
  };

  const line = decryptedLine(msg, me);
  assert.equal(line.split("\n").length, 6);
  assert.ok(line.includes("摸鱼中"));
  assert.equal(previewOf(msg), "[表情:狗头] 摸鱼中");
});

test("parseColonStickerShortcut 与 completeColonSticker 支持 :doge / :6 / :狗头 快捷发图", () => {
  assert.equal(parseColonStickerShortcut(":doge")?.sticker.id, "doge");
  assert.equal(parseColonStickerShortcut(":doge:")?.sticker.id, "doge");
  const withCaption = parseColonStickerShortcut(":fire 线上炸了");
  assert.equal(withCaption?.sticker.id, "fire");
  assert.equal(withCaption?.caption, "线上炸了");
  assert.equal(parseColonStickerShortcut(":狗头 摸鱼")?.sticker.id, "doge");
  assert.equal(parseColonStickerShortcut(":6 收到")?.sticker.id, "ok");
  assert.equal(parseColonStickerShortcut(":unknown"), null);
  assert.equal(parseColonStickerShortcut(":q"), null);

  const comp = completeColonSticker(":d");
  assert.deepEqual(comp, [[":doge"], ":d"]);
});
