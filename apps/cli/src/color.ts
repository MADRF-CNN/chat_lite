const enabled =
  !process.env.NO_COLOR &&
  (process.stdout.isTTY || process.env.FORCE_COLOR !== undefined);

function wrap(open: string, close: string) {
  return (text: string | number) => (enabled ? `${open}${text}${close}` : String(text));
}

export const c = {
  reset: "\x1b[0m",
  bold: wrap("\x1b[1m", "\x1b[22m"),
  dim: wrap("\x1b[2m", "\x1b[22m"),
  italic: wrap("\x1b[3m", "\x1b[23m"),
  underline: wrap("\x1b[4m", "\x1b[24m"),

  // Standard Foreground
  gray: wrap("\x1b[90m", "\x1b[39m"),
  red: wrap("\x1b[31m", "\x1b[39m"),
  green: wrap("\x1b[32m", "\x1b[39m"),
  yellow: wrap("\x1b[33m", "\x1b[39m"),
  blue: wrap("\x1b[34m", "\x1b[39m"),
  magenta: wrap("\x1b[35m", "\x1b[39m"),
  cyan: wrap("\x1b[36m", "\x1b[39m"),
  white: wrap("\x1b[37m", "\x1b[39m"),

  // Bright Foreground
  brightRed: wrap("\x1b[91m", "\x1b[39m"),
  brightGreen: wrap("\x1b[92m", "\x1b[39m"),
  brightYellow: wrap("\x1b[93m", "\x1b[39m"),
  brightBlue: wrap("\x1b[94m", "\x1b[39m"),
  brightMagenta: wrap("\x1b[95m", "\x1b[39m"),
  brightCyan: wrap("\x1b[96m", "\x1b[39m"),
  brightWhite: wrap("\x1b[97m", "\x1b[39m"),
};
