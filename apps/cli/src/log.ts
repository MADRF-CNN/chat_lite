import { c } from "./color";

for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
  });
}

export function info(message: string) {
  process.stdout.write(`${message}\n`);
}

export function warn(message: string) {
  process.stderr.write(`${c.bold(c.yellow("警告："))}${message}\n`);
}

export function fail(message: string): never {
  process.stderr.write(`${c.bold(c.red("错误："))}${message}\n`);
  process.exit(1);
}
