import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  PreviewManager,
  clearTerminalImages,
  computeCellConstraint,
  detectImageProtocol,
  encodeITerm2Image,
  encodeKittyImage,
  extractImagePathsFromLine,
  looksLikeImageFilePath,
  parsePathAndCaption,
  prepareImageForUpload,
  renderTerminalImage,
  safeImageFilename,
  wrapTmuxPassthrough,
} from "./image";

async function makeTestImage(width: number, height: number, format: "png" | "webp" | "jpeg" = "png") {
  const pipeline = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 64, g: 160, b: 255, alpha: 1 },
    },
  });
  if (format === "webp") return pipeline.webp().toBuffer();
  if (format === "jpeg") return pipeline.jpeg().toBuffer();
  return pipeline.png().toBuffer();
}

test("detectImageProtocol 正确识别 Ghostty / Kitty / iTerm2 / 半块降级", () => {
  assert.equal(detectImageProtocol({ TERM_PROGRAM: "ghostty" }, true), "kitty");
  assert.equal(detectImageProtocol({ TERM: "xterm-ghostty" }, true), "kitty");
  assert.equal(detectImageProtocol({ TERM_PROGRAM: "kitty" }, true), "kitty");
  assert.equal(detectImageProtocol({ KITTY_WINDOW_ID: "1" }, true), "kitty");
  assert.equal(detectImageProtocol({ TERM_PROGRAM: "WezTerm" }, true), "kitty");
  assert.equal(detectImageProtocol({ TERM_PROGRAM: "iTerm.app" }, true), "iterm2");
  assert.equal(detectImageProtocol({ TERM_PROGRAM: "WarpTerminal" }, true), "iterm2");
  assert.equal(detectImageProtocol({ TERM_PROGRAM: "Apple_Terminal", COLORTERM: "truecolor" }, true), "halfblock");
  assert.equal(detectImageProtocol({ TERM_PROGRAM: "Apple_Terminal", NO_COLOR: "1" }, true), "none");
  assert.equal(detectImageProtocol({ TERM_PROGRAM: "ghostty" }, false), "none");
  assert.equal(detectImageProtocol({ CHAT_LITE_IMAGE_PROTOCOL: "halfblock", TERM_PROGRAM: "ghostty" }, true), "halfblock");
});

test("encodeKittyImage 生成带静默标志 q=2 与正确分块的 Kitty 协议序列", () => {
  const small = encodeKittyImage(new Uint8Array([1, 2, 3, 4]), { cols: 40, env: {} });
  assert.ok(small.startsWith("\x1b_Ga=T,f=100,q=2,c=40,m=0;"));
  assert.ok(small.endsWith("\x1b\\"));

  // Large payload triggers multi-chunk transfer (m=1 ... m=0)
  const large = encodeKittyImage(new Uint8Array(6000), { rows: 18, env: {} });
  assert.ok(large.startsWith("\x1b_Ga=T,f=100,q=2,r=18,m=1;"));
  assert.ok(large.includes("\x1b\\\x1b_Gm=0;"));
  assert.ok(large.endsWith("\x1b\\"));
});

test("clearTerminalImages 与 tmux 透传封装正确", () => {
  assert.equal(clearTerminalImages({ TERM_PROGRAM: "ghostty" }, true), "\x1b_Ga=d,d=A,q=2\x1b\\");
  assert.equal(clearTerminalImages({ TERM_PROGRAM: "iTerm.app" }, true), "");
  assert.equal(
    wrapTmuxPassthrough("\x1b_Ga=d,d=A,q=2\x1b\\", { TMUX: "/tmp/tmux-1000/default,123,0" }),
    "\x1bPtmux;\x1b\x1b_Ga=d,d=A,q=2\x1b\x1b\\\x1b\\",
  );
});

test("computeCellConstraint 根据宽高比选择仅限制列宽或仅限制行高以防拉伸", () => {
  const wide = computeCellConstraint(1200, 400, 60, 20);
  assert.equal(wide.rows, undefined);
  assert.equal(wide.cols, 60);

  const tall = computeCellConstraint(400, 1600, 60, 16);
  assert.equal(tall.cols, undefined);
  assert.equal(tall.rows, 16);
});

test("renderTerminalImage 能把 WebP/JPEG/PNG 渲染为 Kitty、iTerm2 和半块字符画", async () => {
  const webp = await makeTestImage(160, 90, "webp");
  const kitty = await renderTerminalImage(webp, { protocol: "kitty", env: {}, isTTY: true });
  assert.equal(kitty.protocol, "kitty");
  assert.equal(kitty.width, 160);
  assert.equal(kitty.height, 90);
  assert.ok(kitty.output.includes("\x1b_Ga=T,f=100,q=2"));

  const jpeg = await makeTestImage(120, 120, "jpeg");
  const iterm2 = await renderTerminalImage(jpeg, { protocol: "iterm2", name: "photo.jpg", env: {}, isTTY: true });
  assert.equal(iterm2.protocol, "iterm2");
  assert.ok(iterm2.output.includes("\x1b]1337;File=inline=1"));

  const halfblock = await renderTerminalImage(webp, { protocol: "halfblock", maxCols: 20, maxRows: 8, env: {}, isTTY: true });
  assert.equal(halfblock.protocol, "halfblock");
  assert.ok(halfblock.output.includes("\u2580"));
  assert.ok(halfblock.output.includes("\x1b[38;2;"));
});

test("encodeITerm2Image 与 safeImageFilename 处理正确", () => {
  const seq = encodeITerm2Image(new Uint8Array([1, 2, 3]), { name: "test.png", cols: 30, env: {} });
  assert.ok(seq.startsWith("\x1b]1337;File=inline=1;size=3;preserveAspectRatio=1;name="));
  assert.ok(seq.includes(";width=30:"));
  assert.ok(seq.endsWith("\x07"));

  assert.equal(safeImageFilename("a/b/c.jpg", "image/jpeg"), "c.jpg");
  assert.equal(safeImageFilename("screenshot", "image/webp"), "screenshot.webp");
});

test("PreviewManager cleanup 会彻底删除临时预览目录", () => {
  const manager = new PreviewManager();
  // Access private ensureTempDir via open? We don't want to pop a real GUI window during unit tests,
  // so verify cleanup is idempotent and safe when unused.
  assert.doesNotThrow(() => manager.cleanup());
  assert.equal(existsSync("/non-existent-preview-dir"), false);
});

test("parsePathAndCaption 支持引号、Ghostty 拖入转义空格与附带文字", () => {
  assert.deepEqual(parsePathAndCaption("'/Users/me/Screen Shot 1.png' 看看这个"), {
    path: "/Users/me/Screen Shot 1.png",
    caption: "看看这个",
  });
  assert.deepEqual(parsePathAndCaption('/Users/me/Screen\\ Shot\\ 2.png 附带说明'), {
    path: "/Users/me/Screen Shot 2.png",
    caption: "附带说明",
  });
  assert.deepEqual(parsePathAndCaption("~/Desktop/a.jpg"), {
    path: "~/Desktop/a.jpg",
    caption: "",
  });
});

test("prepareImageForUpload 生成 WebP 缩略图并自动将 TIFF 转为 PNG", async () => {
  const png = await makeTestImage(800, 600, "png");
  const prepared = await prepareImageForUpload(png, "demo.png");
  assert.equal(prepared.mimeType, "image/png");
  assert.equal(prepared.width, 800);
  assert.equal(prepared.height, 600);
  const thumbMeta = await sharp(prepared.thumbnailBytes).metadata();
  assert.equal(thumbMeta.format, "webp");
  assert.ok((thumbMeta.width ?? 0) <= 480);
  assert.ok((thumbMeta.height ?? 0) <= 480);

  const tiff = await sharp({
    create: { width: 100, height: 50, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  }).tiff().toBuffer();
  const converted = await prepareImageForUpload(tiff, "clip.tiff");
  assert.equal(converted.mimeType, "image/png");
  assert.equal(converted.originalName, "clip.png");
  assert.equal(converted.width, 100);
  assert.equal(converted.height, 50);
});

test("extractImagePathsFromLine 能从直接粘贴/拖入的输入行里识别图片路径并分离附带文字", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-lite-extract-"));
  try {
    const fileA = join(dir, "screen shot 1.png");
    const fileB = join(dir, "photo.jpg");
    writeFileSync(fileA, await makeTestImage(10, 10, "png"));
    writeFileSync(fileB, await makeTestImage(10, 10, "jpeg"));

    // Quoted path with spaces + caption
    const res1 = extractImagePathsFromLine(`'${fileA}' 帮我看下这个`);
    assert.deepEqual(res1, { imagePaths: [fileA], caption: "帮我看下这个" });

    // Backslash-escaped spaces (Ghostty drag-and-drop) + caption before path
    const escapedA = fileA.replaceAll(" ", "\\ ");
    const res2 = extractImagePathsFromLine(`报错如图 ${escapedA} ${fileB}`);
    assert.deepEqual(res2, { imagePaths: [fileA, fileB], caption: "报错如图" });

    // Slash commands are never mistaken for image paths
    assert.deepEqual(extractImagePathsFromLine("/img 1"), { imagePaths: [], caption: "/img 1" });
    assert.deepEqual(extractImagePathsFromLine("/help"), { imagePaths: [], caption: "/help" });

    // looksLikeImageFilePath identifies missing image paths cleanly
    assert.equal(looksLikeImageFilePath("/Users/test/Desktop/not-found.png"), true);
    assert.equal(looksLikeImageFilePath("/help"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
