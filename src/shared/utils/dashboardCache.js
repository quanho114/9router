"use client";

const STORAGE_PREFIX = "9r:swr:v1:";
const memoryCache = new Map();
let clientHydrated = false;

export function markDashboardHydrated() {
  clientHydrated = true;
}

export function isDashboardHydrated() {
  return clientHydrated;
}

export function readCache(key, fallback = null) {
  if (memoryCache.has(key)) {
    return memoryCache.get(key);
  }
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "v" in parsed) {
      memoryCache.set(key, parsed.v);
      return parsed.v;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * SSR-safe initializer for useState(() => getInitialCache(key, fallback)).
 * Returns fallback during SSR and initial hydration pass so server/client HTML match,
 * and returns cached data synchronously (0ms, no skeleton frame) on all subsequent
 * client-side route transitions.
 */
export function getInitialCache(key, fallback = null) {
  if (!clientHydrated) return fallback;
  return readCache(key, fallback);
}

export function hasInitialCache(key) {
  if (!clientHydrated) return false;
  return readCache(key, null) !== null;
}

export function writeCache(key, value) {
  memoryCache.set(key, value);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + key,
      JSON.stringify({ v: value, t: Date.now() })
    );
  } catch {
    // Ignore storage quota or private mode errors
  }
}

/**
 * Schedule a microtask (0ms, before next paint) to apply cached state inside effects
 * without triggering synchronous cascading-render warnings.
 */
export function runWithCache(fn) {
  queueMicrotask(fn);
}
