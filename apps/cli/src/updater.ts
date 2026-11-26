import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import type { CliReleaseManifest, CliUpdateBundle } from "@chat-lite/shared";

export type InstallLayout = {
  appDir: string;
  distDir: string;
  bundleRoot: string;
  isDevCheckout: boolean;
};

export function detectInstallLayout(entryDir = __dirname): InstallLayout {
  const distDir = resolve(entryDir);
  const appDir = resolve(distDir, "..");
  const bundleRoot = resolve(appDir, "..");
  const isDevCheckout = existsSync(join(appDir, "src", "index.ts"));
  return { appDir, distDir, bundleRoot, isDevCheckout };
}

export function readCurrentPkg(appDir = detectInstallLayout().appDir): {
  version: string;
  dependencies?: Record<string, string>;
} {
  try {
    return JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as {
      version: string;
      dependencies?: Record<string, string>;
    };
  } catch {
    return { version: "0.1.2" };
  }
}

export function readCurrentVersion(appDir = detectInstallLayout().appDir): string {
  return readCurrentPkg(appDir).version || "0.1.2";
}

export function computeDepsHash(dependencies?: Record<string, string>): string {
  const normalized: Record<string, string> = {};
  const entries = Object.entries(dependencies ?? {})
    .filter(([name]) => name !== "@chat-lite/shared")
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [name, range] of entries) {
    normalized[name] = range;
  }
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 32);
}

export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => {
    const clean = v.trim().replace(/^v/i, "");
    const [core, pre] = clean.split("-", 2);
    const nums = (core ?? "0.0.0").split(".").map((n) => Number.parseInt(n, 10) || 0);
    return { major: nums[0] ?? 0, minor: nums[1] ?? 0, patch: nums[2] ?? 0, pre: pre ?? "" };
  };
  const va = parse(a);
  const vb = parse(b);
  if (va.major !== vb.major) return va.major - vb.major;
  if (va.minor !== vb.minor) return va.minor - vb.minor;
  if (va.patch !== vb.patch) return va.patch - vb.patch;
  if (!va.pre && vb.pre) return 1;
  if (va.pre && !vb.pre) return -1;
  return va.pre.localeCompare(vb.pre);
}

export function isAllowedBundleFilePath(relPath: string): boolean {
  if (!relPath || relPath.includes("..") || relPath.includes("\\") || relPath.startsWith("/")) return false;
  if (relPath === "app/package.json" || relPath === "使用手册.md") return true;
  return /^app\/dist\/[A-Za-z0-9_.-]+\.js$/.test(relPath);
}

export function applyUpdateBundle(
  gzippedBytes: Uint8Array,
  manifest: Pick<CliReleaseManifest, "version" | "sha256" | "depsHash" | "minNodeMajor">,
  layout: InstallLayout = detectInstallLayout(),
  options?: { force?: boolean },
): { version: string; fileCount: number } {
  if (layout.isDevCheckout && !options?.force) {
    throw new Error("检测到当前运行在源码开发目录，请使用 git pull && build 更新（若确需覆盖请加 --force）");
  }

  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (nodeMajor < manifest.minNodeMajor) {
    throw new Error(`新版本 v${manifest.version} 需要 Node.js ${manifest.minNodeMajor}+（当前 v${process.versions.node}）`);
  }

  const localDepsHash = computeDepsHash(readCurrentPkg(layout.appDir).dependencies);
  if (!options?.force && manifest.depsHash && localDepsHash !== manifest.depsHash) {
    throw new Error(
      `新版本 v${manifest.version} 更新了原生/第三方依赖，无法纯增量热更新；请向管理员获取最新版完整压缩包重新安装`,
    );
  }

  const actualSha = createHash("sha256").update(gzippedBytes).digest("hex");
  if (actualSha.toLowerCase() !== manifest.sha256.toLowerCase()) {
    throw new Error(`更新包 SHA-256 校验失败（期望 ${manifest.sha256.slice(0, 12)}，实际 ${actualSha.slice(0, 12)}）`);
  }

  let bundle: CliUpdateBundle;
  try {
    bundle = JSON.parse(gunzipSync(gzippedBytes).toString("utf8")) as CliUpdateBundle;
  } catch {
    throw new Error("更新包解压或解析失败");
  }

  if (bundle.version !== manifest.version) {
    throw new Error(`更新包版本不匹配（清单 ${manifest.version}，包内 ${bundle.version}）`);
  }

  const entries = Object.entries(bundle.files ?? {});
  if (!entries.length || !bundle.files["app/dist/index.js"]) {
    throw new Error("更新包内容不完整（缺少 app/dist/index.js）");
  }
  for (const [relPath, content] of entries) {
    if (!isAllowedBundleFilePath(relPath) || typeof content !== "string") {
      throw new Error(`更新包包含非法文件路径：${relPath}`);
    }
  }

  const suffix = `${process.pid}-${Date.now()}`;
  const distNext = join(layout.appDir, `dist.next.${suffix}`);
  const distBak = join(layout.appDir, `dist.bak.${suffix}`);
  rmSync(distNext, { recursive: true, force: true });
  mkdirSync(distNext, { recursive: true });

  let pkgBuffer: Buffer | null = null;
  let manualBuffer: Buffer | null = null;
  let distFileCount = 0;

  try {
    for (const [relPath, b64] of entries) {
      const bytes = Buffer.from(b64, "base64");
      if (relPath.startsWith("app/dist/")) {
        const name = relPath.slice("app/dist/".length);
        const dest = join(distNext, name);
        writeFileSync(dest, bytes);
        if (name === "index.js") {
          try { chmodSync(dest, 0o755); } catch {}
        }
        distFileCount += 1;
      } else if (relPath === "app/package.json") {
        pkgBuffer = bytes;
      } else if (relPath === "使用手册.md") {
        manualBuffer = bytes;
      }
    }

    // Atomic directory swap with rollback safety
    const hadExistingDist = existsSync(layout.distDir);
    if (hadExistingDist) {
      renameSync(layout.distDir, distBak);
    }
    try {
      renameSync(distNext, layout.distDir);
    } catch (swapError) {
      if (hadExistingDist && existsSync(distBak) && !existsSync(layout.distDir)) {
        try { renameSync(distBak, layout.distDir); } catch {}
      }
      throw swapError;
    }

    if (pkgBuffer) {
      writeFileSync(join(layout.appDir, "package.json"), pkgBuffer);
    }
    if (manualBuffer && !layout.isDevCheckout) {
      const hasLauncher = existsSync(join(layout.bundleRoot, "chat-lite")) || existsSync(join(layout.bundleRoot, "chat-lite.cmd"));
      if (hasLauncher) {
        writeFileSync(join(layout.bundleRoot, "使用手册.md"), manualBuffer);
      }
    }

    rmSync(distBak, { recursive: true, force: true });
    return { version: bundle.version, fileCount: distFileCount };
  } catch (error) {
    rmSync(distNext, { recursive: true, force: true });
    throw error;
  }
}
