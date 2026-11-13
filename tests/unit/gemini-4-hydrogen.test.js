import { describe, expect, it } from "vitest";

import { getModelUpstreamId, isValidModel } from "../../open-sse/config/providerModels.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { stripThinkingSuffix } from "../../open-sse/translator/concerns/thinkingUnified.js";

const hydrogen = "gemini-4-hydrogen";

describe("Gemini 4 Hydrogen on Antigravity", () => {
  it.each([
    [hydrogen, {}, "high"],
    [hydrogen, { reasoning_effort: "low" }, "low"],
    [hydrogen, { reasoning: { effort: "medium" } }, "medium"],
    [hydrogen, { reasoning_effort: "xhigh" }, "xhigh"],
    [hydrogen, { reasoning_effort: "max" }, "xhigh"],
    [`${hydrogen}(xhigh)`, { reasoning_effort: "low" }, "xhigh"],
    [`${hydrogen}-xhigh`, {}, "xhigh"],
    [`${hydrogen}-xhigh`, { reasoning_effort: "high" }, "xhigh"],
  ])("translates %s with %j to the %s tier", (model, options, level) => {
    expect(isValidModel("ag", model)).toBe(true);
    const body = { messages: [{ role: "user", content: "Hello" }], ...options };
    const credentials = { projectId: "project", connectionId: "connection" };
    const upstream = getModelUpstreamId("ag", model, body);
    const translated = translateRequest("openai", "antigravity", upstream, body, true, credentials, "antigravity");
    translated.model = stripThinkingSuffix(upstream);
    const request = new AntigravityExecutor().transformRequest(model, translated, true, credentials);

    expect(request.model).toBe(`${hydrogen}-${level}`);
    expect(request.request.generationConfig.thinkingConfig).toEqual({ thinkingLevel: level, includeThoughts: true });
    expect(getPricingForModel("antigravity", model)).toEqual({ input: 1.50, output: 7.50, cached: 0.075, reasoning: 7.50 });
  });

  it("keeps the high fallback for older models when xhigh is requested", () => {
    expect(getModelUpstreamId("ag", "gemini-3.8-flash", { reasoning_effort: "xhigh" })).toBe("gemini-3.8-flash-high(high)");
  });
});
