#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = resolve(import.meta.dirname, "..");
const CLI_DIR = join(ROOT, "apps", "cli");
const SHARED_DIR = join(ROOT, "packages", "shared");

function parseArgs(argv) {
  let notes = "";
  let serverOverride = "";
  let caOverride = "";
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--notes" || arg === "-m") { notes = argv[i + 1] ?? ""; i += 1; }
    else if (arg.startsWith("--notes=")) notes = arg.slice("--notes=".length);
    else if (arg === "--server" || arg === "-s") { serverOverride = argv[i + 1] ?? ""; i += 1; }
    else if (arg.startsWith("--server=")) serverOverride = arg.slice("--server=".length);
    else if (arg === "--ca") { caOverride = argv[i + 1] ?? ""; i += 1; }
    else if (arg.startsWith("--ca=")) caOverride = arg.slice("--ca=".length);
  }
  return { notes, serverOverride, caOverride, dryRun };
}

function configDir() {
  if (process.env.CHAT_LITE_HOME) return process.env.CHAT_LITE_HOME;
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "chat-lite");
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function computeDepsHash(dependencies) {
  const normalized = {};
  for (const [name, range] of Object.entries(dependencies ?? {})
    .filter(([k]) => k !== "@chat-lite/shared")
    .sort(([a], [b]) => a.localeCompare(b))) {
    normalized[name] = range;
  }
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 32);
}

function normalizeUrl(url) {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(trimmed) ? `http://${trimmed}` : `https://${trimmed}`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const config = readJson(join(configDir(), "config.json"));
  const defaultCa = join(ROOT, "chat-lite-private-ca.crt");
  const caPath = opts.caOverride
    ? resolve(opts.caOverride)
    : (config?.caPath && existsSync(config.caPath) ? config.caPath : (existsSync(defaultCa) ? defaultCa : ""));

  if (!opts.dryRun && caPath && process.env.NODE_EXTRA_CA_CERTS !== caPath) {
    const child = spawn(process.execPath, [process.argv[1], ...process.argv.slice(2)], {
      stdio: "inherit",
      env: { ...process.env, NODE_EXTRA_CA_CERTS: caPath },
    });
    child.on("exit", (code) => process.exit(code ?? 1));
    return;
  }

  console.log("[publish-cli] Compiling @chat-lite/shared & @chat-lite/cli...");
  execFileSync(join(SHARED_DIR, "node_modules", ".bin", "tsc"), ["-p", join(SHARED_DIR, "tsconfig.json")], { stdio: "inherit" });
  execFileSync(join(CLI_DIR, "node_modules", ".bin", "tsc"), ["-p", join(CLI_DIR, "tsconfig.json")], { stdio: "inherit" });

  const cliPkg = JSON.parse(readFileSync(join(CLI_DIR, "package.json"), "utf8"));
  const version = cliPkg.version;
  const prodPkg = {
    name: "chat-lite-cli",
    version,
    private: true,
    description: cliPkg.description,
    main: "dist/index.js",
    engines: { node: ">=20.0.0" },
    dependencies: {
      sharp: cliPkg.dependencies.sharp,
      "socket.io-client": cliPkg.dependencies["socket.io-client"],
    },
  };
  const depsHash = computeDepsHash(prodPkg.dependencies);

  const files = {};
  const distDir = join(CLI_DIR, "dist");
  for (const entry of readdirSync(distDir)) {
    if (!entry.endsWith(".js") || entry.endsWith(".spec.js")) continue;
    files[`app/dist/${entry}`] = readFileSync(join(distDir, entry)).toString("base64");
  }
  files["app/package.json"] = Buffer.from(`${JSON.stringify(prodPkg, null, 2)}\n`, "utf8").toString("base64");
  if (existsSync(join(CLI_DIR, "USAGE.md"))) {
    files["使用手册.md"] = readFileSync(join(CLI_DIR, "USAGE.md")).toString("base64");
  }

  const bundle = { version, depsHash, notes: opts.notes || undefined, files };
  const gz = gzipSync(Buffer.from(JSON.stringify(bundle), "utf8"), { level: 9 });
  const sha256 = createHash("sha256").update(gz).digest("hex");

  console.log(`[publish-cli] Built bundle v${version}: ${(gz.length / 1024).toFixed(1)} KB (${Object.keys(files).length} files, sha256=${sha256.slice(0, 12)}, depsHash=${depsHash.slice(0, 12)})`);

  if (opts.dryRun) {
    console.log("[publish-cli] --dry-run complete (skipped upload).");
    return;
  }

  const apiUrl = normalizeUrl(opts.serverOverride || process.env.CHAT_LITE_API_URL || config?.apiUrl || "");
  if (!apiUrl) {
    console.error("错误：未找到服务器地址，请先执行 chat-lite login 或传 --server <地址>");
    process.exit(1);
  }

  const secretsPath = join(configDir(), "secrets.json");
  const secrets = readJson(secretsPath);
  if (!secrets?.refreshToken) {
    console.error("错误：本机尚未登录管理员账号，请先执行 chat-lite login");
    process.exit(1);
  }

  console.log(`[publish-cli] Refreshing admin session against ${apiUrl}...`);
  const refreshRes = await fetch(`${apiUrl}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: secrets.refreshToken }),
  });
  if (!refreshRes.ok) {
    console.error(`错误：刷新登录态失败（HTTP ${refreshRes.status}），请重新执行 chat-lite login`);
    process.exit(1);
  }
  const auth = await refreshRes.json();
  secrets.refreshToken = auth.refreshToken;
  writeFileSync(secretsPath, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });

  const form = new FormData();
  form.append("version", version);
  form.append("depsHash", depsHash);
  form.append("minNodeMajor", "20");
  if (opts.notes) form.append("notes", opts.notes);
  form.append("bundle", new Blob([gz], { type: "application/gzip" }), `chat-lite-cli-${version}.json.gz`);

  console.log(`[publish-cli] Uploading v${version} to ${apiUrl}/api/releases/cli...`);
  const pubRes = await fetch(`${apiUrl}/api/releases/cli`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    body: form,
  });
  const body = await pubRes.json().catch(() => null);
  if (!pubRes.ok) {
    console.error(`错误：发布失败（HTTP ${pubRes.status}）：${body?.message ?? "未知错误"}`);
    process.exit(1);
  }

  console.log(`[publish-cli] 发布成功！v${body.version} (${(body.size / 1024).toFixed(1)} KB, sha256=${body.sha256.slice(0, 12)})`);
  console.log("[publish-cli] 所有同事现在运行 chat-lite update（或在聊天中输入 /update）即可秒级更新！");
}

main().catch((err) => {
  console.error(`错误：${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
