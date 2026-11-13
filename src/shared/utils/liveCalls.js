/**
 * Pure normalization and formatting helpers for the realtime Live Calls bell popover.
 */

function splitModelKey(modelKey) {
  const match = String(modelKey || "").match(/^(.*) \(([^)]+)\)$/);
  if (match) {
    return { model: match[1], provider: match[2] };
  }
  return { model: String(modelKey || "unknown"), provider: "unknown" };
}

/**
 * Normalize an SSE payload from `/api/usage/stream?live=1` into active + recent call lists.
 * Also surfaces unattributed `pending.byModel` entries (e.g. keyless/local calls without connectionId).
 */
export function normalizeLiveCallsPayload(data, maxRecent = 6) {
  const rawActive = Array.isArray(data?.activeRequests) ? data.activeRequests : [];
  const activeCalls = [];
  const attributedByKey = {};

  for (const item of rawActive) {
    const count = Number(item?.count) || 0;
    if (count <= 0) continue;
    const model = item?.model || "unknown";
    const provider = item?.provider || "unknown";
    const account = item?.account || "";
    const modelKey = provider && provider !== "unknown" ? `${model} (${provider})` : model;
    attributedByKey[modelKey] = (attributedByKey[modelKey] || 0) + count;
    activeCalls.push({ model, provider, account, count });
  }

  const byModel = data?.pending?.byModel;
  if (byModel && typeof byModel === "object") {
    for (const [modelKey, rawCount] of Object.entries(byModel)) {
      const total = Number(rawCount) || 0;
      const remaining = total - (attributedByKey[modelKey] || 0);
      if (remaining > 0) {
        const { model, provider } = splitModelKey(modelKey);
        activeCalls.push({ model, provider, account: "", count: remaining });
      }
    }
  }

  const totalActive = activeCalls.reduce((sum, item) => sum + item.count, 0);
  const rawRecent = Array.isArray(data?.recentRequests) ? data.recentRequests : [];
  const recentCalls = rawRecent.slice(0, maxRecent).map((item) => ({
    timestamp: item?.timestamp || "",
    model: item?.model || "unknown",
    provider: item?.provider || "unknown",
    promptTokens: Number(item?.promptTokens) || 0,
    completionTokens: Number(item?.completionTokens) || 0,
    status: item?.status || "ok",
  }));

  return {
    activeCalls,
    totalActive,
    recentCalls,
    errorProvider: typeof data?.errorProvider === "string" ? data.errorProvider : "",
  };
}

/**
 * Format a compact relative timestamp (e.g. "just now", "8s ago", "3m ago").
 */
export function formatRelativeTime(timestamp, nowMs = Date.now()) {
  if (!timestamp) return "";
  const ts = new Date(timestamp).getTime();
  if (Number.isNaN(ts)) return "";
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 3) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

/**
 * Format compact token counts (e.g. 1240 -> "1.2k").
 */
export function formatCompactTokens(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

