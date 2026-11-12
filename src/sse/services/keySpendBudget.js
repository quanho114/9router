import { getDailyKeySpend } from "@/lib/db/repos/keySpendRepo.js";
import { beginKeySpend } from "@/lib/db/keySpendWrites.js";
import { errorResponse } from "open-sse/utils/error.js";
import { withResponseFinalizer } from "../utils/responseLifecycle.js";

export async function getDailySpendDenial(apiKey, limit) {
  if (!(limit > 0)) return null;
  const { dailySpendUsd, dailySpendResetAt } = await getDailyKeySpend(apiKey);
  // Avoid allowing another call due to floating point noise in the SUM.
  if (dailySpendUsd + Number.EPSILON * Math.max(dailySpendUsd, limit) < limit) return null;
  return {
    status: 429,
    reason: "daily_spend_limit_exceeded",
    message: `This API key has reached its daily USD limit. Resets at ${dailySpendResetAt}`,
    retryAfter: Math.max(1, Math.ceil((Date.parse(dailySpendResetAt) - Date.now()) / 1000)),
  };
}

export async function withKeySpendBudget(ctx, apiKey, operation) {
  if (!(ctx?.dailyLimitUsd > 0)) return operation();
  const release = beginKeySpend(apiKey);
  if (!release) {
    return errorResponse(429, "A metered request is already running for this API key", { "Retry-After": "1" });
  }

  let streaming = false;
  try {
    const denial = await getDailySpendDenial(apiKey, ctx.dailyLimitUsd);
    if (denial) return errorResponse(denial.status, denial.message, { "Retry-After": String(denial.retryAfter) });
    const response = await operation();
    if (response.body && response.headers.get("content-type")?.includes("text/event-stream")) {
      const wrapped = withResponseFinalizer(response, release);
      streaming = true;
      return wrapped;
    }
    return response;
  } finally {
    if (!streaming) await release();
  }
}
