import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  getAntigravityUsage: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("open-sse/services/usage/google.js", () => ({
  getAntigravityUsage: mocks.getAntigravityUsage,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { getAntigravityQuotaCache, getAntigravityModelQuota, handleAntigravityQuotaError, handleAntigravityStallError, refreshAntigravityQuota, clearAntigravityStrikes } = await import("@/sse/services/antigravityQuota.js");
const { getProviderCredentials } = await import("@/sse/services/auth.js");

const MODEL = "claude-opus-4-6-thinking";
const FUTURE_RESET = "2026-09-01T00:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  getAntigravityQuotaCache().clear();
  mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  mocks.getSettings.mockResolvedValue({});
});

describe("Antigravity quota-aware routing", () => {
  it("records exhausted upstream quota after 429 and returns its exact reset time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {
      [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET },
    } });

    try {
      await expect(handleAntigravityQuotaError("ag-a", 429, MODEL, "token", {}))
        .resolves.toBe(Date.parse(FUTURE_RESET));
      expect(getAntigravityQuotaCache().get("ag-a")[MODEL]).toEqual({
        remainingPercentage: 0,
        resetAt: FUTURE_RESET,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips exhausted account/model and selects the next account", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getProviderConnections.mockResolvedValue([
      { id: "ag-a", email: "a@example.com", isActive: true },
      { id: "ag-b", email: "b@example.com", isActive: true },
    ]);
    getAntigravityQuotaCache().set("ag-a", {
      [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET },
    });

    try {
      await expect(getProviderCredentials("antigravity", null, MODEL)).resolves.toMatchObject({
        connectionId: "ag-b",
        connectionName: "b@example.com",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports retry time when every account is cache-blocked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getProviderConnections.mockResolvedValue([{ id: "ag-a", email: "a@example.com", isActive: true }]);
    getAntigravityQuotaCache().set("ag-a", {
      [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET },
    });

    try {
      await expect(getProviderCredentials("antigravity", null, MODEL)).resolves.toMatchObject({
        allRateLimited: true,
        retryAfter: FUTURE_RESET,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets account back into rotation once reset time has passed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:01.000Z"));
    mocks.getProviderConnections.mockResolvedValue([{ id: "ag-a", email: "a@example.com", isActive: true }]);
    getAntigravityQuotaCache().set("ag-a", {
      [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET },
    });

    try {
      await expect(getProviderCredentials("antigravity", null, MODEL)).resolves.toMatchObject({
        connectionId: "ag-a",
        connectionName: "a@example.com",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces concurrent quota refreshes for one account", async () => {
    let resolveUsage;
    mocks.getAntigravityUsage.mockReturnValue(new Promise(resolve => { resolveUsage = resolve; }));

    const first = refreshAntigravityQuota("ag-concurrent", "token", {});
    const second = refreshAntigravityQuota("ag-concurrent", "token", {});
    resolveUsage({ quotas: { [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET } } });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET } },
      { [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET } },
    ]);
    expect(mocks.getAntigravityUsage).toHaveBeenCalledTimes(1);
  });

  it("preserves strict proxy policy for usage refresh", async () => {
    mocks.resolveConnectionProxyConfig.mockResolvedValue({ strictProxy: true });
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {} });

    await refreshAntigravityQuota("ag-strict-proxy", "token", {});

    expect(mocks.getAntigravityUsage).toHaveBeenCalledWith("token", {}, expect.objectContaining({
      strictProxy: true,
    }));
  });

  it("keeps known cache when quota endpoint returns an error payload", async () => {
    const cached = { [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET } };
    getAntigravityQuotaCache().set("ag-error-response", cached);
    mocks.getAntigravityUsage.mockResolvedValue({ message: "Unauthorized", quotas: {} });

    await expect(refreshAntigravityQuota("ag-error-response", "token", {})).resolves.toBeNull();
    expect(getAntigravityQuotaCache().get("ag-error-response")).toBe(cached);
  });

  it("throttles failed refresh attempts for 30 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getAntigravityUsage.mockRejectedValue(new Error("usage unavailable"));

    try {
      await refreshAntigravityQuota("ag-failed-refresh", "token", {});
      await refreshAntigravityQuota("ag-failed-refresh", "token", {});
      expect(mocks.getAntigravityUsage).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(30_000);
      await refreshAntigravityQuota("ag-failed-refresh", "token", {});
      expect(mocks.getAntigravityUsage).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("strike-breaks after 3 optimistic 429s within 60s and cache-blocks 15 minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    // Quota API lies: reports 90% remaining while generation keeps 429ing.
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {
      [MODEL]: { remainingPercentage: 90, resetAt: FUTURE_RESET },
    } });

    try {
      const first = await handleAntigravityQuotaError("ag-strike", 429, MODEL, "token", {});
      expect(first).toBeNull();
      const second = await handleAntigravityQuotaError("ag-strike", 429, MODEL, "token", {});
      expect(second).toBeNull();

      const third = await handleAntigravityQuotaError("ag-strike", 429, MODEL, "token", {});
      expect(third).toBe(Date.parse("2026-08-26T00:15:00.000Z"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets the strike counter when strikes fall outside the 60s window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {
      [MODEL]: { remainingPercentage: 90, resetAt: FUTURE_RESET },
    } });

    try {
      await handleAntigravityQuotaError("ag-window", 429, MODEL, "token", {});
      await handleAntigravityQuotaError("ag-window", 429, MODEL, "token", {});
      await vi.advanceTimersByTimeAsync(61_000);
      const result = await handleAntigravityQuotaError("ag-window", 429, MODEL, "token", {});
      expect(result).toBeNull(); // window lapsed — counter restarted at 1
    } finally {
      vi.useRealTimers();
    }
  });

  it("strike-breaks when the quota API is unavailable (null reading) too", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    // Quota endpoint failing/forbidden => quota unknown. Strikes must still count.
    mocks.getAntigravityUsage.mockResolvedValue({ message: "forbidden", quotas: {} });

    try {
      await handleAntigravityQuotaError("ag-null", 429, MODEL, "token", {});
      await handleAntigravityQuotaError("ag-null", 429, MODEL, "token", {});
      const third = await handleAntigravityQuotaError("ag-null", 429, MODEL, "token", {});
      expect(third).toBe(Date.parse("2026-08-26T00:15:00.000Z"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists the block into the shared cache so the next request skips the pair", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {
      [MODEL]: { remainingPercentage: 90, resetAt: FUTURE_RESET },
    } });

    try {
      await handleAntigravityQuotaError("ag-persist", 429, MODEL, "token", {});
      await handleAntigravityQuotaError("ag-persist", 429, MODEL, "token", {});
      await handleAntigravityQuotaError("ag-persist", 429, MODEL, "token", {});

      // The synthesized entry must be visible to the auth pre-filter reading
      // the shared cache — and must survive an optimistic upstream refresh.
      const cached = getAntigravityQuotaCache().get("ag-persist")?.[MODEL];
      expect(cached).toMatchObject({ remainingPercentage: 0 });
      expect(Date.parse(cached.resetAt)).toBe(Date.parse("2026-08-26T00:15:00.000Z"));

      await refreshAntigravityQuota("ag-persist", "token", {});
      expect(getAntigravityQuotaCache().get("ag-persist")?.[MODEL]).toMatchObject({
        remainingPercentage: 0,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears strike state and the synthesized block after a successful request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {
      [MODEL]: { remainingPercentage: 90, resetAt: FUTURE_RESET },
    } });

    try {
      await handleAntigravityQuotaError("ag-clear", 429, MODEL, "token", {});
      await handleAntigravityQuotaError("ag-clear", 429, MODEL, "token", {});
      await handleAntigravityQuotaError("ag-clear", 429, MODEL, "token", {});
      expect(getAntigravityQuotaCache().get("ag-clear")?.[MODEL]?.remainingPercentage).toBe(0);

      clearAntigravityStrikes("ag-clear", MODEL);
      // Synthesized entry gone — pair selectable again immediately.
      expect(getAntigravityQuotaCache().get("ag-clear")?.[MODEL]).toBeUndefined();

      // Two more 429s do NOT inherit earlier strikes: no block on the third-in-episode.
      await handleAntigravityQuotaError("ag-clear", 429, MODEL, "token", {});
      await expect(handleAntigravityQuotaError("ag-clear", 429, MODEL, "token", {})).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("anchors the window at the first strike: 3 strikes spread over 90s do not trip", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {
      [MODEL]: { remainingPercentage: 90, resetAt: FUTURE_RESET },
    } });

    try {
      await handleAntigravityQuotaError("ag-anchor", 429, MODEL, "token", {});      // t=0
      await vi.advanceTimersByTimeAsync(45_000);
      await handleAntigravityQuotaError("ag-anchor", 429, MODEL, "token", {});      // t=45s
      await vi.advanceTimersByTimeAsync(45_000);
      // t=90s: within 60s of strike #2 but outside 60s of strike #1 => new window
      const result = await handleAntigravityQuotaError("ag-anchor", 429, MODEL, "token", {});
      expect(result).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the optimistic path null without touching the quota cache", async () => {
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {
      [MODEL]: { remainingPercentage: 90, resetAt: FUTURE_RESET },
    } });

    await expect(handleAntigravityQuotaError("ag-optimistic", 429, MODEL, "token", {}))
      .resolves.toBeNull();
    // Optimistic reading must NOT poison the shared cache (auth pre-filter
    // treats cached 0% as exhausted).
    expect(getAntigravityQuotaCache().get("ag-optimistic")?.[MODEL]?.remainingPercentage).toBe(90);
  });

  it("checks shared family summary quota (claude_gpt_session / weekly)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getAntigravityUsage.mockResolvedValue({
      quotas: {
        claude_gpt_session: { remainingPercentage: 0, resetAt: FUTURE_RESET },
        claude_gpt_weekly: { remainingPercentage: 50, resetAt: "2026-09-02T00:00:00.000Z" },
      }
    });

    try {
      const reset = await handleAntigravityQuotaError("ag-family", 429, "claude-sonnet-5-5", "token", {});
      expect(reset).toBe(Date.parse(FUTURE_RESET));
      expect(getAntigravityQuotaCache().get("ag-family")["claude-sonnet-5-5"]).toMatchObject({
        remainingPercentage: 0,
        resetAt: FUTURE_RESET,
      });

      // auth pre-filter should skip this account for claude-sonnet-5-5 based on cache
      mocks.getProviderConnections.mockResolvedValue([
        { id: "ag-family", email: "family@example.com", isActive: true },
        { id: "ag-other", email: "other@example.com", isActive: true },
      ]);
      const creds = await getProviderCredentials("antigravity", null, "claude-sonnet-5-5");
      expect(creds.connectionId).toBe("ag-other");
    } finally {
      vi.useRealTimers();
    }
  });

  it("checks shared family summary quota for gemini models", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getAntigravityUsage.mockResolvedValue({
      quotas: {
        gemini_weekly: { remainingPercentage: 0, resetAt: FUTURE_RESET },
      }
    });

    try {
      const reset = await handleAntigravityQuotaError("ag-gem", 429, "gemini-3.8-flash-high", "token", {});
      expect(reset).toBe(Date.parse(FUTURE_RESET));
      expect(getAntigravityQuotaCache().get("ag-gem")["gemini-3.8-flash-high"]).toMatchObject({
        remainingPercentage: 0,
        resetAt: FUTURE_RESET,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats standard/free-tier accounts without Argon quota as unsupported (0%) for Argon models while keeping Gemini Flash available", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    const freeTierQuotas = {
      gemini_weekly: { remainingPercentage: 85, resetAt: FUTURE_RESET },
    };

    try {
      const argonQuota = getAntigravityModelQuota(freeTierQuotas, "gemini-4-argon-medium");
      expect(argonQuota).toMatchObject({
        remainingPercentage: 0,
        resetAt: FUTURE_RESET,
        unsupported: true,
      });

      const flashQuota = getAntigravityModelQuota(freeTierQuotas, "gemini-3.8-flash-medium");
      expect(flashQuota).toMatchObject({
        remainingPercentage: 85,
        resetAt: FUTURE_RESET,
      });

      // When a free-tier account is hit with an Argon request and errors out,
      // handleAntigravityQuotaError must immediately cache-block it (no 3-strike wait).
      mocks.getAntigravityUsage.mockResolvedValue({
        quotas: { gemini_weekly: { remainingPercentage: 85, resetAt: FUTURE_RESET } },
        subscriptionInfo: { paidTier: { id: "free-tier" } },
      });
      const resetMs = await handleAntigravityQuotaError("ag-free", 429, "gemini-4-argon-medium", "token", {});
      expect(resetMs).toBe(Date.parse(FUTURE_RESET));
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips standard/free-tier accounts when routing Argon after Pro account exhaustion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    const proReset = "2026-08-26T05:00:00.000Z";
    const freeReset = "2026-08-26T01:00:00.000Z";

    mocks.getProviderConnections.mockResolvedValue([
      { id: "ag-pro-1", email: "pro1@example.com", isActive: true },
      { id: "ag-free", email: "free@example.com", isActive: true },
      { id: "ag-pro-2", email: "pro2@example.com", isActive: true },
    ]);

    getAntigravityQuotaCache().set("ag-pro-1", {
      argon_session: { remainingPercentage: 0, resetAt: proReset },
      argon_weekly: { remainingPercentage: 60, resetAt: FUTURE_RESET },
    });
    getAntigravityQuotaCache().set("ag-free", {
      gemini_weekly: { remainingPercentage: 90, resetAt: freeReset },
    });
    getAntigravityQuotaCache().set("ag-pro-2", {
      argon_session: { remainingPercentage: 75, resetAt: proReset },
      argon_weekly: { remainingPercentage: 80, resetAt: FUTURE_RESET },
    });

    try {
      // Argon request must skip both exhausted ag-pro-1 AND unsupported ag-free, picking ag-pro-2
      const argonCreds = await getProviderCredentials("antigravity", null, "gemini-4-argon-medium");
      expect(argonCreds.connectionId).toBe("ag-pro-2");

      // Flash request can still use ag-free
      const flashCreds = await getProviderCredentials("antigravity", new Set(["ag-pro-1"]), "gemini-3.8-flash-medium");
      expect(flashCreds.connectionId).toBe("ag-free");

      // If ag-pro-2 is also exhausted, allRateLimited retryAfter must reflect Pro reset time, not free-tier gemini_weekly
      getAntigravityQuotaCache().set("ag-pro-2", {
        argon_session: { remainingPercentage: 0, resetAt: proReset },
      });
      const allBlocked = await getProviderCredentials("antigravity", null, "gemini-4-argon-medium");
      expect(allBlocked).toMatchObject({
        allRateLimited: true,
        retryAfter: proReset,
      });

      // Even if ONLY free-tier accounts are configured or cached, it returns allRateLimited (no infinite loop)
      mocks.getProviderConnections.mockResolvedValue([
        { id: "ag-free", email: "free@example.com", isActive: true },
      ]);
      const onlyFreeBlocked = await getProviderCredentials("antigravity", null, "gemini-4-argon-medium");
      expect(onlyFreeBlocked).toMatchObject({
        allRateLimited: true,
        retryAfter: freeReset,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats 999/1000 (0.1% remaining, 0% rounded) Argon weekly quota as exhausted and preserves Argon weekly when present on non-paidTier accounts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    const resetAt = "2026-08-31T00:00:00.000Z";

    try {
      // 999/1000 used => remainingPercentage: 0.1 (rounds to 0% left on dashboard)
      const nearEmptyQuotas = {
        argon_weekly: { used: 999, total: 1000, remainingPercentage: 0.1, resetAt },
      };
      const resolved = getAntigravityModelQuota(nearEmptyQuotas, "gemini-4-argon-medium");
      expect(resolved).toMatchObject({
        remainingPercentage: 0,
        resetAt,
      });

      // Account with _isFreeTier flag but actual argon_weekly quota (>0%) stays usable
      const hybridQuotas = {
        argon_weekly: { used: 85, total: 1000, remainingPercentage: 91.5, resetAt },
      };
      Object.defineProperty(hybridQuotas, "_isFreeTier", { value: true, enumerable: false });
      const hybridResolved = getAntigravityModelQuota(hybridQuotas, "gemini-4-argon-medium");
      expect(hybridResolved).toMatchObject({
        remainingPercentage: 91.5,
        resetAt,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears all model strike blocks for a connection when model is omitted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getAntigravityUsage.mockResolvedValue({
      quotas: {
        "gemini-4-argon-high": { remainingPercentage: 90, resetAt: FUTURE_RESET },
        "gemini-4-argon-medium": { remainingPercentage: 90, resetAt: FUTURE_RESET },
      },
    });

    try {
      for (let i = 0; i < 3; i++) {
        await handleAntigravityQuotaError("ag-all", 429, "gemini-4-argon-high", "token", {});
        await handleAntigravityQuotaError("ag-all", 429, "gemini-4-argon-medium", "token", {});
      }
      expect(getAntigravityQuotaCache().get("ag-all")?.["gemini-4-argon-high"]?.remainingPercentage).toBe(0);
      expect(getAntigravityQuotaCache().get("ag-all")?.["gemini-4-argon-medium"]?.remainingPercentage).toBe(0);

      clearAntigravityStrikes("ag-all");
      expect(getAntigravityQuotaCache().get("ag-all")?.["gemini-4-argon-high"]).toBeUndefined();
      expect(getAntigravityQuotaCache().get("ag-all")?.["gemini-4-argon-medium"]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores stale multi-hour DB modelLock_* (>5m) on Antigravity while honoring short backoff locks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getProviderConnections.mockResolvedValue([
      {
        id: "ag-short-lock",
        email: "short@example.com",
        isActive: true,
        "modelLock_gemini-4-argon-medium": "2026-08-26T00:02:00.000Z", // 2m backoff lock
      },
      {
        id: "ag-stale-lock",
        email: "stale@example.com",
        isActive: true,
        "modelLock_gemini-4-argon-medium": "2026-08-28T00:00:00.000Z", // 48h stale resetsAtMs lock
      },
    ]);

    try {
      const creds = await getProviderCredentials("antigravity", null, "gemini-4-argon-medium");
      expect(creds.connectionId).toBe("ag-stale-lock");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cache-blocks Argon family on 502 connect timeout so sibling Argon tiers skip stalled account while Claude stays usable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getProviderConnections.mockResolvedValue([
      { id: "ag-stalled", email: "stalled@example.com", isActive: true },
      { id: "ag-fast", email: "fast@example.com", isActive: true },
    ]);
    getAntigravityQuotaCache().set("ag-stalled", {
      argon_weekly: { remainingPercentage: 50, resetAt: FUTURE_RESET },
      claude_gpt_weekly: { remainingPercentage: 50, resetAt: FUTURE_RESET },
    });
    getAntigravityQuotaCache().set("ag-fast", {
      argon_weekly: { remainingPercentage: 46, resetAt: FUTURE_RESET },
    });

    try {
      const blockedUntil = handleAntigravityStallError("ag-stalled", 502, "gemini-4-argon-high", "[502]: fetch connect timeout (15000ms)");
      expect(blockedUntil).toBe(Date.parse("2026-08-26T00:15:00.000Z"));

      // Both gemini-4-argon-high and gemini-4-argon-medium skip ag-stalled and select ag-fast
      const highCreds = await getProviderCredentials("antigravity", null, "gemini-4-argon-high");
      expect(highCreds.connectionId).toBe("ag-fast");
      const medCreds = await getProviderCredentials("antigravity", null, "gemini-4-argon-medium");
      expect(medCreds.connectionId).toBe("ag-fast");

      // Claude on ag-stalled remains unaffected
      const claudeCreds = await getProviderCredentials("antigravity", null, "claude-sonnet-5-5-medium");
      expect(claudeCreds.connectionId).toBe("ag-stalled");

      // Clearing strikes on gemini-4-argon-high restores Argon on ag-stalled
      clearAntigravityStrikes("ag-stalled", "gemini-4-argon-high");
      const restoredCreds = await getProviderCredentials("antigravity", null, "gemini-4-argon-medium");
      expect(restoredCreds.connectionId).toBe("ag-stalled");
    } finally {
      vi.useRealTimers();
    }
  });
});

