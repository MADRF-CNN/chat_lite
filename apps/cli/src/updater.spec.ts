import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  applyUpdateBundle,
  compareSemver,
  computeDepsHash,
  isAllowedBundleFilePath,
} from "./updater";

test("compareSemver 正确比较语义化版本号", () => {
  assert.ok(compareSemver("0.1.3", "0.1.2") > 0);
  assert.ok(compareSemver("0.2.0", "0.1.10") > 0);
  assert.ok(compareSemver("1.0.0", "0.9.9") > 0);
  assert.equal(compareSemver("v0.1.2", "0.1.2"), 0);
  assert.ok(compareSemver("0.1.2", "0.1.3") < 0);
});

test("computeDepsHash 忽略 @chat-lite/shared 且与键顺序无关", () => {
  const h1 = computeDepsHash({ "@chat-lite/shared": "workspace:*", sharp: "^0.34.3", "socket.io-client": "^4.8.1" });
  const h2 = computeDepsHash({ "socket.io-client": "^4.8.1", sharp: "^0.34.3" });
  const h3 = computeDepsHash({ sharp: "^0.35.0", "socket.io-client": "^4.8.1" });
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
});

test("isAllowedBundleFilePath 拦截路径穿越和非法文件", () => {
  assert.equal(isAllowedBundleFilePath("app/dist/index.js"), true);
  assert.equal(isAllowedBundleFilePath("app/package.json"), true);
  assert.equal(isAllowedBundleFilePath("使用手册.md"), true);
  assert.equal(isAllowedBundleFilePath("../evil.js"), false);
  assert.equal(isAllowedBundleFilePath("app/dist/../../etc/passwd"), false);
  assert.equal(isAllowedBundleFilePath("app/dist/shell.sh"), false);
  assert.equal(isAllowedBundleFilePath("/abs/path.js"), false);
});

test("applyUpdateBundle 校验 SHA-256 与 depsHash 后原子替换 dist、package.json 与使用手册", () => {
  const root = mkdtempSync(join(tmpdir(), "chat-lite-updater-"));
  try {
    const appDir = join(root, "app");
    const distDir = join(appDir, "dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(root, "chat-lite"), "#!/bin/sh\n");
    const deps = { sharp: "^0.34.3", "socket.io-client": "^4.8.1" };
    writeFileSync(join(appDir, "package.json"), JSON.stringify({ name: "chat-lite-cli", version: "0.1.2", dependencies: deps }));
    writeFileSync(join(distDir, "index.js"), "// old v0.1.2\n");
    writeFileSync(join(root, "使用手册.md"), "old manual");

    const depsHash = computeDepsHash(deps);
    const nextPkg = JSON.stringify({ name: "chat-lite-cli", version: "0.1.3", dependencies: deps }, null, 2);
    const bundleObj = {
      version: "0.1.3",
      depsHash,
      files: {
        "app/dist/index.js": Buffer.from("// new v0.1.3\n", "utf8").toString("base64"),
        "app/dist/helper.js": Buffer.from("exports.ok = true;\n", "utf8").toString("base64"),
        "app/package.json": Buffer.from(nextPkg, "utf8").toString("base64"),
        "使用手册.md": Buffer.from("new manual v0.1.3", "utf8").toString("base64"),
      },
    };
    const gz = gzipSync(Buffer.from(JSON.stringify(bundleObj), "utf8"));
    const sha256 = createHash("sha256").update(gz).digest("hex");

    const layout = { appDir, distDir, bundleRoot: root, isDevCheckout: false };

    // Bad SHA-256 must reject without modifying disk
    assert.throws(
      () => applyUpdateBundle(gz, { version: "0.1.3", sha256: "0".repeat(64), depsHash, minNodeMajor: 20 }, layout),
      /SHA-256/,
    );
    assert.equal(readFileSync(join(distDir, "index.js"), "utf8"), "// old v0.1.2\n");

    // Valid bundle upgrades cleanly
    const result = applyUpdateBundle(gz, { version: "0.1.3", sha256, depsHash, minNodeMajor: 20 }, layout);
    assert.equal(result.version, "0.1.3");
    assert.equal(result.fileCount, 2);
    assert.equal(readFileSync(join(distDir, "index.js"), "utf8"), "// new v0.1.3\n");
    assert.equal(existsSync(join(distDir, "helper.js")), true);
    assert.equal(JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")).version, "0.1.3");
    assert.equal(readFileSync(join(root, "使用手册.md"), "utf8"), "new manual v0.1.3");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
