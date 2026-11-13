import { describe, expect, it, vi, beforeEach } from "vitest";

const proxyAwareFetch = vi.fn(async (url) => ({
  ok: true,
  status: 200,
  json: async () => url.includes(":loadCodeAssist")
    ? { cloudaicompanionProject: "project-1", currentTier: { name: "Pro" }, paidTier: { id: "g1-pro-tier", name: "Google AI Pro" } }
    : {
        models: {
          "gemini-3.8-flash-high": {
            displayName: "Gemini 3.8 Flash (High)",
            quotaInfo: { remainingFraction: 0.85, resetTime: "2026-08-25T12:00:00Z" },
          },
          "gemini-3.8-flash-medium": {
            displayName: "Gemini 3.8 Flash (Medium)",
            quotaInfo: { remainingFraction: 0.6, resetTime: "2026-08-25T12:00:00Z" },
          },
          "gemini-3.8-flash-low": {
            displayName: "Gemini 3.8 Flash (Low)",
            quotaInfo: { remainingFraction: 0.35, resetTime: "2026-08-25T12:00:00Z" },
          },
          "gemini-4-hydrogen-xhigh": {
            displayName: "Gemini 4 Hydrogen (XHigh)",
            quotaInfo: { remainingFraction: 0.45, resetTime: "2026-08-25T12:00:00Z" },
          },
          "internal-model": {
            displayName: "Internal",
            isInternal: true,
            quotaInfo: { remainingFraction: 0.5 },
          },
        },
      },
  text: async () => "{}",
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch,
}));

describe("Antigravity quota tracker: Gemini 3.8 Flash usage bars", () => {
  beforeEach(() => proxyAwareFetch.mockClear());

  it("returns Gemini 3.8 Flash tier quotas so the dashboard can render usage bars", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

    const usage = await getAntigravityUsage("access-token", {});

    expect(usage.quotas["gemini-3.8-flash-high"]).toMatchObject({
      used: 150,
      total: 1000,
      remainingPercentage: 85,
      displayName: "Gemini 3.8 Flash (High)",
    });
    expect(usage.quotas["gemini-3.8-flash-medium"]).toMatchObject({
      used: 400,
      total: 1000,
      remainingPercentage: 60,
    });
    expect(usage.quotas["gemini-3.8-flash-low"]).toMatchObject({
      used: 650,
      total: 1000,
      remainingPercentage: 35,
    });
  });

  it("tracks Hydrogen quota and distinguishes Google’s disabled catalog entry", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");
    const enabled = await getAntigravityUsage("access-token", {});
    expect(enabled.hydrogenDisabled).toBe(false);
    expect(enabled.hydrogenAvailable).toBe(true);
    expect(enabled.quotas["gemini-4-hydrogen-xhigh"]).toMatchObject({ remainingPercentage: 45 });

    proxyAwareFetch.mockImplementationOnce(async () => ({ ok: false, status: 403 }));
    proxyAwareFetch.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({ models: { "gemini-4-hydrogen-disabled": { disabled: true } } }),
    }));
    const disabled = await getAntigravityUsage("access-token", {});
    expect(disabled.hydrogenDisabled).toBe(true);
    expect(disabled.hydrogenAvailable).toBe(false);
    expect(disabled.quotas).not.toHaveProperty("gemini-4-hydrogen-disabled");
  });

  it("keeps Hydrogen unavailable for free-tier accounts even if a slug is listed", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");
    proxyAwareFetch.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({ cloudaicompanionProject: "project-1", paidTier: { id: "free-tier" } }),
    }));
    const usage = await getAntigravityUsage("access-token", {});
    expect(usage.hydrogenAvailable).toBe(false);
  });
});
