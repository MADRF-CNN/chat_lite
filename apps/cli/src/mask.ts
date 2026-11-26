import { homedir } from "node:os";
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

const useColor = () => !process.env.NO_COLOR && (process.stdout.isTTY || process.env.FORCE_COLOR !== undefined);

function rgb(r: number, g: number, b: number, text: string): string {
  return useColor() ? `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m` : text;
}

function shortCwd(cwd: string): string {
  const home = homedir();
  if (cwd === home) return "~";
  if (cwd.startsWith(`${home}/`) || cwd.startsWith(`${home}\\`)) {
    return `~${cwd.slice(home.length)}`;
  }
  return cwd;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `…${text.slice(-(maxLen - 1))}`;
}

function padRight(plain: string, width: number): string {
  return " ".repeat(Math.max(0, width - plain.length));
}

export const MASK_SKINS: MaskSkin[] = [
  {
    id: "codex",
    name: "OpenAI Codex",
    description: "OpenAI Codex CLI 交互终端（默认）",
    prompt: () => `${c.bold(c.brightWhite("›"))} `,
    headerLines: (cwd) => {
      const dir = truncate(shortCwd(cwd), 44);
      const innerW = 66;
      const borderTop = c.gray(`╭${"─".repeat(innerW)}╮`);
      const borderBot = c.gray(`╰${"─".repeat(innerW)}╯`);
      const row = (styled: string, plain: string) =>
        `${c.gray("│")} ${styled}${padRight(plain, innerW - 2)} ${c.gray("│")}`;

      const p1 = rgb(16, 163, 127, " ▗▄▖ ");
      const p2 = rgb(16, 163, 127, " ▐█▌ ");
      const p3 = rgb(16, 163, 127, " ▝▀▘ ");

      const l1Plain = "  ▄   >_ OpenAI Codex (v0.104.0)";
      const l1Styled = `${p1} ${c.bold(c.brightWhite(">_ OpenAI Codex"))} ${c.dim("(v0.104.0)")}`;

      const l2Plain = `  █   model:     gpt-5.3-codex high   /model to change`;
      const l2Styled = `${p2} ${c.dim("model:")}     ${c.brightWhite("gpt-5.3-codex high")}   ${c.dim("/model to change")}`;

      const l3Plain = `  ▀   directory: ${dir}`;
      const l3Styled = `${p3} ${c.dim("directory:")} ${c.brightWhite(dir)}`;

      return [
        borderTop,
        row("", ""),
        row(l1Styled, l1Plain),
        row(l2Styled, l2Plain),
        row(l3Styled, l3Plain),
        row("", ""),
        borderBot,
        "",
        c.dim("  Tip: Use /model to switch reasoning effort or ask anything about this repo."),
        "",
      ];
    },
    telemetryLine: (count) => c.dim(`• Background workspace index synced (${count} files checked)`),
    fakeOutputLines: (prompt) => {
      const clean = prompt.slice(0, 56);
      const snippets = [
        [
          c.dim(`• Working on "${clean}"...`),
          c.dim("• Explored 3 files in src/services/"),
          `${c.green("• Edited")} ${c.brightWhite("src/services/pipeline.ts")} ${c.green("(+14 -3)")}`,
          c.dim("• Ran pnpm --filter @app/core test"),
          `  ${c.green("✓")} 18 passed (214ms)`,
          c.brightWhite("Refactored stream backpressure handling and verified all tests pass."),
          "",
        ],
        [
          c.dim(`• Inspecting call graph for "${clean}"...`),
          c.dim("• Read src/runtime/dispatcher.ts:42-118"),
          `${c.green("• Edited")} ${c.brightWhite("src/runtime/dispatcher.ts")} ${c.green("(+9 -2)")}`,
          `  ${c.green("✓")} Typecheck & unit tests green (0 warnings)`,
          c.brightWhite("Added idempotent retry lock around concurrent token rotation."),
          "",
        ],
      ];
      return snippets[Math.floor(Math.random() * snippets.length)]!;
    },
  },
  {
    id: "claude",
    name: "Claude Code",
    description: "Claude Code 像素吉祥物终端界面",
    prompt: () => `${c.bold(c.brightWhite("❯"))} `,
    headerLines: (cwd) => {
      const dir = truncate(shortCwd(cwd), 44);
      const coral = (s: string) => rgb(217, 119, 87, s);
      const innerW = 66;
      const titlePlain = " Claude Code v2.1.14 ";
      const borderTop = `${coral("╭───")}${c.bold(c.brightWhite(" Claude Code "))}${c.dim("v2.1.14 ")}${coral("─".repeat(innerW - 3 - titlePlain.length) + "╮")}`;
      const borderBot = coral(`╰${"─".repeat(innerW)}╯`);
      const row = (styled: string, plain: string) =>
        `${coral("│")} ${styled}${padRight(plain, innerW - 2)} ${coral("│")}`;

      // Iconic Claude Code pixel mascot (Clawd) in Anthropic terracotta coral
      const m1 = coral("  ▐▛███▜▌  ");
      const m2 = coral(" ▝▜█████▛▘ ");
      const m3 = coral("   ▘▘ ▝▝   ");

      const r1Plain = "  xxxxxxx   Welcome back!";
      const r1Styled = `${m1} ${c.bold(c.brightWhite("Welcome back!"))}`;

      const r2Plain = " xxxxxxxxx  Opus 4.6 · Claude Max";
      const r2Styled = `${m2} ${c.brightWhite("Opus 4.6")} ${c.dim("· Claude Max")}`;

      const r3Plain = `   xx xx    ${dir}`;
      const r3Styled = `${m3} ${c.dim(dir)}`;

      return [
        borderTop,
        row("", ""),
        row(r1Styled, r1Plain),
        row(r2Styled, r2Plain),
        row(r3Styled, r3Plain),
        row("", ""),
        borderBot,
        "",
        c.dim("  Tips for getting started: Ask Claude to edit files, run tests, or explain code."),
        "",
      ];
    },
    telemetryLine: (count) => c.dim(`  ⎿  hook: workspace file watcher synced (${count} events)`),
    fakeOutputLines: (prompt) => {
      const clean = prompt.slice(0, 54);
      const coralDot = rgb(217, 119, 87, "●");
      return [
        c.dim(`✻ Thinking about "${clean}"…`),
        `${coralDot} ${c.bold(c.brightWhite("Read"))}(${c.dim("src/services/scheduler.ts")})`,
        c.dim("  ⎿  Read 84 lines"),
        `${coralDot} ${c.bold(c.brightWhite("Update"))}(${c.dim("src/services/scheduler.ts")})`,
        `  ${c.dim("⎿  Updated src/services/scheduler.ts with")} ${c.green("12 additions")} ${c.dim("and")} ${c.red("4 removals")}`,
        `${coralDot} ${c.bold(c.brightWhite("Bash"))}(${c.dim("pnpm --filter @app/core test")})`,
        `  ${c.dim("⎿")}  ${c.green("PASS")} ${c.dim("src/services/scheduler.spec.ts (14 tests, 128ms)")}`,
        `${coralDot} ${c.brightWhite("Done — added the guard and confirmed all unit tests pass.")}`,
        "",
      ];
    },
  },
  {
    id: "build",
    name: "Docker / CI Build",
    description: "前端打包与 Docker BuildKit 构建日志",
    prompt: () => `${c.bold(c.brightGreen("build"))} ${c.gray("$")} `,
    headerLines: (cwd) => {
      const dir = truncate(shortCwd(cwd), 48);
      const blue = (s: string) => rgb(36, 150, 237, s);
      return [
        `${blue(" ▗▖▗▖▗▖  ")} ${c.bold(c.brightWhite("Docker BuildKit v0.18.2 · Vite Production Pipeline"))}`,
        `${blue(" ██████▙ ")} ${c.dim(`Context: ${dir}`)}`,
        `${blue(" ▝█████▘ ")} ${c.dim("Target: linux/amd64 | Cache: registry-inline | Workers: 8")}`,
        c.gray("─".repeat(68)),
        c.dim("[+] Building 3.8s (11/11) FINISHED  docker:desktop-linux"),
        "",
      ];
    },
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
    headerLines: () => {
      const kblue = (s: string) => rgb(50, 108, 229, s);
      return [
        `${kblue("  ▗▟█▙▖  ")} ${c.bold(c.brightWhite("kubectl · context: prod-cn-east-1 (ns: core-gateway)"))}`,
        `${kblue(" ▐█▛▀▜█▌ ")} ${c.dim("Cluster: v1.31.4-eks | API Server: healthy | Watch: active")}`,
        `${kblue("  ▝▜█▛▘  ")} ${c.dim("Nodes: 12 Ready | Rollout: stable")}`,
        c.gray("─".repeat(68)),
        c.dim("NAME                              READY   STATUS    RESTARTS   AGE"),
        c.dim("api-gateway-7d9f8c6b4-x9k2p       1/1     Running   0          6d14h"),
        c.dim("worker-stream-6c8b7d5f9-m4n8q     1/1     Running   0          6d14h"),
        "",
      ];
    },
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
