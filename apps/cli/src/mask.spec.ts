import assert from "node:assert/strict";
import test from "node:test";
import { allMaskSkinKeys, isValidMaskPreference, MASK_SKINS, resolveMaskSkin } from "./mask";
import { highlightKeyword, matchesSearchQuery } from "./format";

test("mask 皮肤解析支持 codex/claude/build/k8s/random 且未知值回退 codex", () => {
  assert.equal(MASK_SKINS.length, 4);
  assert.equal(resolveMaskSkin("claude").id, "claude");
  assert.equal(resolveMaskSkin("build").id, "build");
  assert.equal(resolveMaskSkin("k8s").id, "k8s");
  assert.equal(resolveMaskSkin("unknown").id, "codex");
  assert.ok(allMaskSkinKeys().includes("random"));
  assert.equal(isValidMaskPreference("k8s"), true);
  assert.equal(isValidMaskPreference("random"), true);
  assert.equal(isValidMaskPreference("nope"), false);
  const rand = resolveMaskSkin("random");
  assert.ok(MASK_SKINS.some((s) => s.id === rand.id));
});

test("matchesSearchQuery 支持正文、像素表情标签、附件名、引用和发送人不区分大小写检索", () => {
  const base = {
    id: "m1",
    clientId: "c1",
    conversationId: "g1",
    createdAt: new Date().toISOString(),
    sender: { id: "u2", username: "alice", displayName: "Alice" },
    attachments: [],
  };

  assert.equal(
    matchesSearchQuery({ message: { ...base, text: "下午三点发版 Release" }, content: { text: "下午三点发版 Release", attachments: [] } }, "release"),
    true,
  );
  assert.equal(
    matchesSearchQuery({ message: { ...base, text: "[px:eyes] 看看热闹" }, content: { text: "[px:eyes] 看看热闹", attachments: [] } }, "吃瓜"),
    true,
  );
  assert.equal(
    matchesSearchQuery({
      message: { ...base, text: "收到" },
      content: { text: "收到", attachments: [], replyTo: { id: "m0", senderName: "Bob", preview: "部署脚本报错" } },
    }, "部署脚本"),
    true,
  );
  assert.equal(
    matchesSearchQuery({ message: { ...base, text: "hello" }, content: { text: "hello", attachments: [] } }, "不存在的词"),
    false,
  );
});

test("highlightKeyword 保留原始大小写并高亮命中子串", () => {
  const out = highlightKeyword("Check Deploy and deploy log", "deploy", (s) => s);
  assert.ok(out.includes("Deploy"));
  assert.ok(out.includes("deploy"));
});
