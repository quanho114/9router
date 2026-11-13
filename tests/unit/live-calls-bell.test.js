import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatCompactTokens,
  formatRelativeTime,
  normalizeLiveCallsPayload,
} from "@/shared/utils/liveCalls.js";

const mocks = vi.hoisted(() => ({
  getUsageStats: vi.fn(),
  getActiveRequests: vi.fn(),
  statsEmitter: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
}));

vi.mock("@/lib/usageDb", () => ({
  getUsageStats: mocks.getUsageStats,
  getActiveRequests: mocks.getActiveRequests,
  statsEmitter: mocks.statsEmitter,
}));

const { GET } = await import("../../src/app/api/usage/stream/route.js");

async function readFirstSseEvent(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!buffer.includes("\n\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  const dataLine = buffer.split("\n").find((l) => l.startsWith("data: "));
  return dataLine ? JSON.parse(dataLine.slice(6)) : null;
}

describe("Live Calls Bell helpers & SSE ?live=1 stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUsageStats.mockResolvedValue({ totalRequests: 42 });
    mocks.getActiveRequests.mockResolvedValue({
      activeRequests: [
        { model: "gemini-4-hydrogen-high", provider: "antigravity", account: "user@gmail.com", count: 1 },
      ],
      recentRequests: [],
      errorProvider: "",
      pending: {
        byModel: { "gemini-4-hydrogen-high (antigravity)": 1 },
        byAccount: {},
      },
    });
  });

  it("skips getUsageStats when ?live=1 is passed", async () => {
    const ac = new AbortController();
    const res = await GET({ url: "http://localhost:20128/api/usage/stream?live=1", signal: ac.signal });
    const payload = await readFirstSseEvent(res);
    ac.abort();

    expect(mocks.getUsageStats).not.toHaveBeenCalled();
    expect(mocks.getActiveRequests).toHaveBeenCalledTimes(1);
    expect(payload.totalRequests).toBeUndefined();
    expect(payload.activeRequests).toEqual([
      { model: "gemini-4-hydrogen-high", provider: "antigravity", account: "user@gmail.com", count: 1 },
    ]);
  });

  it("preserves full getUsageStats when ?live=1 is omitted", async () => {
    const ac = new AbortController();
    const res = await GET({ url: "http://localhost:20128/api/usage/stream", signal: ac.signal });
    const payload = await readFirstSseEvent(res);
    ac.abort();

    expect(mocks.getUsageStats).toHaveBeenCalledTimes(1);
    expect(payload.totalRequests).toBe(42);
    expect(payload.activeRequests).toHaveLength(1);
  });

  it("reconciles unattributed pending.byModel counts alongside activeRequests", () => {
    const normalized = normalizeLiveCallsPayload({
      activeRequests: [
        { model: "claude-sonnet-4-6", provider: "claude", account: "work@co.io", count: 2 },
      ],
      pending: {
        byModel: {
          "claude-sonnet-4-6 (claude)": 2,
          "qwen3:8b (ollama-local)": 1,
        },
      },
      recentRequests: [
        { timestamp: "2026-11-13T08:00:00.000Z", model: "gpt-5", provider: "codex", promptTokens: 1200, completionTokens: 350, status: "ok" },
      ],
      errorProvider: "cursor",
    });

    expect(normalized.totalActive).toBe(3);
    expect(normalized.activeCalls).toEqual([
      { model: "claude-sonnet-4-6", provider: "claude", account: "work@co.io", count: 2 },
      { model: "qwen3:8b", provider: "ollama-local", account: "", count: 1 },
    ]);
    expect(normalized.recentCalls).toHaveLength(1);
    expect(normalized.errorProvider).toBe("cursor");
  });

  it("formats relative times and compact token counts", () => {
    const base = Date.UTC(2026, 10, 13, 8, 5, 0);
    expect(formatRelativeTime(new Date(base - 1500).toISOString(), base)).toBe("just now");
    expect(formatRelativeTime(new Date(base - 18000).toISOString(), base)).toBe("18s ago");
    expect(formatRelativeTime(new Date(base - 180000).toISOString(), base)).toBe("3m ago");

    expect(formatCompactTokens(420)).toBe("420");
    expect(formatCompactTokens(1500)).toBe("1.5k");
    expect(formatCompactTokens(2_000_000)).toBe("2M");
  });
});
