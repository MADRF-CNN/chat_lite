#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { commands } from "./commands";
import { fail, info } from "./log";
import { readConfig } from "./store";

const VERSION = "0.1.0";

function findDefaultCa(): string | undefined {
  const candidates = [
    resolve(process.cwd(), "chat-lite-private-ca.crt"),
    resolve(__dirname, "../../chat-lite-private-ca.crt"),
    resolve(__dirname, "../../../chat-lite-private-ca.crt"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

const tlsHints: Record<string, string> = {
  ERR_TLS_CERT_ALTNAME_INVALID: "服务器证书与访问地址不匹配",
  CERT_HAS_EXPIRED: "服务器证书已过期",
  DEPTH_ZERO_SELF_SIGNED_CERT: "服务器使用自签证书",
  SELF_SIGNED_CERT_IN_CHAIN: "服务器证书由自签 CA 签发",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "无法校验服务器证书链",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "找不到服务器证书的签发者",
};

function help() {
  info("Chat Lite 命令行客户端");
  info("");
  info("用法：chat-lite [命令] [参数] [--server <地址>] [--ca <证书路径>]");
  info("");
  info("缺省命令时直接进入交互式即时聊天终端 (类似 Codex / Claude 交互终端)。");
  info("");
  info("命令：");
  const seen = new Set<unknown>();
  for (const command of Object.values(commands)) {
    if (seen.has(command)) continue;
    seen.add(command);
    info(`  ${command.usage}`);
  }
  info("");
  info("会话参数可以是会话 ID（支持前缀）、私聊对方的用户名或群名。");
  info("自签证书部署请用 --ca <证书路径> 指定根证书（登录后自动记住），");
  info("也可通过 export NODE_EXTRA_CA_CERTS=<证书路径> 全局指定。");
}

function detail(name: string) {
  const command = commands[name];
  if (!command) fail(`未知命令“${name}”`);
  info(command.usage);
  info(`  ${command.summary}`);
}

function parseCa(argv: string[]) {
  const args = [...argv];
  for (const [index, arg] of args.entries()) {
    if (arg === "--") break;
    if (arg !== "--ca" && !arg.startsWith("--ca=")) continue;
    const value = arg === "--ca" ? args[index + 1] : arg.slice("--ca=".length);
    if (!value) fail("--ca 需要证书路径，例如：chat-lite login --ca ./chat-lite-private-ca.crt");
    args.splice(index, arg === "--ca" ? 2 : 1);
    return { args, caPath: resolve(value) };
  }
  return { args, caPath: undefined };
}

function relaunch(caPath: string, args: string[]) {
  const child = spawn(process.execPath, [...process.execArgv, process.argv[1]!, ...args], {
    stdio: "inherit",
    env: { ...process.env, NODE_EXTRA_CA_CERTS: caPath },
  });
  child.on("error", (error) => fail(`无法启动子进程：${error.message}`));
  child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 1));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
}

function describe(error: unknown) {
  if (error instanceof Error) {
    if (error.message === "fetch failed") {
      const cause = error.cause as NodeJS.ErrnoException | undefined;
      const hint = cause?.code ? tlsHints[cause.code] : undefined;
      if (hint) return `${hint}（${cause?.code}）。请在该命令上加 --ca <证书路径>，例如 --ca ./chat-lite-private-ca.crt；或先 export NODE_EXTRA_CA_CERTS=<证书路径>`;
      return `无法连接服务器${cause?.message ? `（${cause.message}）` : ""}；请检查 --server 地址与网络`;
    }
    return error.message;
  }
  return String(error);
}

async function main() {
  const startup = parseCa(process.argv.slice(2));
  if (startup.args[0] === "--") startup.args.shift();
  const first = startup.args[0];

  if (first === "help" || first === "--help" || first === "-h") {
    const topic = startup.args[1];
    if (topic) detail(topic);
    else help();
    return;
  }
  if (first === "--version" || first === "-v") {
    info(VERSION);
    return;
  }

  let commandName: string;
  let commandArgs: string[];

  if (!first) {
    commandName = "chat";
    commandArgs = [];
  } else if (first.startsWith("-")) {
    commandName = "chat";
    commandArgs = startup.args;
  } else if (commands[first]) {
    commandName = first;
    commandArgs = startup.args.slice(1);
  } else {
    fail(`未知命令“${first}”，可用命令：${Object.keys(commands).join("、")}`);
  }

  const command = commands[commandName]!;
  const caPath = startup.caPath ?? readConfig()?.caPath ?? findDefaultCa();
  if (caPath && process.env.NODE_EXTRA_CA_CERTS !== caPath) {
    relaunch(caPath, startup.args);
    return;
  }
  await command.run(commandArgs);
}

main().catch((error: unknown) => {
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  if (code?.startsWith("ERR_PARSE_ARGS") && error instanceof Error) fail(`${error.message}\n提示：chat-lite help 可查看全部用法`);
  fail(describe(error));
});
