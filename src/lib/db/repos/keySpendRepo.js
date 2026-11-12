import { getAdapter } from "../driver.js";

export async function getDailyKeySpend(apiKey, now = Date.now()) {
  const day = new Date(now);
  const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const resetAt = new Date(start + 86_400_000).toISOString();
  const db = await getAdapter();
  const row = db.get(
    `SELECT COALESCE(SUM(cost), 0) AS spend FROM usageHistory
     WHERE apiKey = ? AND timestamp >= ? AND timestamp < ?`,
    [apiKey, new Date(start).toISOString(), resetAt]
  );
  return { dailySpendUsd: Number(row?.spend) || 0, dailySpendResetAt: resetAt };
}

export async function withDailyKeySpend(key) {
  return key?.dailyLimitUsd > 0 ? { ...key, ...await getDailyKeySpend(key.key) } : key;
}
