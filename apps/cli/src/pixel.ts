export type PixelSticker = {
  id: string;
  label: string;
  aliases: string[];
  /** 10x10 pixel art grid using palette keys; '.' is transparent */
  grid: string[];
};

const PALETTE: Record<string, readonly [number, number, number]> = {
  Y: [255, 212, 59],  // bright emoji yellow
  y: [235, 168, 22],  // shaded gold
  K: [28, 28, 34],    // deep charcoal (eyes / mouth)
  W: [255, 255, 255], // pure white (shine / teeth / mug)
  R: [242, 68, 78],   // vibrant red
  r: [190, 32, 46],   // dark red shadow
  P: [255, 138, 168], // soft pink (blush / ears / nose)
  O: [255, 152, 48],  // bright orange
  o: [204, 108, 32],  // warm brown-orange
  B: [56, 189, 248],  // sky blue (tears / sweat / window)
  b: [37, 99, 235],   // deep blue
  G: [46, 213, 142],  // emerald green
  g: [16, 158, 102],  // dark green
  S: [210, 220, 232], // light silver
  s: [140, 154, 172], // mid slate
  C: [118, 68, 36],   // espresso brown
};

export const PIXEL_STICKERS: PixelSticker[] = [
  {
    id: "smile",
    label: "微笑",
    aliases: ["happy", "笑", "开心", "微笑"],
    grid: [
      "..YYYYYY..",
      ".YYYYYYYY.",
      "YYYYYYYYYY",
      "YYKYYYYKYY",
      "YYKYYYYKYY",
      "YPYYYYYYPY",
      "YYKYYYYKYY",
      ".YYKKKKYY.",
      ".yYYYYYYy.",
      "..yyyyyy..",
    ],
  },
  {
    id: "laugh",
    label: "笑哭",
    aliases: ["lol", "haha", "大笑", "哈哈", "笑哭"],
    grid: [
      "..YYYYYY..",
      ".YYYYYYYY.",
      "YKYYYYYYKY",
      "YBKYYYYKBY",
      "BBYYYYYYBB",
      "BYYWWWWYYB",
      "YYKWWWWKYY",
      ".YYKKKKYY.",
      ".yYYYYYYy.",
      "..yyyyyy..",
    ],
  },
  {
    id: "cry",
    label: "大哭",
    aliases: ["sad", "qaq", "哭", "破防", "大哭"],
    grid: [
      "..YYYYYY..",
      ".YYYYYYYY.",
      "YYYYYYYYYY",
      "YYKYYYYKYY",
      "YYBYYYYBYY",
      "YYBYYYYBYY",
      "YYBKKKKBYY",
      ".YBYYYYBY.",
      ".yBYYYYBy.",
      "..BbbbbB..",
    ],
  },
  {
    id: "angry",
    label: "生气",
    aliases: ["mad", "怒", "生气", "暴怒"],
    grid: [
      "..RRRRRR..",
      ".RRRRRRRR.",
      "RKRRRRRRKR",
      "RRKRRRRKRR",
      "RRKRRRRKRR",
      "RRRRRRRRRR",
      "RRRKKKKRRR",
      ".RKRRRRKR.",
      ".rRRRRRRr.",
      "..rrrrrr..",
    ],
  },
  {
    id: "sweat",
    label: "流汗",
    aliases: ["awkward", "汗", "无语", "流汗", "尴尬"],
    grid: [
      "..YYYYYYB.",
      ".YYYYYYBBB",
      "YYYYYYYBBB",
      "YYKYYKYBBY",
      "YYKYYKYYYY",
      "YYYYYYYYYY",
      "YYKKKKKKYY",
      ".YYYYYYYY.",
      ".yYYYYYYy.",
      "..yyyyyy..",
    ],
  },
  {
    id: "ok",
    label: "收到",
    aliases: ["good", "lgtm", "赞", "收到", "好"],
    grid: [
      "..GGGGGG..",
      ".GGGGGGGG.",
      "GGGGGGGGGG",
      "GGGGGGGWWG",
      "GGGGGGWWGG",
      "GWWGGWWGGG",
      "GGWWWWGGGG",
      ".GGWWGGGG.",
      ".gGGGGGGg.",
      "..gggggg..",
    ],
  },
  {
    id: "heart",
    label: "比心",
    aliases: ["love", "thx", "心", "比心", "感谢"],
    grid: [
      ".RRR..RRR.",
      "RWWWRRRRRR",
      "RWRRRRRRRR",
      "RRRRRRRRRR",
      "RRRRRRRRrR",
      ".RRRRRRrR.",
      "..RRRRrr..",
      "...RRrr...",
      "....rr....",
      "..........",
    ],
  },
  {
    id: "fire",
    label: "着火",
    aliases: ["fine", "hot", "火", "着火", "炸了"],
    grid: [
      "....RR....",
      "...RRR....",
      "...RORR...",
      "..ROOORR..",
      ".ROOYOORR.",
      ".ROYYYOOR.",
      "ROYYYYYOOR",
      "ROYYWYYOOR",
      ".ROYYYYOR.",
      "..RRRRRR..",
    ],
  },
  {
    id: "coffee",
    label: "咖啡",
    aliases: ["cafe", "tea", "咖啡", "摸鱼"],
    grid: [
      "..W..W....",
      "...W..W...",
      "..........",
      ".SSSSSSS..",
      ".SCCCCCSSS",
      ".SCCCCCS.S",
      ".SCCCCCS.S",
      ".SCCCCCSSS",
      ".SSSSSSS..",
      "..sssss...",
    ],
  },
  {
    id: "doge",
    label: "狗头",
    aliases: ["dog", "狗", "狗头", "汪"],
    grid: [
      ".o......o.",
      "oO......Oo",
      "oOOOOOOOOo",
      "OOOOOOOOOO",
      "OOKOOOOOKO",
      "OWWWOOWWWO",
      "OWWWKKWWWO",
      ".WWWWWWWW.",
      "..WWPPWW..",
      "...oooo...",
    ],
  },
  {
    id: "cat",
    label: "猫猫",
    aliases: ["meow", "猫", "猫猫"],
    grid: [
      ".O......O.",
      "OPO....OPO",
      "OOOOOOOOOO",
      "OOOOOOOOOO",
      "OOKOOOOOKO",
      "OOWOOOOOWO",
      "OWWWPPWWWO",
      ".WWWWWWWW.",
      "..WWWWWW..",
      "..........",
    ],
  },
  {
    id: "rocket",
    label: "起飞",
    aliases: ["go", "ship", "起飞", "上线", "发版"],
    grid: [
      "....RR....",
      "...RRRR...",
      "...SSSS...",
      "..SSBBSS..",
      "..SSSSSS..",
      ".RSSSSSSR.",
      ".RSSSSSSR.",
      "R..OOOO..R",
      "...OYYO...",
      "....YY....",
    ],
  },
];

const STICKER_BY_ID = new Map<string, PixelSticker>(
  PIXEL_STICKERS.map((sticker) => [sticker.id.toLowerCase(), sticker]),
);

const PIXEL_TOKEN_REGEX = /^\[px:([a-z0-9_-]+)\](?:\s+([\s\S]*))?$/i;

export function resolvePixelSticker(token: string): PixelSticker | null {
  const cleaned = token.trim().toLowerCase();
  if (!cleaned) return null;

  const num = Number.parseInt(cleaned.startsWith("#") ? cleaned.slice(1) : cleaned, 10);
  if (/^#?\d+$/.test(cleaned) && num >= 1 && num <= PIXEL_STICKERS.length) {
    return PIXEL_STICKERS[num - 1] ?? null;
  }

  const direct = STICKER_BY_ID.get(cleaned);
  if (direct) return direct;

  for (const sticker of PIXEL_STICKERS) {
    if (sticker.aliases.some((alias) => alias.toLowerCase() === cleaned)) return sticker;
  }
  return null;
}

export function encodePixelStickerMessage(sticker: PixelSticker, caption?: string): string {
  const trimmed = caption?.trim();
  return trimmed ? `[px:${sticker.id}] ${trimmed}` : `[px:${sticker.id}]`;
}

export function parsePixelStickerMessage(text: string): { sticker: PixelSticker; caption: string } | null {
  const match = text.trim().match(PIXEL_TOKEN_REGEX);
  if (!match) return null;
  const sticker = STICKER_BY_ID.get(match[1]!.toLowerCase());
  if (!sticker) return null;
  return { sticker, caption: (match[2] ?? "").trim() };
}

/**
 * Fast shortcut syntax in REPL:
 *   :doge | :doge: | :doge 摸鱼中 | :狗头 摸鱼中 | :6 收到
 */
export function parseColonStickerShortcut(line: string): { sticker: PixelSticker; caption: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(":")) return null;
  const match = trimmed.match(/^:([^\s:]+):?(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const sticker = resolvePixelSticker(match[1]!);
  if (!sticker) return null;
  return { sticker, caption: (match[2] ?? "").trim() };
}

export function completeColonSticker(line: string): [string[], string] | null {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith(":") || /\s/.test(trimmed)) return null;
  const query = trimmed.slice(1).toLowerCase();
  const hits = PIXEL_STICKERS
    .map((s) => s.id)
    .filter((id) => id.startsWith(query))
    .map((id) => `:${id}`);
  return [hits.length ? hits : PIXEL_STICKERS.map((s) => `:${s.id}`), trimmed];
}

export function renderPixelStickerLines(
  sticker: PixelSticker,
  options?: { color?: boolean },
): string[] {
  const useColor = options?.color ?? (!process.env.NO_COLOR && (process.stdout.isTTY || process.env.FORCE_COLOR !== undefined));
  const width = sticker.grid[0]?.length ?? 10;
  const height = sticker.grid.length;
  const lines: string[] = [];

  for (let y = 0; y < height; y += 2) {
    const topRow = sticker.grid[y] ?? "";
    const botRow = sticker.grid[y + 1] ?? "";
    let line = "";

    for (let x = 0; x < width; x += 1) {
      const topChar = topRow[x] ?? ".";
      const botChar = botRow[x] ?? ".";
      const topRgb = topChar !== "." ? PALETTE[topChar] : undefined;
      const botRgb = botChar !== "." ? PALETTE[botChar] : undefined;

      if (!useColor) {
        if (topRgb && botRgb) line += "\u2588";
        else if (topRgb) line += "\u2580";
        else if (botRgb) line += "\u2584";
        else line += " ";
        continue;
      }

      if (!topRgb && !botRgb) {
        line += "\x1b[0m ";
      } else if (topRgb && !botRgb) {
        line += `\x1b[49;38;2;${topRgb[0]};${topRgb[1]};${topRgb[2]}m\u2580`;
      } else if (!topRgb && botRgb) {
        line += `\x1b[49;38;2;${botRgb[0]};${botRgb[1]};${botRgb[2]}m\u2584`;
      } else if (topRgb && botRgb) {
        line += `\x1b[38;2;${topRgb[0]};${topRgb[1]};${topRgb[2]};48;2;${botRgb[0]};${botRgb[1]};${botRgb[2]}m\u2580`;
      }
    }

    if (useColor) line += "\x1b[0m";
    lines.push(line);
  }

  return lines;
}

export function renderPixelSticker(sticker: PixelSticker, indent = "    ", options?: { color?: boolean }): string {
  return renderPixelStickerLines(sticker, options)
    .map((line) => `${indent}${line}`)
    .join("\n");
}

export function allStickerCompletionKeys(): string[] {
  return ["ls", ...PIXEL_STICKERS.map((s) => s.id)];
}
