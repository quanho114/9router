import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
let db;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-api-key-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  global._dbAdapter = { instance: null, initPromise: null, logged: false };
  global._recentRing = { items: [], initialized: false };
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterEach(() => {
  delete process.env.DATA_DIR;
});

describe("Usage stats API key attribution", () => {
  it("reports output cost at the model rate for live and daily usage", async () => {
    const request = {
      provider: "codex",
      model: "gpt-6.1-sol(low)",
      connectionId: "c1",
      apiKey: "sk-test-cost-breakdown",
      endpoint: "/v1/responses",
      tokens: { prompt_tokens: 100_000, cached_tokens: 80_000, completion_tokens: 100 },
    };
    await db.saveRequestUsage(request);

    for (const period of ["24h", "7d"]) {
      const stats = await db.getUsageStats(period);
      for (const group of [stats.byModel, stats.byAccount, stats.byApiKey, stats.byEndpoint]) {
        const [entry] = Object.values(group);
        expect(entry.inputCost).toBeCloseTo(0.04, 10);
        expect(entry.cachedCost).toBeCloseTo(0.008, 10);
        expect(entry.outputCost).toBeCloseTo(0.001, 10);
        expect(entry.cost).toBeCloseTo(0.049, 10);
      }
    }
  });

  it("estimates older usage with a missing price and combines it with newly priced usage", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const model = "gpt-6.1-sol(low)";
    const provider = "codex";
    const timestamp = new Date();
    const dateKey = [timestamp.getFullYear(), timestamp.getMonth() + 1, timestamp.getDate()]
      .map((part) => String(part).padStart(2, "0")).join("-");
    const totals = { requests: 1, promptTokens: 1000, completionTokens: 100, cost: 0 };
    const tokens = { prompt_tokens: 1000, completion_tokens: 100 };
    adapter.run(
      "INSERT INTO usageHistory(timestamp, provider, model, promptTokens, completionTokens, cost, tokens) VALUES(?, ?, ?, ?, ?, ?, ?)",
      [timestamp.toISOString(), provider, model, 1000, 100, 0, JSON.stringify(tokens)]
    );
    adapter.run("INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)", [dateKey, JSON.stringify({
      ...totals, byProvider: { [provider]: totals }, byModel: { [`${model}|${provider}`]: totals },
    })]);
    await db.saveRequestUsage({ provider, model, tokens, timestamp: new Date(timestamp.getTime() - 1).toISOString() });

    for (const period of ["24h", "7d"]) {
      const stats = await db.getUsageStats(period);
      const [entry] = Object.values(stats.byModel);
      expect(entry.requests).toBe(2);
      expect(entry.outputCost).toBeCloseTo(0.002, 10);
      expect(stats.totalCost).toBeCloseTo(0.003, 10);
    }
  });

  it("charges completed response tokens exactly once, without repeated deductions", async () => {
    const key = await db.createApiKey("live quota", "test-machine", { maxInputTokens: 1000, maxOutputTokens: 500 });
    const response = {
      timestamp: "2026-11-12T01:00:00.000Z",
      provider: "openai", model: "gpt-4", connectionId: "live-connection",
      apiKey: key.key, tokens: { prompt_tokens: 10, completion_tokens: 3 }, status: "ok",
    };
    await db.saveRequestUsage(response);
    let stored = await db.getApiKeyByKey(key.key);
    expect(stored.usedInputTokens).toBe(10);
    expect(stored.maxOutputTokens - stored.usedOutputTokens).toBe(497);
    await db.saveRequestUsage({ ...response });
    stored = await db.getApiKeyByKey(key.key);
    expect(stored.usedInputTokens).toBe(10);
    expect(stored.maxOutputTokens - stored.usedOutputTokens).toBe(497);
    await db.saveRequestUsage({ ...response, timestamp: "2026-11-12T01:00:01.000Z", tokens: { prompt_tokens: 20, completion_tokens: 7 } });
    stored = await db.getApiKeyByKey(key.key);
    expect(stored.usedInputTokens).toBe(30);
    expect(stored.maxOutputTokens - stored.usedOutputTokens).toBe(490);
  });

  it("keeps API keys with the same masked prefix in separate buckets", async () => {
    const apiKeyA = "sk-machine-aaaaaa-11111111";
    const apiKeyB = "sk-machine-bbbbbb-22222222";

    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4",
      connectionId: "c1",
      apiKey: apiKeyA,
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      endpoint: "/v1/chat",
      status: "ok",
    });

    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4",
      connectionId: "c1",
      apiKey: apiKeyB,
      tokens: { prompt_tokens: 20, completion_tokens: 10 },
      endpoint: "/v1/chat",
      status: "ok",
    });

    const stats = await db.getUsageStats("24h");
    const apiKeyEntries = Object.values(stats.byApiKey);

    expect(apiKeyEntries).toHaveLength(2);

    expect(
      apiKeyEntries
        .map((entry) => entry.promptTokens)
        .sort((a, b) => a - b)
    ).toEqual([10, 20]);
  });
});
