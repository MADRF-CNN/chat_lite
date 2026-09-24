export type StyleId = "doc" | "log" | "editor" | "table" | "mail";

export type Settings = {
  style: StyleId;
  collapseSidebar: boolean;
  notifications: boolean;
  bossKey: boolean;
};

export const STYLE_OPTIONS: { id: StyleId; name: string; desc: string }[] = [
  { id: "doc", name: "文档 / 笔记", desc: "纸感排版、无头像无气泡，像在读一页文档" },
  { id: "log", name: "构建日志", desc: "终端日志流，等宽单行，输入框是命令行" },
  { id: "editor", name: "编辑器", desc: "标签页 + 行号 + 语法配色，像在改日志文件" },
  { id: "table", name: "系统日志", desc: "TIME / USER / STATE / MESSAGE 四列表格" },
  { id: "mail", name: "邮件", desc: "收件箱 + 邮件正文，办公场景最不惹眼" },
];

export const DEFAULT_SETTINGS: Settings = { style: "doc", collapseSidebar: false, notifications: true, bossKey: true };

const STORAGE_KEY = "chatLite.settings";

function isStyleId(value: unknown): value is StyleId {
  return typeof value === "string" && STYLE_OPTIONS.some((option) => option.id === value);
}

export function parseSettings(raw: string | null): Settings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    style: isStyleId(record.style) ? record.style : DEFAULT_SETTINGS.style,
    collapseSidebar: typeof record.collapseSidebar === "boolean" ? record.collapseSidebar : DEFAULT_SETTINGS.collapseSidebar,
    notifications: typeof record.notifications === "boolean" ? record.notifications : DEFAULT_SETTINGS.notifications,
    bossKey: typeof record.bossKey === "boolean" ? record.bossKey : DEFAULT_SETTINGS.bossKey,
  };
}

export function loadSettings() {
  try {
    return parseSettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* 存储不可用时只影响下次启动的偏好 */
  }
}

export function applyStyle(style: StyleId) {
  document.documentElement.dataset.style = style;
}

export function styleName(style: StyleId) {
  return STYLE_OPTIONS.find((option) => option.id === style)?.name ?? style;
}
