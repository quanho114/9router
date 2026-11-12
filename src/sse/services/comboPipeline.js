import { appendUserTurn, extractCompletionText, withoutChatTools } from "open-sse/services/combo.js";
import { errorResponse } from "open-sse/utils/error.js";
import { readBoundedJson } from "../utils/readBoundedJson.js";

const MAX_STEPS = 8;
const MAX_STEP_BYTES = 131_072;
const MAX_STEP_TEXT = 24_000;

function withPreviousOutput(body, output) {
  if (!output) return body;
  return appendUserTurn(body, [
    "Use the previous pipeline step's output as reference material for the original request.",
    JSON.stringify({ previousOutput: output }),
  ].join("\n"));
}

export async function handlePipelineChat({ body, models, dispatch, signal, beforeStep, inspectOutput }) {
  if (!models.length || models.length > MAX_STEPS) {
    return errorResponse(400, `A pipeline requires 1–${MAX_STEPS} steps`);
  }
  if (models.length === 1) return dispatch(body, models[0], false);
  if (body.previous_response_id || body.conversation) {
    return errorResponse(400, "A pipeline requires the conversation to be included in the request");
  }

  let previousOutput = "";
  for (let index = 0; index < models.length; index++) {
    if (signal?.aborted) return errorResponse(499, "Request aborted");
    const denial = await beforeStep?.(index);
    if (denial) return denial;

    const last = index === models.length - 1;
    const step = withPreviousOutput(body, previousOutput);
    if (last) return dispatch(step, models[index], false);

    const intermediate = withoutChatTools(step);
    delete intermediate.response_format;
    delete intermediate.text;
    const response = await dispatch(structuredClone(intermediate), models[index], true);
    if (!response.ok) return response;
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      response.body?.cancel().catch(() => {});
      return errorResponse(502, `Pipeline step ${index + 1} returned a stream instead of a completion`);
    }

    try {
      previousOutput = extractCompletionText(await readBoundedJson(response, MAX_STEP_BYTES));
    } catch {
      return errorResponse(502, `Pipeline step ${index + 1} returned an invalid completion`);
    }
    if (!previousOutput.trim() || previousOutput.length > MAX_STEP_TEXT) {
      return errorResponse(502, `Pipeline step ${index + 1} returned empty or oversized text`);
    }
    if (inspectOutput) {
      const result = inspectOutput(previousOutput);
      if (result.blocked) return errorResponse(400, `The prompt injection guardrail blocked pipeline step ${index + 1}`);
      previousOutput = result.text;
    }
  }
}
