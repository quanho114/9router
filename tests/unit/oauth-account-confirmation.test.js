import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import antigravity from "../../src/lib/oauth/providers/antigravity.js";

afterEach(() => vi.unstubAllGlobals());

describe("Antigravity account verification", () => {
  it("rejects failed profile lookup before saving an anonymous account", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", fetch);
    await expect(antigravity.postExchange({ access_token: "token" })).rejects.toThrow("Could not verify");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([{}, { email: "user@example.com", verified_email: false }])("rejects unconfirmed identity %j", async (profile) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => profile }));
    await expect(antigravity.postExchange({ access_token: "token" })).rejects.toThrow("has not been verified");
  });

  it("accepts a verified profile", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ email: "user@example.com", verified_email: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }));
    const result = await antigravity.postExchange({ access_token: "token" });
    expect(result.userInfo.email).toBe("user@example.com");
  });
});

const source = readFileSync(new URL("../../src/shared/components/OAuthModal.js", import.meta.url), "utf8");
async function exchange(response) {
  const onSuccess = vi.fn();
  const postMessage = vi.fn();
  const steps = [];
  const start = source.indexOf("    if (!authData) return;");
  const end = source.indexOf("\n  }, [authData, provider, oauthMeta]);", start);
  await vm.runInNewContext("(async () => {" + source.slice(start, end) + "\n})()", {
    authData: { state: "attempt1", redirectUri: "http://127.0.0.1:3999/callback" },
    provider: "antigravity", code: "code", state: "attempt1", oauthMeta: null,
    fetch: async () => ({ ok: true, json: async () => response }),
    popupRef: { current: { postMessage } }, isOpenRef: { current: true },
    onSuccessRef: { current: onSuccess }, URL,
    setStep: value => steps.push(value), setError() {},
    BroadcastChannel: class { postMessage() {} close() {} },
    localStorage: { setItem() {} },
  });
  return { onSuccess, postMessage, steps };
}

describe("OAuth saved-account confirmation", () => {
  it.each([{}, { success: true }, { success: true, connection: { id: "1", provider: "codex" } }])("keeps the modal open for invalid success payload %j", async (response) => {
    const result = await exchange(response);
    expect(result.onSuccess).not.toHaveBeenCalled();
    expect(result.postMessage).not.toHaveBeenCalled();
    expect(result.steps).toEqual(["error"]);
  });

  it("confirms completion only for a saved connection from this provider", async () => {
    const result = await exchange({ success: true, connection: { id: "1", provider: "antigravity" } });
    expect(result.onSuccess).toHaveBeenCalledOnce();
    expect(result.postMessage).toHaveBeenCalledOnce();
    expect(result.steps).toEqual(["success"]);
  });
});
