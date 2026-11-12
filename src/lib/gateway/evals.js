import { callGatewayChat, GATEWAY_MODEL_LIMIT, GATEWAY_PROMPT_LIMIT } from "./chat.js";
import { PayloadTooLarge, readBoundedJson } from "@/sse/utils/readBoundedJson.js";
import { RPC_HEADERS } from "./rpc.js";

const MAX_CASES = 16;
const EVAL_TIMEOUT_MS = 90_000;
const CASE_TIMEOUT_MS = 30_000;

export function evalResponse(data, status = 200) {
  return Response.json(data, { status, headers: RPC_HEADERS });
}

export async function readEvalPayload(request, { optional = false } = {}) {
  try {
    const input = await readBoundedJson(request, 262_144, { allowEmpty: optional });
    if (input === undefined) return { input: {} };
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new SyntaxError();
    return { input };
  } catch (error) {
    return { response: evalResponse({ error: "Invalid eval payload" }, error instanceof PayloadTooLarge ? 413 : 400) };
  }
}

function textField(value, maxLength) {
  return typeof value === "string" && value.length <= maxLength && value.trim().length > 0;
}

export function isEvalModel(value) {
  return textField(value, GATEWAY_MODEL_LIMIT);
}

export function validateEvalSuite(input) {
  if (!textField(input.name, 120) || !isEvalModel(input.model)) {
    return { error: "A suite name and model are required" };
  }
  if (!Array.isArray(input.cases) || input.cases.length < 1 || input.cases.length > MAX_CASES) {
    return { error: `Add between 1 and ${MAX_CASES} cases` };
  }
  const cases = [];
  for (const [index, item] of input.cases.entries()) {
    if (!textField(item?.name, 120) || !textField(item.prompt, GATEWAY_PROMPT_LIMIT)) {
      return { error: `Case ${index + 1} requires a name and a prompt` };
    }
    const { type, value } = item.expect || {};
    const valid = type === "status" ? Number.isInteger(value) && value >= 100 && value <= 599 :
      ["contains", "equals"].includes(type) && textField(value, 8000);
    if (!valid) return { error: `Case ${index + 1} has an invalid expectation` };
    cases.push({ name: item.name.trim(), prompt: item.prompt, expect: { type, value } });
  }
  return { suite: { name: input.name.trim(), model: input.model.trim(), cases } };
}

function passes({ type, value }, result) {
  if (type === "status") return result.status === value;
  if (result.status !== 200) return false;
  if (type === "contains") return result.text.includes(value);
  return result.text.trim() === value.trim();
}

export async function runEvalSuite({ suite, model, token, request }) {
  const startedAt = Date.now();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(EVAL_TIMEOUT_MS)]);
  const results = [];
  for (const item of suite.cases) {
    if (signal.aborted) {
      results.push({ name: item.name, passed: null, status: null, durationMs: 0 });
      continue;
    }
    const start = Date.now();
    const result = await callGatewayChat({
      requestUrl: request.url, token, model, prompt: item.prompt,
      signal: AbortSignal.any([signal, AbortSignal.timeout(CASE_TIMEOUT_MS)]),
    }).catch(() => ({ status: 500, text: "" }));
    results.push({
      name: item.name,
      passed: passes(item.expect, result),
      status: result.status,
      durationMs: Date.now() - start,
      output: result.text.slice(0, 2000),
    });
  }
  return {
    suiteId: suite.id,
    model,
    durationMs: Date.now() - startedAt,
    passed: results.filter((row) => row.passed === true).length,
    failed: results.filter((row) => row.passed === false).length,
    skipped: results.filter((row) => row.passed === null).length,
    results,
  };
}
