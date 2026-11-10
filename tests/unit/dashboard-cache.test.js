import { describe, it, expect, beforeEach } from "vitest";
import {
  getInitialCache,
  hasInitialCache,
  isDashboardHydrated,
  markDashboardHydrated,
  readCache,
  writeCache,
} from "@/shared/utils/dashboardCache.js";

describe("dashboardCache SWR helper", () => {
  beforeEach(() => {
    const store = new Map();
    globalThis.window = {
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
      },
    };
  });

  it("writes and reads values from memory and localStorage", () => {
    writeCache("testKey", { count: 42 });
    expect(readCache("testKey", null)).toEqual({ count: 42 });
    expect(readCache("missingKey", "fallback")).toBe("fallback");
  });

  it("returns cached values synchronously from getInitialCache once hydrated", () => {
    writeCache("providers", [{ id: "conn-1" }]);
    markDashboardHydrated();
    expect(isDashboardHydrated()).toBe(true);
    expect(hasInitialCache("providers")).toBe(true);
    expect(getInitialCache("providers", [])).toEqual([{ id: "conn-1" }]);
  });
});
