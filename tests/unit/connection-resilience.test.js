import { afterEach, describe, expect, it, vi } from "vitest";
import { enterConnection, getConnectionResilienceSnapshot } from "@/sse/services/connectionResilience.js";
import { withResponseFinalizer } from "@/sse/utils/responseLifecycle.js";

const config = { maxConcurrent: 2, queueTimeoutMs: 100, failureThreshold: 1, cooldownMs: 5000 };

describe("connection resilience", () => {
  afterEach(() => vi.useRealTimers());

  it("ignores a late success from before the circuit opened and admits a single recovery probe", async () => {
    vi.useFakeTimers();
    const first = enterConnection("openai", "breaker", config);
    const late = enterConnection("openai", "breaker", config);
    first.complete("failure");
    late.complete("success");
    expect(enterConnection("openai", "breaker", config).retryAt).toBe(Date.now() + 5000);
    await vi.advanceTimersByTimeAsync(5000);

    const probe = enterConnection("openai", "breaker", config);
    expect(probe.complete).toBeTypeOf("function");
    expect(enterConnection("openai", "breaker", config).retryAt).toBeGreaterThan(Date.now());
    probe.complete("success");
    expect(getConnectionResilienceSnapshot().find((c) => c.connectionId === "breaker").state).toBe("closed");
  });

  it("times out or aborts queued requests and returns a slot when an SSE client cancels", async () => {
    vi.useFakeTimers();
    const oneSlot = { ...config, maxConcurrent: 1 };
    const first = enterConnection("openai", "queue", oneSlot);
    const abort = new AbortController();
    const canceled = enterConnection("openai", "queue", oneSlot, abort.signal);
    abort.abort();
    await expect(canceled).resolves.toEqual({ aborted: true });
    const waiting = enterConnection("openai", "queue", oneSlot);
    await vi.advanceTimersByTimeAsync(100);
    await expect(waiting).resolves.toHaveProperty("retryAt");

    const next = enterConnection("openai", "queue", oneSlot);
    const source = new ReadableStream({ cancel: vi.fn() });
    const stream = withResponseFinalizer(new Response(source), () => first.complete("cancel"));
    await stream.body.cancel();
    const admitted = await next;
    expect(admitted.complete).toBeTypeOf("function");
    admitted.complete("success");
    expect(getConnectionResilienceSnapshot().find((c) => c.connectionId === "queue"))
      .toMatchObject({ active: 0, queued: 0, state: "closed" });
  });
});
