import assert from "node:assert/strict";
import test from "node:test";
import { Transport } from "./client";
import type { Secrets } from "./store";

test("Transport 并发收到 401 时仅触发一次单次刷新令牌轮换，全部并发请求均可成功重试", async () => {
  const originalFetch = globalThis.fetch;
  let validAccessToken = "at-new";
  let validRefreshToken = "rt-1";
  let refreshCallCount = 0;

  let persisted: Secrets = { identities: {}, refreshToken: "rt-1" };

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/auth/refresh")) {
      refreshCallCount += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as { refreshToken?: string };
      // Simulate server latency so concurrent 401s overlap
      await new Promise((r) => setTimeout(r, 25));
      if (body.refreshToken !== validRefreshToken) {
        return new Response(JSON.stringify({ message: "刷新令牌已失效" }), { status: 401 });
      }
      // Single-use refresh token rotation
      validRefreshToken = `rt-${refreshCallCount + 1}`;
      validAccessToken = `at-fresh-${refreshCallCount}`;
      return new Response(JSON.stringify({
        accessToken: validAccessToken,
        refreshToken: validRefreshToken,
        user: { id: "u1", username: "demo", displayName: "Demo" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const headers = new Headers(init?.headers);
    const auth = headers.get("Authorization");
    if (auth !== `Bearer ${validAccessToken}`) {
      return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
    }
    return new Response(JSON.stringify({ ok: true, path: url }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const transport = new Transport(
      "https://mock.local",
      { identities: {}, refreshToken: "rt-1" },
      "at-expired",
      undefined,
      () => persisted,
      (next) => { persisted = next; },
    );

    const refreshedTokens: string[] = [];
    transport.onAccessTokenRefreshed((token) => refreshedTokens.push(token));

    const results = await Promise.all([
      transport.request<{ ok: boolean }>("/conversations"),
      transport.request<{ ok: boolean }>("/conversations/1/read", { method: "POST", body: "{}" }),
      transport.request<{ ok: boolean }>("/conversations/1/keys/latest"),
      transport.request<{ ok: boolean }>("/conversations"),
      transport.request<{ ok: boolean }>("/conversations"),
    ]);

    assert.equal(refreshCallCount, 1);
    assert.equal(results.every((item) => item.ok), true);
    assert.equal(persisted.refreshToken, "rt-2");
    assert.deepEqual(refreshedTokens, ["at-fresh-1"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
