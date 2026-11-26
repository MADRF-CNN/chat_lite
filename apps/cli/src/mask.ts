import { c } from "./color";

export type MaskSkinId = "codex" | "claude" | "build" | "k8s";
export type MaskSkinPreference = MaskSkinId | "random";

export type MaskSkin = {
  id: MaskSkinId;
  name: string;
  description: string;
  prompt: () => string;
  headerLines: (cwd: string) => string[];
  telemetryLine: (count: number) => string;
  fakeOutputLines: (prompt: string) => string[];
};

export const MASK_SKINS: MaskSkin[] = [
  {
    id: "codex",
    name: "OpenAI Codex",
    description: "代码生成交互终端（默认）",
    prompt: () => `${c.bold(c.brightCyan("codex"))} ${c.gray(">")} `,
    headerLines: (cwd) => [
      c.bold(c.brightWhite("OpenAI Codex (v0.14.2) [Interactive Shell]")),
      c.dim(`Workspace: ${cwd}`),
      c.dim("Model: codex-davinci-002-optimized | Context: 8k tokens | Mode: Code Synthesis"),
      c.gray("-".repeat(70)),
      c.dim("Type instructions or code prompt."),
      "",
    ],
    telemetryLine: (count) => c.dim(`[daemon] background telemetry synced (${count} items)`),
    fakeOutputLines: (prompt) => {
      const clean = prompt.slice(0, 60);
      const snippets = [
        `// [Codex] Synthesized implementation for "${clean}"
export async function processTask<T>(input: T[], options?: TaskOptions): Promise<Result<T>> {
  const pipeline = new StreamTransformer({ concurrency: 4, backpressure: true });
  const results = await pipeline.mapParallel(input, async (item) => {
    return transformNode(item, options?.strict ?? false);
  });
  return { status: "success", count: results.length, data: results };
}
// AST analysis complete: 0 warnings, optimized via inline heuristics.`,
        `# [Codex] Generated pipeline script for "${clean}"
def optimize_execution_flow(records: list[dict], threshold: float = 0.95) -> dict:
    """Vectorized stream processor with sliding window aggregation."""
    filtered = [r for r in records if r.get("score", 0) >= threshold]
    return {"total": len(records), "retained": len(filtered)}
# Compilation: LLVM IR generated (target: arm64-apple-darwin).`,
        `// [Codex] Concurrent worker implementation for "${clean}"
pub struct TaskDispatcher {
    pool: ThreadPool,
    metrics: Arc<AtomicU64>,
}
// Benchmark: latency 1.4us/op, memory footprint negligible.`,
      ];
      const selected = snippets[Math.floor(Math.random() * snippets.length)]!;
      return [
        c.dim("[codex] Analyzing instruction..."),
        c.dim("[codex] Generating candidate implementation (temperature=0.2):"),
        "",
        c.brightWhite(selected),
        "",
      ];
    },
  },
  {
    id: "claude",
    name: "Claude Code",
    description: "AI 编程助手终端界面",
    prompt: () => `${c.bold(c.brightYellow("claude"))} ${c.gray(">")} `,
    headerLines: (cwd) => [
      `${c.bold(c.brightWhite("Claude Code"))} ${c.dim("v1.0.32")} ${c.gray("·")} ${c.cyan("claude-sonnet-4-5")}`,
      c.dim(`Directory: ${cwd}`),
      c.dim("Permissions: Read, Edit, Bash(sandbox) | Context: 18% / 200k tokens"),
      c.gray("-".repeat(70)),
      c.dim("Enter a coding task or /help for commands."),
      "",
    ],
    telemetryLine: (count) => c.dim(`[hook] workspace file watcher synced (${count} events)`),
    fakeOutputLines: (prompt) => {
      const clean = prompt.slice(0, 56);
      return [
        c.dim(`* Thinking about "${clean}"...`),
        `${c.cyan("Read")}(src/services/scheduler.ts:1-84)`,
        `${c.cyan("Edit")}(src/services/scheduler.ts) ${c.green("+12")} ${c.red("-4")}`,
        `${c.cyan("Bash")}(pnpm --filter @app/core test)`,
        c.dim("  PASS src/services/scheduler.spec.ts (14 tests, 128ms)"),
        c.brightWhite("Updated the handler with idempotent retry guards and verified all unit tests pass."),
        "",
      ];
    },
  },
  {
    id: "build",
    name: "Docker / CI Build",
    description: "前端打包与 Docker BuildKit 构建日志",
    prompt: () => `${c.bold(c.brightGreen("build"))} ${c.gray("$")} `,
    headerLines: (cwd) => [
      c.bold(c.brightWhite("Docker BuildKit v0.18.2 · Vite Production Pipeline")),
      c.dim(`Context: ${cwd}`),
      c.dim("Target: linux/amd64 | Cache: registry-inline | Workers: 8"),
      c.gray("-".repeat(70)),
      c.dim("[+] Building 3.8s (11/11) FINISHED  docker:desktop-linux"),
      "",
    ],
    telemetryLine: (count) => c.dim(`[buildkit] layer cache check ok (#${count} cached)`),
    fakeOutputLines: (prompt) => {
      const clean = prompt.slice(0, 48);
      return [
        c.dim(`=> [internal] load build context (${clean})`),
        c.dim("=> [builder 3/5] RUN pnpm --filter @web/app build              1.9s"),
        c.dim("   dist/assets/vendor-D8f2kA.js    142.3 kB | gzip: 44.8 kB"),
        c.dim("   dist/assets/index-C91mPq.js      38.7 kB | gzip: 12.1 kB"),
        c.green("=> exporting to image                                          0.4s"),
        c.brightWhite("Done in 2.34s (0 errors, 0 warnings)."),
        "",
      ];
    },
  },
  {
    id: "k8s",
    name: "Kubernetes / kubectl",
    description: "线上集群运维监控终端",
    prompt: () => `${c.bold(c.brightBlue("k8s"))} ${c.gray("$")} `,
    headerLines: () => [
      c.bold(c.brightWhite("kubectl · context: prod-cn-east-1 (namespace: core-gateway)")),
      c.dim("Cluster: v1.31.4-eks | API Server: healthy | Watch: active"),
      c.gray("-".repeat(70)),
      c.dim("NAME                              READY   STATUS    RESTARTS   AGE"),
      c.dim("api-gateway-7d9f8c6b4-x9k2p       1/1     Running   0          6d14h"),
      c.dim("worker-stream-6c8b7d5f9-m4n8q     1/1     Running   0          6d14h"),
      "",
    ],
    telemetryLine: (count) => c.dim(`[informer] pod watch heartbeat ok (rv=${904120 + count})`),
    fakeOutputLines: (prompt) => {
      const clean = prompt.slice(0, 40);
      return [
        c.dim(`$ kubectl get pods -l app=${clean.replace(/\s+/g, "-").toLowerCase() || "gateway"}`),
        c.brightWhite("NAME                              READY   STATUS    RESTARTS   AGE"),
        c.green("gateway-canary-5b7d9f8c2-k2j9m    1/1     Running   0          42m"),
        c.green("gateway-stable-7d9f8c6b4-p8q3w    1/1     Running   0          6d14h"),
        c.dim("Rollout status: all replicas available (p99 latency 14.2ms)."),
        "",
      ];
    },
  },
];

const SKIN_MAP = new Map<MaskSkinId, MaskSkin>(MASK_SKINS.map((s) => [s.id, s]));

export function isValidMaskPreference(value: string): value is MaskSkinPreference {
  return value === "random" || SKIN_MAP.has(value as MaskSkinId);
}

export function resolveMaskSkin(pref?: string): MaskSkin {
  if (pref === "random") {
    return MASK_SKINS[Math.floor(Math.random() * MASK_SKINS.length)]!;
  }
  if (pref && SKIN_MAP.has(pref as MaskSkinId)) {
    return SKIN_MAP.get(pref as MaskSkinId)!;
  }
  return MASK_SKINS[0]!;
}

export function allMaskSkinKeys(): string[] {
  return [...MASK_SKINS.map((s) => s.id), "random"];
}
