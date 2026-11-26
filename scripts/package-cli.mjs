#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CLI_DIR = join(ROOT, "apps", "cli");
const CLI_PKG = JSON.parse(readFileSync(join(CLI_DIR, "package.json"), "utf8"));
const VERSION = CLI_PKG.version;
const STAGE_DIR = join(ROOT, "release", ".staging");
const RELEASE_DIR = join(ROOT, "release");

function log(msg) {
  process.stdout.write(`[package-cli] ${msg}\n`);
}

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function buildCli() {
  log("Compiling @chat-lite/cli TypeScript sources...");
  const tscBin = join(CLI_DIR, "node_modules", ".bin", "tsc");
  run(tscBin, ["-p", join(CLI_DIR, "tsconfig.json")], { cwd: CLI_DIR });
}

function writeAppFiles(appDir) {
  mkdirSync(join(appDir, "dist"), { recursive: true });
  const prodPkg = {
    name: "chat-lite-cli",
    version: VERSION,
    private: true,
    description: CLI_PKG.description,
    main: "dist/index.js",
    engines: { node: ">=20.0.0" },
    dependencies: {
      sharp: CLI_PKG.dependencies.sharp,
      "socket.io-client": CLI_PKG.dependencies["socket.io-client"],
    },
  };
  writeFileSync(join(appDir, "package.json"), `${JSON.stringify(prodPkg, null, 2)}\n`, "utf8");

  const distSrc = join(CLI_DIR, "dist");
  for (const entry of readdirSync(distSrc)) {
    if (entry.endsWith(".spec.js") || entry.endsWith(".spec.js.map") || entry.endsWith(".map")) {
      continue;
    }
    copyFileSync(join(distSrc, entry), join(appDir, "dist", entry));
  }
}

function installProdDeps(appDir, osName, cpuName) {
  log(`Installing production dependencies for ${osName}-${cpuName}...`);
  run(
    "npm",
    [
      "install",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      "--ignore-scripts",
      `--os=${osName}`,
      `--cpu=${cpuName}`,
    ],
    { cwd: appDir },
  );
}

function addExtraPlatformSharp(appDir, pkgNames) {
  const tmpDir = join(STAGE_DIR, "extra-sharp");
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  log(`Fetching extra sharp native packages: ${pkgNames.join(", ")}...`);
  for (const spec of pkgNames) {
    run("npm", ["pack", spec, "--pack-destination", tmpDir], { cwd: tmpDir });
  }
  for (const file of readdirSync(tmpDir)) {
    if (!file.endsWith(".tgz")) continue;
    const extractDir = join(tmpDir, `${file}.extracted`);
    mkdirSync(extractDir, { recursive: true });
    run("tar", ["-xzf", join(tmpDir, file), "-C", extractDir]);
    const pkgJson = JSON.parse(readFileSync(join(extractDir, "package", "package.json"), "utf8"));
    const targetDir = join(appDir, "node_modules", ...pkgJson.name.split("/"));
    mkdirSync(resolve(targetDir, ".."), { recursive: true });
    rmSync(targetDir, { recursive: true, force: true });
    cpSync(join(extractDir, "package"), targetDir, { recursive: true });
  }
  rmSync(tmpDir, { recursive: true, force: true });
}

function pruneNodeModules(appDir) {
  const sharpSrc = join(appDir, "node_modules", "sharp", "src");
  if (existsSync(sharpSrc)) rmSync(sharpSrc, { recursive: true, force: true });

  // Remove unnecessary markdown/license/map bloat from node_modules to keep archive ultra-lean
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "build" && full.includes("socket.io-client")) continue;
        walk(full);
      } else if (/\.(d\.ts|d\.cts|d\.mts|js\.map|mjs\.map|cjs\.map)$/i.test(entry.name)) {
        rmSync(full, { force: true });
      }
    }
  };
  walk(join(appDir, "node_modules"));
}

function writeUtf8(filePath, content, { crlf = false, bom = false, mode } = {}) {
  const normalized = crlf ? content.replace(/\r?\n/g, "\r\n") : content.replace(/\r\n/g, "\n");
  const payload = bom ? `\uFEFF${normalized}` : normalized;
  writeFileSync(filePath, payload, "utf8");
  if (mode !== undefined) chmodSync(filePath, mode);
}

function createZip(parentDir, folderName, outZipPath) {
  rmSync(outZipPath, { force: true });
  log(`Creating archive ${outZipPath}...`);
  run("zip", ["-rq", "-9", outZipPath, folderName], { cwd: parentDir });
}

function copyCommonAssets(bundleDir) {
  copyFileSync(join(ROOT, "chat-lite-private-ca.crt"), join(bundleDir, "chat-lite-private-ca.crt"));
  copyFileSync(join(CLI_DIR, "USAGE.md"), join(bundleDir, "使用手册.md"));
}

function buildMacosPackage() {
  const folderName = "chat-lite-cli-macos";
  const bundleDir = join(STAGE_DIR, folderName);
  rmSync(bundleDir, { recursive: true, force: true });
  mkdirSync(bundleDir, { recursive: true });

  const appDir = join(bundleDir, "app");
  writeAppFiles(appDir);
  installProdDeps(appDir, "darwin", "arm64");

  const sharpPkg = JSON.parse(readFileSync(join(appDir, "node_modules", "sharp", "package.json"), "utf8"));
  const x64SharpVer = sharpPkg.optionalDependencies?.["@img/sharp-darwin-x64"];
  const x64VipsVer = sharpPkg.optionalDependencies?.["@img/sharp-libvips-darwin-x64"];
  if (!x64SharpVer || !x64VipsVer) {
    throw new Error("Could not determine sharp darwin-x64 optional dependency versions");
  }
  addExtraPlatformSharp(appDir, [
    `@img/sharp-darwin-x64@${x64SharpVer}`,
    `@img/sharp-libvips-darwin-x64@${x64VipsVer}`,
  ]);
  pruneNodeModules(appDir);
  copyCommonAssets(bundleDir);

  // Lightweight launcher using system Node.js (>= 20)
  writeUtf8(
    join(bundleDir, "chat-lite"),
    `#!/bin/sh
set -eu

SOURCE="$0"
while [ -L "$SOURCE" ]; do
  DIR="$(CDPATH= cd -P -- "$(dirname -- "$SOURCE")" && pwd)"
  TARGET="$(readlink "$SOURCE")"
  case "$TARGET" in
    /*) SOURCE="$TARGET" ;;
    *) SOURCE="$DIR/$TARGET" ;;
  esac
done
ROOT_DIR="$(CDPATH= cd -P -- "$(dirname -- "$SOURCE")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "错误：未检测到 Node.js，请先安装 Node.js 20 或更高版本（https://nodejs.org）" >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "错误：当前 Node.js 版本为 $(node -v)，Chat Lite CLI 需要 Node.js 20 或更高版本。" >&2
  exit 1
fi

CA_FILE="$ROOT_DIR/chat-lite-private-ca.crt"
if [ -z "\${NODE_EXTRA_CA_CERTS:-}" ] && [ -f "$CA_FILE" ]; then
  export NODE_EXTRA_CA_CERTS="$CA_FILE"
fi

exec node "$ROOT_DIR/app/dist/index.js" "$@"
`,
    { mode: 0o755 },
  );

  // One-click installer
  writeUtf8(
    join(bundleDir, "install.sh"),
    `#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd)"
INSTALL_DIR="\${CHAT_LITE_INSTALL_DIR:-$HOME/.local/share/chat-lite-cli}"
BIN_DIR="\${CHAT_LITE_BIN_DIR:-$HOME/.local/bin}"

if ! command -v node >/dev/null 2>&1; then
  echo "错误：未检测到 Node.js，请先安装 Node.js 20+ 后再运行安装脚本。" >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "错误：当前 Node.js 版本为 $(node -v)，需要 Node.js 20 或更高版本。" >&2
  exit 1
fi

echo "正在安装 Chat Lite CLI (macOS 轻量版，使用本机 Node $(node -v))..."

# 清除下载文件的隔离属性，防止 Gatekeeper 拦截原生模块
xattr -dr com.apple.quarantine "$SCRIPT_DIR" 2>/dev/null || true

mkdir -p "$(dirname "$INSTALL_DIR")" "$BIN_DIR"
rm -rf "$INSTALL_DIR"
cp -R "$SCRIPT_DIR" "$INSTALL_DIR"

xattr -dr com.apple.quarantine "$INSTALL_DIR" 2>/dev/null || true
chmod +x "$INSTALL_DIR/chat-lite" "$INSTALL_DIR/install.sh" "$INSTALL_DIR/uninstall.sh" "$INSTALL_DIR/install-private-ca.sh"

ln -sf "$INSTALL_DIR/chat-lite" "$BIN_DIR/chat-lite"

# 检查并自动写入 PATH
PATH_ADDED=""
case ":\$PATH:" in
  *":$BIN_DIR:"*)
    ;;
  *)
    SHELL_NAME="$(basename "\${SHELL:-zsh}")"
    if [ "$SHELL_NAME" = "zsh" ]; then
      RC_FILE="$HOME/.zshrc"
    else
      RC_FILE="$HOME/.bash_profile"
    fi
    LINE='export PATH="$HOME/.local/bin:$PATH"'
    if [ ! -f "$RC_FILE" ] || ! grep -Fq "$LINE" "$RC_FILE"; then
      printf '\\n# Chat Lite CLI\\n%s\\n' "$LINE" >> "$RC_FILE"
      PATH_ADDED="$RC_FILE"
    fi
    ;;
esac

INSTALLED_VERSION="$("$INSTALL_DIR/chat-lite" --version)"

echo ""
echo "安装成功！版本：v\${INSTALLED_VERSION}"
echo "安装位置：\${INSTALL_DIR}"
echo "全局命令：\${BIN_DIR}/chat-lite"
echo ""
if [ -n "\${PATH_ADDED}" ]; then
  echo "已自动将 ~/.local/bin 加入 \${PATH_ADDED}。"
  echo "请重新打开终端（或执行：source \${PATH_ADDED} && rehash），然后运行："
else
  echo "现在可以直接在任意终端目录运行："
fi
echo "  chat-lite login --server <服务器地址>"
echo "  chat-lite"
echo ""
echo "完整说明请查看：\${INSTALL_DIR}/使用手册.md"
`,
    { mode: 0o755 },
  );

  // Uninstaller
  writeUtf8(
    join(bundleDir, "uninstall.sh"),
    `#!/bin/sh
set -eu

INSTALL_DIR="\${CHAT_LITE_INSTALL_DIR:-$HOME/.local/share/chat-lite-cli}"
BIN_DIR="\${CHAT_LITE_BIN_DIR:-$HOME/.local/bin}"
CONFIG_DIR="\${CHAT_LITE_HOME:-$HOME/.config/chat-lite}"

if [ -L "$BIN_DIR/chat-lite" ] || [ -f "$BIN_DIR/chat-lite" ]; then
  rm -f "$BIN_DIR/chat-lite"
  echo "已移除全局命令：$BIN_DIR/chat-lite"
fi

if [ -d "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR"
  echo "已删除程序目录：$INSTALL_DIR"
fi

if [ "\${1:-}" = "--purge" ]; then
  rm -rf "$CONFIG_DIR"
  echo "已彻底清理本地配置与私钥：$CONFIG_DIR"
else
  echo "已保留您的登录配置与端到端私钥：$CONFIG_DIR"
  echo "如需彻底清除配置与私钥，请执行：uninstall.sh --purge"
fi

echo "Chat Lite CLI 卸载完成。"
`,
    { mode: 0o755 },
  );

  // Optional macOS system CA installer
  writeUtf8(
    join(bundleDir, "install-private-ca.sh"),
    `#!/bin/sh
set -eu
SCRIPT_DIR="$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd)"
CERT="$SCRIPT_DIR/chat-lite-private-ca.crt"
if [ ! -f "$CERT" ]; then
  echo "找不到证书文件：$CERT" >&2
  exit 1
fi
echo "即将把 Chat Lite 私有 CA 安装到 macOS 系统钥匙串（需要管理员密码）..."
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CERT"
echo "完成！macOS 系统已信任 Chat Lite 私有 CA。"
`,
    { mode: 0o755 },
  );

  const zipPath = join(RELEASE_DIR, `chat-lite-cli-macos-v${VERSION}.zip`);
  createZip(STAGE_DIR, folderName, zipPath);
  return { bundleDir, zipPath };
}

function buildWindowsPackage() {
  const folderName = "chat-lite-cli-windows-x64";
  const bundleDir = join(STAGE_DIR, folderName);
  rmSync(bundleDir, { recursive: true, force: true });
  mkdirSync(bundleDir, { recursive: true });

  const appDir = join(bundleDir, "app");
  writeAppFiles(appDir);
  installProdDeps(appDir, "win32", "x64");
  pruneNodeModules(appDir);
  copyCommonAssets(bundleDir);

  const winSharpNode = join(appDir, "node_modules", "@img", "sharp-win32-x64", "lib", "sharp-win32-x64.node");
  if (!existsSync(winSharpNode)) {
    throw new Error(`Expected Windows sharp native addon missing: ${winSharpNode}`);
  }

  // Lightweight Windows launcher using system node (>= 20)
  writeUtf8(
    join(bundleDir, "chat-lite.cmd"),
    `@echo off
setlocal
chcp 65001 >nul 2>&1
where node >nul 2>&1
if errorlevel 1 (
  echo 错误：未检测到 Node.js，请先安装 Node.js 20 或更高版本（https://nodejs.org） 1>&2
  exit /b 1
)
set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"
if not defined NODE_EXTRA_CA_CERTS (
  if exist "%ROOT_DIR%\\chat-lite-private-ca.crt" (
    set "NODE_EXTRA_CA_CERTS=%ROOT_DIR%\\chat-lite-private-ca.crt"
  )
)
node "%ROOT_DIR%\\app\\dist\\index.js" %*
exit /b %ERRORLEVEL%
`,
    { crlf: true },
  );

  // Git Bash / MSYS2 launcher on Windows (ignored by CMD/PowerShell)
  writeUtf8(
    join(bundleDir, "chat-lite"),
    `#!/bin/sh
set -eu
if ! command -v node >/dev/null 2>&1; then
  echo "错误：未检测到 Node.js，请先安装 Node.js 20 或更高版本（https://nodejs.org）" >&2
  exit 1
fi
ROOT_DIR="$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd)"
CA_FILE="$ROOT_DIR/chat-lite-private-ca.crt"
if [ -z "\${NODE_EXTRA_CA_CERTS:-}" ] && [ -f "$CA_FILE" ]; then
  if command -v cygpath >/dev/null 2>&1; then
    export NODE_EXTRA_CA_CERTS="$(cygpath -w "$CA_FILE")"
  else
    export NODE_EXTRA_CA_CERTS="$CA_FILE"
  fi
fi
exec node "$ROOT_DIR/app/dist/index.js" "$@"
`,
    { mode: 0o755 },
  );

  // One-click Windows installer (.bat wrapper bypasses PowerShell ExecutionPolicy)
  writeUtf8(
    join(bundleDir, "install.bat"),
    `@echo off
setlocal
chcp 65001 >nul 2>&1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo %CMDCMDLINE% | find /i "/c" >nul
if not errorlevel 1 (
  echo.
  pause
)
exit /b %EXIT_CODE%
`,
    { crlf: true },
  );

  writeUtf8(
    join(bundleDir, "install.ps1"),
    `$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCmd) {
  Write-Host "错误：未检测到 Node.js，请先安装 Node.js 20 或更高版本（https://nodejs.org）后再安装。" -ForegroundColor Red
  exit 1
}

$NodeVerStr = (& node -v).Trim()
$NodeMajor = [int]((& node -p "process.versions.node.split('.')[0]").Trim())
if ($NodeMajor -lt 20) {
  Write-Host "错误：当前 Node.js 版本为 \${NodeVerStr}，Chat Lite CLI 需要 Node.js 20 或更高版本。" -ForegroundColor Red
  exit 1
}

$SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallDir = Join-Path $env:LOCALAPPDATA "chat-lite-cli"

Write-Host "正在安装 Chat Lite CLI (Windows x64 轻量版，使用本机 Node \${NodeVerStr})..." -ForegroundColor Cyan

if ([System.IO.Path]::GetFullPath($SourceDir).TrimEnd('\\') -ieq [System.IO.Path]::GetFullPath($InstallDir).TrimEnd('\\')) {
  Write-Host "当前已在目标安装目录：\${InstallDir}" -ForegroundColor Yellow
} else {
  if (Test-Path $InstallDir) {
    Remove-Item -Recurse -Force $InstallDir
  }
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  Copy-Item -Path (Join-Path $SourceDir "*") -Destination $InstallDir -Recurse -Force
}

# 将安装目录加入当前用户 PATH（无需管理员权限）
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($null -eq $UserPath) { $UserPath = "" }
$Parts = $UserPath -split ';' | Where-Object { $_ -and $_.Trim() -ne "" }
$NormalizedTarget = $InstallDir.TrimEnd('\\').ToLowerInvariant()
$AlreadyExists = $false
foreach ($Part in $Parts) {
  if ($Part.TrimEnd('\\').ToLowerInvariant() -eq $NormalizedTarget) {
    $AlreadyExists = $true
    break
  }
}

if (-not $AlreadyExists) {
  $NewPath = ($Parts + $InstallDir) -join ';'
  [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
  Write-Host "已将 \${InstallDir} 添加到当前用户 PATH 环境变量。" -ForegroundColor Green
} else {
  Write-Host "当前用户 PATH 中已包含 \${InstallDir}。" -ForegroundColor DarkGray
}

# 解除可能的网络下载 Zone.Identifier 标记
Get-ChildItem -Path $InstallDir -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
  Unblock-File -Path $_.FullName -ErrorAction SilentlyContinue
}

$Version = & node (Join-Path $InstallDir "app\\dist\\index.js") --version

Write-Host ""
Write-Host "安装成功！版本：v\${Version}" -ForegroundColor Green
Write-Host "安装位置：\${InstallDir}"
Write-Host ""
Write-Host "请关闭并重新打开一个 Windows Terminal / PowerShell 窗口，然后运行：" -ForegroundColor Yellow
Write-Host "  chat-lite login --server <服务器地址>"
Write-Host "  chat-lite"
Write-Host ""
Write-Host "完整说明请查看：\${InstallDir}\\使用手册.md"
`,
    { crlf: true, bom: true },
  );

  // Uninstaller
  writeUtf8(
    join(bundleDir, "uninstall.bat"),
    `@echo off
setlocal
chcp 65001 >nul 2>&1
set "TMP_PS=%TEMP%\\chat-lite-uninstall-%RANDOM%.ps1"
copy /y "%~dp0uninstall.ps1" "%TMP_PS%" >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%TMP_PS%" %*
set "EXIT_CODE=%ERRORLEVEL%"
del /f /q "%TMP_PS%" >nul 2>&1
echo %CMDCMDLINE% | find /i "/c" >nul
if not errorlevel 1 (
  echo.
  pause
)
exit /b %EXIT_CODE%
`,
    { crlf: true },
  );

  writeUtf8(
    join(bundleDir, "uninstall.ps1"),
    `param(
  [switch]$Purge
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$InstallDir = Join-Path $env:LOCALAPPDATA "chat-lite-cli"
$ConfigDir = if ($env:CHAT_LITE_HOME) { $env:CHAT_LITE_HOME } else { Join-Path $env:USERPROFILE ".config\\chat-lite" }

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath) {
  $NormalizedTarget = $InstallDir.TrimEnd('\\').ToLowerInvariant()
  $Remaining = ($UserPath -split ';') | Where-Object {
    $_ -and $_.Trim() -ne "" -and ($_.TrimEnd('\\').ToLowerInvariant() -ne $NormalizedTarget)
  }
  [Environment]::SetEnvironmentVariable("Path", ($Remaining -join ';'), "User")
  Write-Host "已从当前用户 PATH 中移除：$InstallDir" -ForegroundColor Green
}

if (Test-Path $InstallDir) {
  Remove-Item -Recurse -Force $InstallDir
  Write-Host "已删除程序目录：$InstallDir" -ForegroundColor Green
}

if ($Purge) {
  if (Test-Path $ConfigDir) {
    Remove-Item -Recurse -Force $ConfigDir
    Write-Host "已彻底清理本地配置与私钥：$ConfigDir" -ForegroundColor Yellow
  }
} else {
  Write-Host "已保留您的登录配置与端到端私钥：$ConfigDir" -ForegroundColor DarkGray
  Write-Host "如需彻底清除配置与私钥，请执行：uninstall.bat -Purge"
}

Write-Host "Chat Lite CLI 卸载完成。" -ForegroundColor Cyan
`,
    { crlf: true, bom: true },
  );

  // Optional Windows private CA trust installer
  writeUtf8(
    join(bundleDir, "install-private-ca.bat"),
    `@echo off
setlocal
chcp 65001 >nul 2>&1
set "CERT=%~dp0chat-lite-private-ca.crt"
if not exist "%CERT%" (
  echo 找不到证书文件：%CERT%
  exit /b 1
)
echo 即将把 Chat Lite 私有 CA 安装到当前用户的“受信任的根证书颁发机构”...
echo 如弹出安全警告，请点击“是”确认信任。
certutil -user -addstore Root "%CERT%"
set "EXIT_CODE=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" (
  echo 完成！Windows 当前用户已信任 Chat Lite 私有 CA。
)
echo %CMDCMDLINE% | find /i "/c" >nul
if not errorlevel 1 (
  echo.
  pause
)
exit /b %EXIT_CODE%
`,
    { crlf: true },
  );

  const zipPath = join(RELEASE_DIR, `chat-lite-cli-windows-x64-v${VERSION}.zip`);
  createZip(STAGE_DIR, folderName, zipPath);
  return { bundleDir, zipPath };
}

function formatMB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function main() {
  mkdirSync(RELEASE_DIR, { recursive: true });
  rmSync(STAGE_DIR, { recursive: true, force: true });
  rmSync(join(RELEASE_DIR, ".cache"), { recursive: true, force: true });
  mkdirSync(STAGE_DIR, { recursive: true });

  buildCli();

  const mac = buildMacosPackage();
  const win = buildWindowsPackage();

  const macSize = statSync(mac.zipPath).size;
  const winSize = statSync(win.zipPath).size;
  const macSha = sha256File(mac.zipPath);
  const winSha = sha256File(win.zipPath);

  writeUtf8(
    join(RELEASE_DIR, "SHA256SUMS.txt"),
    `${macSha}  chat-lite-cli-macos-v${VERSION}.zip\n${winSha}  chat-lite-cli-windows-x64-v${VERSION}.zip\n`,
  );

  rmSync(STAGE_DIR, { recursive: true, force: true });

  log("Lightweight packaging complete!");
  log(`  macOS (Universal arm64+x64): ${mac.zipPath} (${formatMB(macSize)})`);
  log(`  Windows (x64):               ${win.zipPath} (${formatMB(winSize)})`);
  log(`  Checksums:                   ${join(RELEASE_DIR, "SHA256SUMS.txt")}`);
}

main();
