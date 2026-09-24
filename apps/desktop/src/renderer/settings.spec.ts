import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, STYLE_OPTIONS, parseSettings } from "./settings";

describe("parseSettings", () => {
  it("无存储时返回默认设置", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("忽略非法风格并保留其余字段", () => {
    const parsed = parseSettings(JSON.stringify({ style: "neon", collapseSidebar: true, notifications: false, bossKey: false }));
    expect(parsed.style).toBe(DEFAULT_SETTINGS.style);
    expect(parsed.collapseSidebar).toBe(true);
    expect(parsed.notifications).toBe(false);
    expect(parsed.bossKey).toBe(false);
  });

  it("坏 JSON 回落到默认设置", () => {
    expect(parseSettings("{oops")).toEqual(DEFAULT_SETTINGS);
  });

  it("接受全部已定义风格", () => {
    for (const option of STYLE_OPTIONS) {
      expect(parseSettings(JSON.stringify({ style: option.id })).style).toBe(option.id);
    }
  });
});
