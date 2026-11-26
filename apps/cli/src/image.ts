import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export type ImageProtocol = "kitty" | "iterm2" | "halfblock" | "none";

export type RenderImageOptions = {
  protocol?: ImageProtocol;
  maxCols?: number;
  maxRows?: number;
  maxPixels?: number;
  name?: string;
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
};

export type RenderImageResult = {
  protocol: ImageProtocol;
  output: string;
  width: number;
  height: number;
};

const KITTY_CHUNK_SIZE = 4096;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export function detectImageProtocol(
  env: NodeJS.ProcessEnv = process.env,
  isTTY = Boolean(process.stdout.isTTY),
): ImageProtocol {
  if (!isTTY) return "none";

  const forced = env.CHAT_LITE_IMAGE_PROTOCOL?.trim().toLowerCase();
  if (forced === "kitty" || forced === "iterm2" || forced === "halfblock" || forced === "none") {
    return forced;
  }

  const termProgram = (env.TERM_PROGRAM ?? "").toLowerCase();
  const term = (env.TERM ?? "").toLowerCase();
  const lcTerminal = (env.LC_TERMINAL ?? "").toLowerCase();

  // Ghostty, Kitty, and WezTerm support the Kitty Graphics Protocol natively
  if (
    termProgram === "ghostty" ||
    termProgram === "kitty" ||
    termProgram === "wezterm" ||
    term.includes("ghostty") ||
    term.includes("kitty") ||
    Boolean(env.KITTY_WINDOW_ID)
  ) {
    return "kitty";
  }

  // iTerm2 Inline Images Protocol (OSC 1337)
  if (
    termProgram === "iterm.app" ||
    termProgram === "warpterminal" ||
    termProgram === "hyper" ||
    termProgram === "tabby" ||
    termProgram === "vscode" ||
    lcTerminal === "iterm2"
  ) {
    return "iterm2";
  }

  if (env.NO_COLOR) return "none";

  const colorTerm = (env.COLORTERM ?? "").toLowerCase();
  if (
    colorTerm === "truecolor" ||
    colorTerm === "24bit" ||
    term.includes("256color") ||
    term.includes("direct") ||
    Boolean(env.WT_SESSION)
  ) {
    return "halfblock";
  }

  return "none";
}

export function protocolLabel(protocol: ImageProtocol): string {
  switch (protocol) {
    case "kitty":
      return "Kitty 图形协议 (高清内联)";
    case "iterm2":
      return "iTerm2 图形协议 (高清内联)";
    case "halfblock":
      return "ANSI 真彩色字符画";
    case "none":
      return "不支持终端内联";
  }
}

export function wrapTmuxPassthrough(sequence: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!env.TMUX) return sequence;
  return `\x1bPtmux;${sequence.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`;
}

export function clearTerminalImages(
  env: NodeJS.ProcessEnv = process.env,
  isTTY = Boolean(process.stdout.isTTY),
): string {
  if (detectImageProtocol(env, isTTY) !== "kitty") return "";
  // a=d: delete, d=A: all visible & stored images, q=2: quiet (no terminal response)
  return wrapTmuxPassthrough("\x1b_Ga=d,d=A,q=2\x1b\\", env);
}

export function computeCellConstraint(
  pixelWidth: number,
  pixelHeight: number,
  maxCols: number,
  maxRows: number,
): { cols?: number; rows?: number } {
  const safeW = Math.max(1, pixelWidth);
  const safeH = Math.max(1, pixelHeight);
  // Terminal cells are roughly twice as tall as they are wide (aspect ~ 1:2)
  const cellAspect = 2;
  // Approximate natural width in columns (~12px per col for comfortable Retina display)
  const desiredCols = Math.min(maxCols, Math.max(16, Math.round(safeW / 12)));
  const estimatedRows = (desiredCols / cellAspect) * (safeH / safeW);

  if (estimatedRows > maxRows) {
    // Specify only rows so Ghostty/Kitty preserves exact native aspect ratio
    return { rows: Math.max(4, Math.floor(maxRows)) };
  }
  // Specify only cols so Ghostty/Kitty preserves exact native aspect ratio
  return { cols: Math.max(8, Math.floor(desiredCols)) };
}

export function encodeKittyImage(
  pngBytes: Uint8Array,
  options?: { cols?: number; rows?: number; env?: NodeJS.ProcessEnv },
): string {
  const base64 = Buffer.from(pngBytes).toString("base64");
  const params = ["a=T", "f=100", "q=2"];
  if (options?.cols && options.cols > 0) params.push(`c=${Math.floor(options.cols)}`);
  if (options?.rows && options.rows > 0) params.push(`r=${Math.floor(options.rows)}`);
  const header = params.join(",");
  const env = options?.env ?? process.env;

  if (base64.length <= KITTY_CHUNK_SIZE) {
    return wrapTmuxPassthrough(`\x1b_G${header},m=0;${base64}\x1b\\`, env);
  }

  let result = "";
  for (let offset = 0; offset < base64.length; offset += KITTY_CHUNK_SIZE) {
    const chunk = base64.slice(offset, offset + KITTY_CHUNK_SIZE);
    const isFirst = offset === 0;
    const isLast = offset + KITTY_CHUNK_SIZE >= base64.length;
    const more = isLast ? 0 : 1;
    const seq = isFirst
      ? `\x1b_G${header},m=${more};${chunk}\x1b\\`
      : `\x1b_Gm=${more};${chunk}\x1b\\`;
    result += wrapTmuxPassthrough(seq, env);
  }
  return result;
}

export function encodeITerm2Image(
  bytes: Uint8Array,
  options?: { name?: string; cols?: number; rows?: number; env?: NodeJS.ProcessEnv },
): string {
  const base64 = Buffer.from(bytes).toString("base64");
  const args = ["inline=1", `size=${bytes.length}`, "preserveAspectRatio=1"];
  if (options?.name) {
    args.push(`name=${Buffer.from(options.name, "utf8").toString("base64")}`);
  }
  if (options?.cols && options.cols > 0) args.push(`width=${Math.floor(options.cols)}`);
  if (options?.rows && options.rows > 0) args.push(`height=${Math.floor(options.rows)}`);
  const seq = `\x1b]1337;File=${args.join(";")}:${base64}\x07`;
  return wrapTmuxPassthrough(seq, options?.env ?? process.env);
}

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_MAGIC.length) return false;
  for (let i = 0; i < PNG_MAGIC.length; i += 1) {
    if (bytes[i] !== PNG_MAGIC[i]) return false;
  }
  return true;
}

function blendChannel(fg: number, alpha: number, bg: number): number {
  const a = alpha / 255;
  return Math.round(fg * a + bg * (1 - a));
}

export async function renderHalfBlock(
  bytes: Uint8Array,
  maxCols: number,
  maxRows: number,
): Promise<{ output: string; width: number; height: number }> {
  const meta = await sharp(bytes).rotate().metadata();
  const srcW = Math.max(1, meta.width ?? 100);
  const srcH = Math.max(1, meta.height ?? 100);

  const maxPixelH = Math.max(2, Math.floor(maxRows) * 2);
  const scale = Math.min(1, maxCols / srcW, maxPixelH / srcH);
  const targetW = Math.max(2, Math.round(srcW * scale));
  let targetH = Math.max(2, Math.round(srcH * scale));
  if (targetH % 2 !== 0) targetH += 1;

  const { data, info } = await sharp(bytes)
    .rotate()
    .resize(targetW, targetH, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bgR = 24;
  const bgG = 24;
  const bgB = 28;
  const lines: string[] = [];

  for (let y = 0; y < info.height; y += 2) {
    let line = "  ";
    for (let x = 0; x < info.width; x += 1) {
      const topIdx = (y * info.width + x) * 4;
      const botIdx = (Math.min(y + 1, info.height - 1) * info.width + x) * 4;
      const tr = blendChannel(data[topIdx]!, data[topIdx + 3]!, bgR);
      const tg = blendChannel(data[topIdx + 1]!, data[topIdx + 3]!, bgG);
      const tb = blendChannel(data[topIdx + 2]!, data[topIdx + 3]!, bgB);
      const br = blendChannel(data[botIdx]!, data[botIdx + 3]!, bgR);
      const bg = blendChannel(data[botIdx + 1]!, data[botIdx + 3]!, bgG);
      const bb = blendChannel(data[botIdx + 2]!, data[botIdx + 3]!, bgB);
      line += `\x1b[38;2;${tr};${tg};${tb};48;2;${br};${bg};${bb}m\u2580`;
    }
    line += "\x1b[0m";
    lines.push(line);
  }

  return { output: lines.join("\n"), width: srcW, height: srcH };
}

export async function renderTerminalImage(
  bytes: Uint8Array,
  options: RenderImageOptions = {},
): Promise<RenderImageResult> {
  const env = options.env ?? process.env;
  const isTTY = options.isTTY ?? Boolean(process.stdout.isTTY);
  const protocol = options.protocol ?? detectImageProtocol(env, isTTY);

  const termCols = process.stdout.columns || 80;
  const termRows = process.stdout.rows || 24;
  const maxCols = options.maxCols ?? Math.min(68, Math.max(24, termCols - 6));
  const maxRows = options.maxRows ?? Math.min(24, Math.max(10, Math.floor(termRows * 0.58)));
  const maxPixels = options.maxPixels ?? 1280;

  if (protocol === "none") {
    return { protocol, output: "", width: 0, height: 0 };
  }

  if (protocol === "halfblock") {
    const rendered = await renderHalfBlock(bytes, Math.min(maxCols, 64), Math.min(maxRows, 22));
    return { protocol, ...rendered };
  }

  if (protocol === "kitty") {
    let pngData: Uint8Array;
    let width = 0;
    let height = 0;
    try {
      const converted = await sharp(bytes)
        .rotate()
        .resize({ width: maxPixels, height: maxPixels, fit: "inside", withoutEnlargement: true })
        .png({ compressionLevel: 6 })
        .toBuffer({ resolveWithObject: true });
      pngData = converted.data;
      width = converted.info.width;
      height = converted.info.height;
    } catch (error) {
      if (!isPng(bytes)) throw error;
      pngData = bytes;
    }

    const constraint = width && height
      ? computeCellConstraint(width, height, maxCols, maxRows)
      : { cols: Math.min(maxCols, 48) };
    const seq = encodeKittyImage(pngData, { ...constraint, env });
    return { protocol, output: `  ${seq}`, width, height };
  }

  // iTerm2 protocol (supports PNG/JPEG/GIF/WebP directly; normalize orientation & cap pixels)
  let payload = bytes;
  let width = 0;
  let height = 0;
  try {
    const converted = await sharp(bytes)
      .rotate()
      .resize({ width: maxPixels, height: maxPixels, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 6 })
      .toBuffer({ resolveWithObject: true });
    payload = converted.data;
    width = converted.info.width;
    height = converted.info.height;
  } catch {
    // Pass raw bytes directly if sharp fails
  }

  const constraint = width && height
    ? computeCellConstraint(width, height, maxCols, maxRows)
    : { cols: Math.min(maxCols, 48) };
  const seq = encodeITerm2Image(payload, { name: options.name, ...constraint, env });
  return { protocol, output: `  ${seq}`, width, height };
}

export function safeImageFilename(originalName: string, mimeType?: string): string {
  const raw = basename(originalName || "image").replace(/[/\\:*?"<>|]/g, "_") || "image";
  if (extname(raw)) return raw;
  const inferred = (mimeType && MIME_TO_EXT[mimeType.toLowerCase()]) || ".png";
  return `${raw}${inferred}`;
}

export function expandHome(inputPath: string): string {
  if (inputPath === "~") return homedir();
  if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) return join(homedir(), inputPath.slice(2));
  return inputPath;
}

export function uniqueFilePath(dir: string, originalName: string, mimeType?: string): string {
  const safe = safeImageFilename(originalName, mimeType);
  const ext = extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  let candidate = join(dir, safe);
  for (let index = 1; existsSync(candidate); index += 1) {
    candidate = join(dir, `${stem}-${index}${ext}`);
  }
  return candidate;
}

export function saveImageToDir(bytes: Uint8Array, dir: string, originalName: string, mimeType?: string): string {
  const targetDir = resolve(expandHome(dir));
  mkdirSync(targetDir, { recursive: true });
  const filePath = uniqueFilePath(targetDir, originalName, mimeType);
  writeFileSync(filePath, bytes);
  return filePath;
}

export class PreviewManager {
  private tempDir: string | null = null;
  private children = new Set<ChildProcess>();

  private ensureTempDir(): string {
    if (!this.tempDir || !existsSync(this.tempDir)) {
      this.tempDir = mkdtempSync(join(tmpdir(), "chat-lite-preview-"));
    }
    return this.tempDir;
  }

  open(bytes: Uint8Array, originalName: string, mimeType?: string): { filePath: string; viewer: string } {
    const dir = this.ensureTempDir();
    const filePath = uniqueFilePath(dir, originalName, mimeType);
    writeFileSync(filePath, bytes, { mode: 0o600 });

    const viewer = this.launchViewer(filePath);
    return { filePath, viewer };
  }

  private trackChild(child: ChildProcess) {
    this.children.add(child);
    child.once("exit", () => this.children.delete(child));
    child.once("error", () => this.children.delete(child));
  }

  private launchViewer(filePath: string): string {
    if (process.platform === "darwin") {
      // QuickLook floating preview: press Space or Esc to dismiss, killable on mask mode
      const child = spawn("qlmanage", ["-p", filePath], { stdio: "ignore" });
      this.trackChild(child);
      child.once("error", () => {
        const fallback = spawn("open", [filePath], { stdio: "ignore" });
        this.trackChild(fallback);
      });
      return "QuickLook (空格或 Esc 关闭)";
    }

    if (process.platform === "win32") {
      const child = spawn("cmd", ["/c", "start", "", filePath], { stdio: "ignore" });
      this.trackChild(child);
      return "系统图片查看器";
    }

    const child = spawn("xdg-open", [filePath], { stdio: "ignore" });
    this.trackChild(child);
    return "系统图片查看器";
  }

  cleanup() {
    for (const child of this.children) {
      try {
        if (!child.killed) child.kill("SIGTERM");
      } catch {
        // Ignore already-exited processes
      }
    }
    this.children.clear();

    if (this.tempDir) {
      try {
        rmSync(this.tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors on exit
      }
      this.tempDir = null;
    }
  }
}

export type PreparedUploadImage = {
  originalBytes: Uint8Array;
  thumbnailBytes: Uint8Array;
  width: number;
  height: number;
  mimeType: string;
  originalName: string;
  size: number;
};

const MAX_UPLOAD_IMAGE_BYTES = 10 * 1024 * 1024;

const FORMAT_TO_MIME: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
  ".avif",
]);

export function hasImageExtension(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function isWindowsPathStyle(value: string): boolean {
  return (
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.startsWith("\\\\") ||
    value.startsWith(".\\") ||
    value.startsWith("..\\") ||
    value.startsWith("~\\")
  );
}

export function looksLikeImageFilePath(input: string): boolean {
  const trimmed = input.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed || !hasImageExtension(trimmed)) return false;
  return (
    trimmed.startsWith("~/") ||
    trimmed.startsWith("~\\") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith(".\\") ||
    trimmed.startsWith("../") ||
    trimmed.startsWith("..\\") ||
    trimmed.startsWith("file://") ||
    isWindowsPathStyle(trimmed) ||
    (trimmed.startsWith("/") && trimmed.indexOf("/", 1) !== -1)
  );
}

function resolveCandidateImagePath(rawToken: string): string | null {
  let candidate = rawToken.trim();
  if (!candidate) return null;
  if (candidate.startsWith("file://")) {
    try {
      candidate = fileURLToPath(candidate);
    } catch {
      try {
        candidate = decodeURIComponent(new URL(candidate).pathname);
      } catch {
        return null;
      }
    }
  }
  const hasPathPrefix =
    candidate.startsWith("/") ||
    candidate.startsWith("~/") ||
    candidate.startsWith("~\\") ||
    candidate.startsWith("./") ||
    candidate.startsWith(".\\") ||
    candidate.startsWith("../") ||
    candidate.startsWith("..\\") ||
    isWindowsPathStyle(candidate);
  if (!hasImageExtension(candidate)) return null;
  if (!hasPathPrefix && !candidate.includes("/") && !candidate.includes("\\")) return null;

  const fullPath = resolve(expandHome(candidate));
  try {
    if (existsSync(fullPath) && statSync(fullPath).isFile()) {
      return fullPath;
    }
  } catch {
    return null;
  }
  return null;
}

export function extractImagePathsFromLine(input: string): { imagePaths: string[]; caption: string } {
  const imagePaths: string[] = [];
  const captionParts: string[] = [];
  let i = 0;

  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i]!)) i += 1;
    if (i >= input.length) break;

    const start = i;
    let decoded = "";
    const ch = input[i]!;

    if (ch === "'" || ch === '"') {
      const quote = ch;
      i += 1;
      const looksWinQuoted = quote === '"' && isWindowsPathStyle(input.slice(i));
      while (i < input.length) {
        const cur = input[i]!;
        if (quote === '"' && !looksWinQuoted && cur === "\\" && i + 1 < input.length) {
          decoded += input[i + 1]!;
          i += 2;
          continue;
        }
        if (cur === quote) {
          i += 1;
          break;
        }
        decoded += cur;
        i += 1;
      }
    } else {
      const looksWinUnquoted = isWindowsPathStyle(input.slice(i));
      while (i < input.length) {
        const cur = input[i]!;
        if (!looksWinUnquoted && cur === "\\" && i + 1 < input.length) {
          decoded += input[i + 1]!;
          i += 2;
          continue;
        }
        if (/\s/.test(cur)) break;
        decoded += cur;
        i += 1;
      }
    }

    const rawSlice = input.slice(start, i);
    const resolved = resolveCandidateImagePath(decoded);
    if (resolved) {
      imagePaths.push(resolved);
    } else {
      captionParts.push(rawSlice);
    }
  }

  return {
    imagePaths,
    caption: captionParts.join(" ").trim(),
  };
}

export function parsePathAndCaption(input: string): { path: string; caption: string } {
  const trimmed = input.trim();
  if (!trimmed) return { path: "", caption: "" };

  const first = trimmed[0];
  if (first === "'" || first === '"') {
    let parsed = "";
    let i = 1;
    const looksWinQuoted = first === '"' && isWindowsPathStyle(trimmed.slice(1));
    while (i < trimmed.length) {
      const ch = trimmed[i]!;
      if (first === '"' && !looksWinQuoted && ch === "\\" && i + 1 < trimmed.length) {
        parsed += trimmed[i + 1]!;
        i += 2;
        continue;
      }
      if (ch === first) {
        i += 1;
        break;
      }
      parsed += ch;
      i += 1;
    }
    return { path: parsed, caption: trimmed.slice(i).trim() };
  }

  // Unquoted path: preserve backslashes on Windows paths, unescape POSIX shell escapes otherwise
  const looksWinUnquoted = isWindowsPathStyle(trimmed);
  let parsed = "";
  let i = 0;
  while (i < trimmed.length) {
    const ch = trimmed[i]!;
    if (!looksWinUnquoted && ch === "\\" && i + 1 < trimmed.length) {
      parsed += trimmed[i + 1]!;
      i += 2;
      continue;
    }
    if (/\s/.test(ch)) break;
    parsed += ch;
    i += 1;
  }
  return { path: parsed, caption: trimmed.slice(i).trim() };
}

export async function prepareImageForUpload(
  inputBytes: Uint8Array,
  rawName: string,
): Promise<PreparedUploadImage> {
  if (!inputBytes.length) throw new Error("图片内容为空");

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(inputBytes).metadata();
  } catch {
    throw new Error("无法识别该图片格式，仅支持常见图片格式（PNG/JPEG/WebP/GIF 等）");
  }

  const format = (metadata.format ?? "").toLowerCase();
  let originalBytes = inputBytes;
  let mimeType = FORMAT_TO_MIME[format];
  let originalName = safeImageFilename(rawName, mimeType);

  // Convert unsupported desktop formats (e.g. macOS TIFF / HEIC / BMP) to PNG automatically
  if (!mimeType) {
    const converted = await sharp(inputBytes).rotate().png({ compressionLevel: 6 }).toBuffer({ resolveWithObject: true });
    originalBytes = new Uint8Array(converted.data);
    mimeType = "image/png";
    const ext = extname(originalName);
    const stem = ext ? originalName.slice(0, -ext.length) : originalName;
    originalName = `${stem || "image"}.png`;
    metadata = { ...metadata, width: converted.info.width, height: converted.info.height, orientation: 1 };
  }

  if (originalBytes.length > MAX_UPLOAD_IMAGE_BYTES) {
    throw new Error(`图片不能超过 10MB（当前 ${(originalBytes.length / 1024 / 1024).toFixed(1)}MB）`);
  }

  const oriented = (metadata.orientation ?? 1) >= 5 && (metadata.orientation ?? 1) <= 8;
  const width = Math.max(1, (oriented ? metadata.height : metadata.width) ?? 1);
  const height = Math.max(1, (oriented ? metadata.width : metadata.height) ?? 1);

  const thumbBuffer = await sharp(originalBytes)
    .rotate()
    .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  return {
    originalBytes,
    thumbnailBytes: new Uint8Array(thumbBuffer),
    width,
    height,
    mimeType,
    originalName,
    size: originalBytes.length,
  };
}

export async function prepareImageFileForUpload(inputPath: string): Promise<PreparedUploadImage> {
  const cleaned = inputPath.trim();
  if (!cleaned) throw new Error("请提供图片路径");
  const fullPath = resolve(expandHome(cleaned));
  if (!existsSync(fullPath)) throw new Error(`找不到图片文件：${fullPath}`);
  if (statSync(fullPath).isDirectory()) throw new Error(`路径是目录而不是图片文件：${fullPath}`);
  const bytes = new Uint8Array(readFileSync(fullPath));
  return prepareImageForUpload(bytes, basename(fullPath));
}

function defaultClipboardFilename(ext: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `clipboard-${stamp}${ext}`;
}

export async function readClipboardImage(): Promise<{ bytes: Uint8Array; name: string }> {
  if (process.platform === "darwin") {
    const tempDir = mkdtempSync(join(tmpdir(), "chat-lite-clip-"));
    const outPath = join(tempDir, "clip.bin");
    try {
      const script = `
ObjC.import("AppKit");
const pb = $.NSPasteboard.generalPasteboard;
const candidates = [
  ["public.png", ".png"],
  ["public.jpeg", ".jpg"],
  ["com.compuserve.gif", ".gif"],
  ["org.webmproject.webp", ".webp"],
  ["public.tiff", ".tiff"],
];
let matched = null;
for (const [uti, ext] of candidates) {
  const data = pb.dataForType(uti);
  if (data && data.length > 0) {
    data.writeToFileAtomically(${JSON.stringify(outPath)}, true);
    matched = "DATA:" + ext;
    break;
  }
}
if (!matched) {
  const urlStr = pb.stringForType("public.file-url");
  if (urlStr) {
    const nsUrl = $.NSURL.URLWithString(urlStr);
    const filePathUrl = nsUrl && nsUrl.filePathURL;
    if (filePathUrl && filePathUrl.path) {
      matched = "FILE:" + ObjC.unwrap(filePathUrl.path);
    }
  }
}
if (!matched) {
  const textStr = pb.stringForType("public.utf8-plain-text");
  if (textStr) {
    matched = "TEXT:" + ObjC.unwrap(textStr);
  }
}
matched || "EMPTY";
`;
      const result = execFileSync("osascript", ["-l", "JavaScript", "-e", script], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();

      if (result.startsWith("DATA:")) {
        const ext = result.slice("DATA:".length) || ".png";
        const bytes = new Uint8Array(readFileSync(outPath));
        return { bytes, name: defaultClipboardFilename(ext) };
      }

      if (result.startsWith("FILE:")) {
        const filePath = result.slice("FILE:".length);
        if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
          throw new Error("剪贴板里的文件不是有效图片");
        }
        return { bytes: new Uint8Array(readFileSync(filePath)), name: basename(filePath) };
      }

      if (result.startsWith("TEXT:")) {
        const text = result.slice("TEXT:".length).trim();
        const { imagePaths } = extractImagePathsFromLine(text);
        if (imagePaths.length === 1) {
          const imgPath = imagePaths[0]!;
          return { bytes: new Uint8Array(readFileSync(imgPath)), name: basename(imgPath) };
        }
      }

      throw new Error("剪贴板里没有图片（可先截屏 Cmd+Ctrl+Shift+4 或复制图片后再按 Ctrl+V）");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  if (process.platform === "win32") {
    const tempDir = mkdtempSync(join(tmpdir(), "chat-lite-clip-"));
    const outPath = join(tempDir, "clip.png");
    try {
      const psScript = [
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
        "Add-Type -AssemblyName System.Windows.Forms",
        "Add-Type -AssemblyName System.Drawing",
        "$out = $env:CHAT_LITE_CLIP_OUT",
        "if ([System.Windows.Forms.Clipboard]::ContainsImage()) {",
        "  $img = [System.Windows.Forms.Clipboard]::GetImage()",
        "  $img.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)",
        "  $img.Dispose()",
        "  Write-Output 'DATA:.png'",
        "} elseif ([System.Windows.Forms.Clipboard]::ContainsFileDropList()) {",
        "  $files = [System.Windows.Forms.Clipboard]::GetFileDropList()",
        "  if ($files.Count -gt 0) { Write-Output ('FILE:' + $files[0]) } else { Write-Output 'EMPTY' }",
        "} elseif ([System.Windows.Forms.Clipboard]::ContainsText()) {",
        "  Write-Output ('TEXT:' + [System.Windows.Forms.Clipboard]::GetText())",
        "} else {",
        "  Write-Output 'EMPTY'",
        "}",
      ].join("; ");

      const result = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-STA", "-Command", psScript],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, CHAT_LITE_CLIP_OUT: outPath },
        },
      ).trim();

      if (result.startsWith("DATA:")) {
        const ext = result.slice("DATA:".length) || ".png";
        const bytes = new Uint8Array(readFileSync(outPath));
        return { bytes, name: defaultClipboardFilename(ext) };
      }

      if (result.startsWith("FILE:")) {
        const filePath = result.slice("FILE:".length).trim();
        if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
          throw new Error("剪贴板里的文件不是有效图片");
        }
        return { bytes: new Uint8Array(readFileSync(filePath)), name: basename(filePath) };
      }

      if (result.startsWith("TEXT:")) {
        const text = result.slice("TEXT:".length).trim();
        const { imagePaths } = extractImagePathsFromLine(text);
        if (imagePaths.length === 1) {
          const imgPath = imagePaths[0]!;
          return { bytes: new Uint8Array(readFileSync(imgPath)), name: basename(imgPath) };
        }
      }

      throw new Error("剪贴板里没有图片（可先截屏 Win+Shift+S 或复制图片后再输入 /paste 或按 Ctrl+V）");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  if (process.platform === "linux") {
    const tools: Array<[string, string[]]> = [
      ["wl-paste", ["--no-newline", "--type", "image/png"]],
      ["xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]],
    ];
    for (const [cmd, args] of tools) {
      try {
        const buf = execFileSync(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
        if (buf.length > 0) {
          return { bytes: new Uint8Array(buf), name: defaultClipboardFilename(".png") };
        }
      } catch {
        // Try next clipboard utility
      }
    }
    throw new Error("未能从剪贴板读取图片（Linux 请安装 wl-clipboard 或 xclip，或使用 /pic <图片路径>）");
  }

  throw new Error("当前系统暂不支持直接读取剪贴板图片，请使用 /pic <图片路径>");
}
