import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trackKeySpendWrite } from "@/lib/db/keySpendWrites.js";
import { getDailyKeySpend } from "@/lib/db/repos/keySpendRepo.js";
import { getDailySpendDenial, withKeySpendBudget } from "@/sse/services/keySpendBudget.js";

const db = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => db }));

const ctx = { dailyLimitUsd: 0.5 };

describe("daily USD limit", () => {
  beforeEach(() => db.get.mockReset().mockReturnValue({ spend: 0 }));
  afterEach(() => vi.useRealTimers());

  it("uses UTC boundaries and blocks at the recorded spend threshold", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T23:59:00Z"));
    db.get.mockReturnValue({ spend: 0.49999999999999994 });
    await expect(getDailyKeySpend("key")).resolves.toHaveProperty("dailySpendResetAt", "2026-09-03T00:00:00.000Z");
    expect(db.get.mock.calls[0][1]).toEqual(["key", "2026-09-02T00:00:00.000Z", "2026-09-03T00:00:00.000Z"]);
    await expect(getDailySpendDenial("key", ctx.dailyLimitUsd)).resolves.toMatchObject({ status: 429, retryAfter: 60 });
    vi.setSystemTime(new Date("2026-09-03T00:00:00Z"));
    db.get.mockReturnValue({ spend: 0 });
    await expect(getDailySpendDenial("key", ctx.dailyLimitUsd)).resolves.toBeNull();
  });

  it("serializes metered streaming and waits for usage writes before releasing a key", async () => {
    const write = Promise.withResolvers();
    const response = await withKeySpendBudget(ctx, "key", async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: done\n\n"));
          controller.close();
          trackKeySpendWrite("key", write.promise);
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    });
    const done = response.text();
    const operation = vi.fn(() => Response.json({}));
    const busy = await withKeySpendBudget(ctx, "key", operation);
    expect(busy.status).toBe(429);
    expect(operation).not.toHaveBeenCalled();

    db.get.mockReturnValue({ spend: 0.5 });
    write.resolve();
    expect(await done).toBe("data: done\n\n");
    const capped = await withKeySpendBudget(ctx, "key", operation);
    expect(capped.status).toBe(429);
    expect(await capped.json()).toMatchObject({ error: { message: expect.stringContaining("daily USD limit") } });
    expect(operation).not.toHaveBeenCalled();
  });
});
