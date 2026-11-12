import { getPricingForModel, getProviderConnections } from "@/lib/localDb";
import { FREE_PROVIDERS } from "@/shared/constants/providers.js";
import { connectionCanServeModel } from "./auth.js";
import { getModelInfo } from "./model.js";
import { compareQuota, getProviderQuota, scheduleProviderQuotaRefresh } from "./providerQuota.js";

const SUBSCRIPTION_PROVIDERS = new Set([
  "antigravity", "claude", "codex", "cursor", "gemini-cli", "github",
  "grok-cli", "minimax-code", "minimax-code-global", "opencode-go", "xiaomi-tokenplan",
]);
const QUOTA_STRATEGIES = new Set(["thrifty", "cost-optimized", "quota-headroom", "reset-aware"]);

export function isQuotaRoutingStrategy(strategy) {
  return QUOTA_STRATEGIES.has(strategy);
}

function compareTargets(strategy, a, b) {
  if (a.available !== b.available) return a.available ? -1 : 1;
  if (strategy === "thrifty" && a.tier !== b.tier) return a.tier - b.tier;
  const quotaOrder = compareQuota(strategy, a.quota, b.quota);
  if (quotaOrder) return quotaOrder;
  return a.price === b.price ? 0 : a.price - b.price;
}

export async function orderComboTargets(models, strategy) {
  const [connections, resolved] = await Promise.all([
    getProviderConnections({ isActive: true }),
    Promise.all(models.map(getModelInfo)),
  ]);
  const providers = new Set(resolved.map(({ provider }) => provider));
  for (const connection of connections) {
    if (providers.has(connection.provider)) scheduleProviderQuotaRefresh(connection);
  }
  const targets = await Promise.all(resolved.map(async ({ provider, model }, index) => {
    const name = models[index];
    if (!provider) return { name, available: true, tier: 4, price: Infinity };

    const keyless = FREE_PROVIDERS[provider]?.noAuth === true;
    const subscription = SUBSCRIPTION_PROVIDERS.has(provider);
    const pricing = keyless ? null : await getPricingForModel(provider, model);
    const rate = Number.isFinite(pricing?.input) && Number.isFinite(pricing?.output)
      ? pricing.input + pricing.output
      : Infinity;
    const free = rate === 0 || /(?:[:-]free)$/.test(model);
    const accounts = connections
      .filter((connection) => connection.provider === provider && connectionCanServeModel(connection, provider, model, model))
      .map((connection) => getProviderQuota(provider, connection.id, model))
      .filter((quota) => !quota?.blockedUntil)
      .sort((a, b) => compareQuota(strategy, a, b));
    return {
      name,
      available: keyless || accounts.length > 0,
      tier: subscription ? 0 : keyless ? 1 : free ? 2 : Number.isFinite(rate) ? 3 : 4,
      price: keyless || free ? 0 : rate,
      quota: accounts[0],
    };
  }));
  return targets.sort((a, b) => compareTargets(strategy, a, b)).map(({ name }) => name);
}
