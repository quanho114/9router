import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ stats: vi.fn(), live: vi.fn() }));
vi.mock("@/lib/usageDb", async () => {
  const { EventEmitter } = await import("node:events");
  return { getUsageStats: fx.stats, getActiveRequests: fx.live, statsEmitter: new EventEmitter() };
});
const { GET } = await import("../../src/app/api/usage/stream/route.js");
const { statsEmitter } = await import("@/lib/usageDb");
const active = [{ model: "argon", provider: "antigravity", count: 1 }];
const idle = { activeRequests: [], recentRequests: [], errorProvider: "", pending: { byModel: {}, byAccount: {} } };
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
async function read(reader) {
  const { value } = await reader.read();
  return JSON.parse(new TextDecoder().decode(value).slice(6).trim());
}

describe("usage stream state reconciliation", () => {
  let abort;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    abort = new AbortController();
    fx.stats.mockResolvedValue({ totalRequests: 1, activeRequests: active });
    fx.live.mockResolvedValue({ ...idle, activeRequests: active });
  });
  afterEach(() => {
    abort.abort();
    statsEmitter.removeAllListeners();
    vi.useRealTimers();
  });
  const open = async () => (await GET(new Request("http://localhost/api/usage/stream", { signal: abort.signal }))).body.getReader();

  it("reconciles a missed completion without another usage event or historical query", async () => {
    const reader = await open();
    expect((await read(reader)).activeRequests).toEqual(active);
    fx.live.mockResolvedValue(idle);
    await vi.advanceTimersByTimeAsync(3000);
    const update = await read(reader);
    expect(update.activeRequests).toEqual([]);
    expect(update.pending.byModel).toEqual({});
    expect(fx.stats).toHaveBeenCalledTimes(1);
  });

  it("listens for completion while the initial historical read is in flight", async () => {
    let resolve;
    fx.stats.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const reader = await open();
    expect(statsEmitter.listenerCount("pending")).toBe(1);
    fx.live.mockResolvedValue(idle);
    statsEmitter.emit("pending");
    resolve({ totalRequests: 1, activeRequests: active });
    expect((await read(reader)).activeRequests).toEqual([]);
    expect((await read(reader)).activeRequests).toEqual([]);
  });

  it("does not let a delayed full refresh restore a completed provider", async () => {
    const reader = await open();
    await read(reader);
    let resolve;
    fx.stats.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    statsEmitter.emit("update");
    fx.live.mockResolvedValue({ ...idle, recentRequests: [{ provider: "codex", model: "gpt" }] });
    statsEmitter.emit("pending");
    resolve({ totalRequests: 2, activeRequests: active });
    const latest = await read(reader);
    expect(latest.activeRequests).toEqual([]);
    expect(latest.recentRequests[0].provider).toBe("codex");
    expect((await read(reader)).activeRequests).toEqual([]);
  });

  it("releases listeners and timers on cancellation and request abort", async () => {
    const reader = await open();
    await read(reader);
    await reader.cancel();
    expect(statsEmitter.listenerCount("pending")).toBe(0);
    expect(statsEmitter.listenerCount("update")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const second = await open();
    await read(second);
    abort.abort();
    await flush();
    expect(await second.read()).toEqual({ value: undefined, done: true });
    expect(statsEmitter.listenerCount("pending")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
