import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { connections, prices } = vi.hoisted(() => ({
  connections: [
    { id: "subscription", provider: "codex" },
    { id: "expensive", provider: "openai" },
    { id: "cheap", provider: "deepseek" },
  ],
  prices: { codex: 10, openai: 20, deepseek: 1 },
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async (filter) => connections.filter((c) => !filter?.provider || c.provider === filter.provider),
  getPricingForModel: async (provider) => ({ input: prices[provider], output: prices[provider] }),
  getSettings: async () => ({}),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: async () => ({}) }));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async (target) => {
    const [provider, model] = target.split("/");
    return { provider, model };
  },
}));

const { orderComboTargets } = await import("@/sse/services/comboRouting.js");
const { rememberProviderQuota } = await import("@/sse/services/providerQuota.js");
const { getProviderCredentials } = await import("@/sse/services/auth.js");

describe("quota-aware combos", () => {
  const models = ["openai/gpt-5", "deepseek/deepseek-chat", "codex/gpt-5-codex"];
  const start = new Date("2026-01-01T00:00:00Z");
  const reset = "2026-01-01T01:00:00Z";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    rememberProviderQuota("subscription", {
      quotas: { session: { total: 100, remaining: 0, resetAt: reset } },
    });
  });
  afterEach(() => vi.useRealTimers());

  it("falls back to the cheapest available model and restores subscription priority after reset", async () => {
    await expect(orderComboTargets(models, "thrifty")).resolves.toEqual([models[1], models[0], models[2]]);
    await expect(getProviderCredentials("codex", null, "gpt-5-codex", { quotaStrategy: "thrifty" }))
      .resolves.toMatchObject({ allRateLimited: true, retryAfter: "2026-01-01T01:00:00.000Z" });

    vi.setSystemTime(new Date(reset));
    await expect(orderComboTargets(models, "thrifty")).resolves.toEqual([models[2], models[1], models[0]]);
    await expect(getProviderCredentials("codex", null, "gpt-5-codex", { quotaStrategy: "thrifty" }))
      .resolves.toMatchObject({ connectionId: "subscription" });
  });

  it("uses the scoped Codex quota and distinguishes headroom from reset ordering", async () => {
    rememberProviderQuota("subscription", {
      quotas: { session: { remainingPercentage: 0, resetAt: reset }, spark_session: { remainingPercentage: 90, resetAt: reset } },
    });
    rememberProviderQuota("cheap", {
      quotas: { "deepseek-chat": { remainingPercentage: 10, resetAt: "2026-01-01T00:10:00Z" } },
    });
    const sparkModels = [...models.slice(0, 2), "codex/gpt-5.3-codex-spark"];
    await expect(orderComboTargets(sparkModels, "quota-headroom")).resolves.toEqual([sparkModels[2], models[1], models[0]]);
    await expect(orderComboTargets(sparkModels, "reset-aware")).resolves.toEqual([models[1], sparkModels[2], models[0]]);
  });
});
