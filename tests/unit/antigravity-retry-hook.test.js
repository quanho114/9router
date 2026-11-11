// Guards D3: antigravity 429/503 retry merged into base via computeRetryDelay hook.
import { describe, it, expect } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import antigravity from "../../open-sse/providers/registry/antigravity.js";

const MAX = 10000;
function res(status, headers = {}, body = null) {
  return {
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    clone: () => ({ text: async () => (body == null ? "" : JSON.stringify(body)) }),
  };
}

describe("antigravity computeRetryDelay hook (D3)", () => {
  const ag = new AntigravityExecutor();

  it("uses Retry-After header (seconds → ms) when within cap", async () => {
    expect(await ag.computeRetryDelay(res(429, { "retry-after": "5" }), 1)).toBe(5000);
  });

  it("vetoes (false) when Retry-After exceeds cap", async () => {
    expect(await ag.computeRetryDelay(res(429, { "retry-after": "60" }), 1)).toBe(false);
  });

  it("parses retry time from error body when no header", async () => {
    const r = res(429, {}, { error: { message: "quota will reset after 3s" } });
    expect(await ag.computeRetryDelay(r, 1)).toBe(3000);
  });

  it("vetoes retry immediately when error.details quotaResetTimeStamp or retryDelay exceeds cap", async () => {
    const futureIso = new Date(Date.now() + 3600_000).toISOString();
    const byTimestamp = res(429, {}, {
      error: {
        message: "Resource has been exhausted (e.g. check quota).",
        details: [{ metadata: { quotaResetTimeStamp: futureIso } }],
      },
    });
    expect(await ag.computeRetryDelay(byTimestamp, 1)).toBe(false);

    const byRetryInfo = res(429, {}, {
      error: {
        message: "Resource has been exhausted.",
        details: [{ retryDelay: "120s" }],
      },
    });
    expect(await ag.computeRetryDelay(byRetryInfo, 1)).toBe(false);

    const zeroLimit = res(429, {}, {
      error: {
        message: "Quota exceeded for quota metric",
        details: [{ metadata: { quotaLimitValue: "0" } }],
      },
    });
    expect(await ag.computeRetryDelay(zeroLimit, 1)).toBe(false);
  });

  it("uses short retryDelay from error.details when within cap", async () => {
    const r = res(429, {}, {
      error: {
        message: "Rate limit reached",
        details: [{ retryDelay: "4s" }],
      },
    });
    expect(await ag.computeRetryDelay(r, 1)).toBe(4000);
  });

  it("exponential backoff for 429 when no retry info", async () => {
    expect(await ag.computeRetryDelay(res(429), 1)).toBe(Math.min(1000 * 2 ** 1, MAX));
    expect(await ag.computeRetryDelay(res(429), 3)).toBe(Math.min(1000 * 2 ** 3, MAX));
  });

  it("503 without retry info → transient backoff", async () => {
    expect(await ag.computeRetryDelay(res(503), 1)).toBe(2000);
  });

  it("retries Antigravity agent terminated body even when status is not 429", async () => {
    const r = res(500, {}, { error: { message: "Agent execution terminated due to error" } });
    expect(await ag.computeRetryDelay(r, 1)).toBe(2000);
  });

  it("retries high traffic body", async () => {
    const r = res(500, {}, { error: { message: "Our servers are experiencing high traffic" } });
    expect(await ag.computeRetryDelay(r, 2)).toBe(4000);
  });

  it("does not retry non-transient 400 errors", async () => {
    const r = res(400, {}, { error: { message: "Invalid request" } });
    expect(await ag.computeRetryDelay(r, 1)).toBe(false);
  });

  it("deduplicates sanitized tool names", () => {
    const out = ag.transformRequest("claude-opus-4-6-thinking", {
      request: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [{ functionDeclarations: [
          { name: "read/file", parameters: { type: "object", properties: {} } },
          { name: "read file", parameters: { type: "object", properties: {} } },
          { name: "read/file", parameters: { type: "object", properties: {} } },
        ] }],
      },
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    expect(out.request.tools[0].functionDeclarations.map(fn => fn.name)).toEqual(["read_file"]);
  });

  it("registry uses the daily IDE cloudcode host and user agent", () => {
    expect(antigravity.transport.baseUrls).toEqual(["https://daily-cloudcode-pa.googleapis.com"]);
    expect(antigravity.transport.headers["User-Agent"]).toBe("antigravity/hub/2.24.0 darwin/arm64");
  });

  it("buildHeaders matches official IDE stream headers", () => {
    ag._lastSessionId = "sess-123";
    const h = ag.buildHeaders({ accessToken: "tok" }, true);
    expect(h["User-Agent"]).toBe("antigravity/hub/2.24.0 darwin/arm64");
    expect(h["Content-Type"]).toBe("application/json");
    expect(h["Authorization"]).toBe("Bearer tok");
    expect(h).not.toHaveProperty("X-Machine-Session-Id");
    expect(h).not.toHaveProperty("x-request-source");
    expect(h).not.toHaveProperty("Accept");
  });

  it("transforms chat requests with official IDE requestId shape and 64000 token cap", () => {
    const out = ag.transformRequest("claude-opus-4-6-thinking", {
      request: {
        contents: [
          { role: "user", parts: [{ text: "hi" }] },
          { role: "model", parts: [{ text: "hello" }] },
        ],
        generationConfig: { maxOutputTokens: 90000 },
        sessionId: "-3750763034362895579",
      },
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    expect(out.requestId).toMatch(/^agent\/[0-9a-f-]{36}\/\d{13}\/[0-9a-f-]{36}\/\d+$/);
    expect(out.request.generationConfig.maxOutputTokens).toBe(64000);
  });

  it("scales connect timeout with payload size and caps at 200s", () => {
    expect(ag.getConnectTimeoutMs("gemini-4-argon-high", 2_000)).toBe(15_000);
    expect(ag.getConnectTimeoutMs("claude-sonnet-5-5-medium", 2_000)).toBe(12_000);
    expect(ag.getConnectTimeoutMs("gemini-4-argon-high", 96_000)).toBe(23_000);
    expect(ag.getConnectTimeoutMs("gemini-4-argon-high", 5_000_000)).toBe(200_000);
    expect(ag.getConnectTimeoutMs("gemini-4-argon-high", 2_000, { connectTimeoutMs: 9_000 })).toBe(9_000);
  });

  it("does not retry connect timeouts on the same account", async () => {
    let calls = 0;
    await expect(
      ag.execute({
        model: "gemini-4-argon-high",
        body: { request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] } },
        stream: true,
        credentials: { accessToken: "tok", projectId: "proj-1" },
        providerOverrides: { connectTimeoutMs: 25 },
        directFetch: (_url, init) => new Promise((_resolve, reject) => {
          calls++;
          init.signal.addEventListener("abort", () => reject(init.signal.reason || new DOMException("Aborted", "AbortError")));
        }),
      })
    ).rejects.toThrow(/fetch connect timeout/);
    expect(calls).toBe(1);
  });
});
