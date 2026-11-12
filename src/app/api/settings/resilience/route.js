import { getProviderConnections, getSettings } from "@/lib/localDb";
import { getConnectionResilienceSnapshot } from "@/sse/services/connectionResilience.js";
import { resolveResilienceConfig } from "@/shared/constants/resilience.js";
import { MODEL_LOCK_PREFIX } from "open-sse/services/accountFallback.js";
import { BACKOFF_CONFIG } from "open-sse/config/errorConfig.js";
import { getAntigravityQuotaCache } from "@/sse/services/antigravityQuota.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const [settings, connections] = await Promise.all([getSettings(), getProviderConnections({ isActive: true })]);
  const config = resolveResilienceConfig(settings.connectionResilience);
  const names = new Map(connections.map((c) => [c.id, c.displayName || c.name || c.email || c.id]));
  const breakers = config.enabled ? getConnectionResilienceSnapshot()
    .filter((row) => row.connectionId === "noauth" || names.has(row.connectionId))
    .map((row) => ({ ...row, name: names.get(row.connectionId) || "Public connection" })) : [];
  const now = Date.now();
  const cooldowns = connections.flatMap((connection) => {
    const antigravity = connection.provider === "antigravity";
    const expiryByModel = new Map();
    for (const [key, expiry] of Object.entries(connection)) {
      if (!key.startsWith(MODEL_LOCK_PREFIX)) continue;
      const remainingMs = Date.parse(expiry) - now;
      if (remainingMs > 0 && (!antigravity || remainingMs <= BACKOFF_CONFIG.max)) {
        expiryByModel.set(key.slice(MODEL_LOCK_PREFIX.length), expiry);
      }
    }
    if (antigravity) {
      const quotas = getAntigravityQuotaCache().get(connection.id) || {};
      for (const [model, quota] of Object.entries(quotas)) {
        if (Math.round(quota?.remainingPercentage) <= 0 && Date.parse(quota?.resetAt) > now &&
            Date.parse(quota.resetAt) > (Date.parse(expiryByModel.get(model)) || 0)) {
          expiryByModel.set(model, quota.resetAt);
        }
      }
    }
    return Array.from(expiryByModel, ([model, retryAt]) => ({
      connectionId: connection.id,
      name: names.get(connection.id),
      provider: connection.provider,
      model,
      retryAt,
    }));
  });
  return Response.json({ config, breakers, cooldowns }, { headers: { "Cache-Control": "no-store" } });
}
