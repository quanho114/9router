import { getAntigravityModelQuota, getAntigravityQuotaCache } from "./antigravityQuota.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";

const SNAPSHOT_TTL_MS = 5 * 60_000;
const MAX_SNAPSHOTS = 2_000;
const snapshots = globalThis[Symbol.for("9router.providerQuota")] ??= new Map();
const refresh = globalThis[Symbol.for("9router.providerQuotaRefresh")] ??= { active: new Set(), next: new Map() };
const POLLED_PROVIDERS = new Set(["claude", "codex", "cursor", "gemini-cli", "github", "opencode-go"]);

export function rememberProviderQuota(connectionId, usage, now = Date.now()) {
  if (!connectionId || !usage?.quotas || usage.message) return;
  snapshots.delete(connectionId);
  snapshots.set(connectionId, { quotas: usage.quotas, expiresAt: now + SNAPSHOT_TTL_MS });
  if (snapshots.size > MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value);
}

function relevantQuotaNames(provider, model) {
  if (provider === "codex") {
    return model.includes("spark") ? ["spark_session", "spark_weekly"] : ["session", "weekly"];
  }
  if (provider === "claude") {
    const family = ["opus", "sonnet", "haiku", "fable"].find((name) => model.includes(name));
    return ["session (5h)", "weekly (7d)", ...(family ? [`weekly ${family} (7d)`] : [])];
  }
  if (provider === "github") return ["chat"];
  if (provider === "cursor") {
    return ["Plan (USD)", "Included usage", model === "auto" ? "Auto models (%)" : "Named models (%)"];
  }
  if (provider === "opencode-go") return ["Rolling", "Weekly", "Monthly"];
  return [model];
}

export function scheduleProviderQuotaRefresh(connection) {
  const { provider, id, accessToken, apiKey, providerSpecificData } = connection;
  if (!POLLED_PROVIDERS.has(provider) || (!accessToken && !apiKey) || refresh.active.size >= 4) return;
  const now = Date.now();
  if (refresh.active.has(id) || (refresh.next.get(id) ?? 0) > now || (snapshots.get(id)?.expiresAt ?? 0) > now) return;
  refresh.active.add(id);
  refresh.next.delete(id);
  refresh.next.set(id, now + SNAPSHOT_TTL_MS);
  if (refresh.next.size > MAX_SNAPSHOTS) refresh.next.delete(refresh.next.keys().next().value);
  void (async () => {
    try {
      const { getUsageForProvider } = await import("open-sse/services/usage.js");
      const proxy = await resolveConnectionProxyConfig(providerSpecificData);
      rememberProviderQuota(id, await getUsageForProvider(connection, proxy));
    } catch {
      // A quota probe must never interrupt chat or clear the last known reset.
    } finally {
      refresh.active.delete(id);
    }
  })();
}

export function getProviderQuota(provider, connectionId, model, now = Date.now()) {
  if (!model) return null;
  const snapshot = snapshots.get(connectionId);
  const quotas = provider === "antigravity"
    ? [getAntigravityModelQuota(getAntigravityQuotaCache().get(connectionId), model)]
    : relevantQuotaNames(provider, model).map((name) => snapshot?.quotas[name]);

  let remaining = null;
  let nextReset = Infinity;
  let blockedUntil = 0;
  for (const quota of quotas) {
    if (!quota || quota.unlimited) continue;
    const reset = Date.parse(quota.resetAt);
    if (Number.isFinite(reset) && reset <= now) continue;
    const percent = quota.remainingPercentage ??
      (quota.total > 0 && typeof quota.remaining === "number" ? 100 * quota.remaining / quota.total : null);
    if (!Number.isFinite(percent)) continue;
    if (percent <= 0 && reset > now) blockedUntil = Math.max(blockedUntil, reset);
    if (provider !== "antigravity" && snapshot.expiresAt <= now) continue;
    remaining = Math.min(remaining ?? 100, Math.max(0, Math.min(100, percent)));
    if (reset > now) nextReset = Math.min(nextReset, reset);
  }
  return remaining === null && !blockedUntil ? null : { remaining, nextReset, blockedUntil };
}

export function compareQuota(strategy, a, b) {
  if (strategy === "quota-headroom") {
    return (b?.remaining ?? -1) - (a?.remaining ?? -1);
  }
  if (strategy === "reset-aware") {
    const first = a?.nextReset ?? Infinity;
    const second = b?.nextReset ?? Infinity;
    return first === second ? 0 : first - second;
  }
  return 0;
}
