import { createHash, randomUUID } from "node:crypto";
import { TOKEN_SAVER_HEADER } from "open-sse/config/runtimeConfig.js";
import { readBoundedJson } from "../utils/readBoundedJson.js";

const MAX_ENTRIES = 256;
const TTL_MS = 5 * 60_000;
const MIN_SIMILARITY = 0.985;
const MAX_TEXT = 8_192;
const CACHEABLE_FIELDS = new Set(["model", "messages", "temperature", "stream", "max_tokens", "max_completion_tokens", "top_p"]);
const STATEFUL_HEADERS = [
  "x-session-id", "session-id", "session_id", "x-amp-thread-id", "x-claude-code-session-id",
  "x-client-request-id", "x-connection-id", "anthropic-beta",
];
const cache = globalThis[Symbol.for("9router.semanticCache")] ??= new Map();

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeVector(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 8192) return null;
  let sum = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) return null;
    sum += value * value;
  }
  if (!Number.isFinite(sum) || sum <= 0) return null;
  const magnitude = Math.sqrt(sum);
  return Float32Array.from(values, (value) => value / magnitude);
}

function cosine(a, b) {
  if (a.length !== b.length) return -1;
  let score = 0;
  for (let index = 0; index < a.length; index++) score += a[index] * b[index];
  return score;
}

function getCacheableRequest(request, body) {
  if (!new URL(request.url).pathname.endsWith("/chat/completions")) return null;
  if (request.headers.get(TOKEN_SAVER_HEADER)?.toLowerCase() === "off" ||
      /\b(no-cache|no-store)\b/i.test(request.headers.get("cache-control") || "") ||
      STATEFUL_HEADERS.some((header) => request.headers.has(header))) return null;
  if (body.stream !== false || body.temperature !== 0 ||
      Object.keys(body).some((key) => !CACHEABLE_FIELDS.has(key))) return null;
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 4) return null;

  const instructions = body.messages.slice(0, -1);
  const prompt = body.messages.at(-1);
  const isPlain = (message) => message && typeof message.content === "string" &&
    message.content.length <= MAX_TEXT && Object.keys(message).every((key) => key === "role" || key === "content");
  if (!isPlain(prompt) || prompt.role !== "user" || !prompt.content.trim() ||
      !instructions.every((message) => isPlain(message) && ["system", "developer"].includes(message.role))) return null;
  const options = [instructions, body.max_tokens, body.max_completion_tokens, body.top_p];
  return { prompt: prompt.content, options };
}

function matchSignature(prompt) {
  // Preserve literals, paths and negation even for vectors that are very close.
  const literals = prompt.match(/[`"'][^`"'\r\n]{1,120}[`"']|\b[\w./:-]*\d[\w./:-]*\b|\b[\w.-]+\/[\w./-]+|\b(?:no|not|never|without|except)\b|không|đừng|ngoại trừ/giu);
  return hash(JSON.stringify(literals || []));
}

function hitResponse(entry, kind) {
  return Response.json({
    id: `chatcmpl-cache-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: entry.model,
    choices: [{ index: 0, message: { role: "assistant", content: entry.content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }, {
    headers: {
      "Cache-Control": "no-store",
      "X-9Router-Cache": kind,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "X-9Router-Cache",
    },
  });
}

export async function withSemanticCache({ request, body, apiKey, config, embed, dispatch }) {
  const input = apiKey && getCacheableRequest(request, body);
  if (!input) return dispatch();

  const now = Date.now();
  const scope = hash(JSON.stringify([apiKey, config, input.options]));
  const key = `${scope}:${hash(input.prompt)}`;
  for (const [id, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(id);
  }
  const exact = cache.get(key);
  if (exact) return hitResponse(exact, "exact");

  let vector;
  try {
    vector = normalizeVector(await embed(input.prompt));
  } catch {
    return dispatch();
  }
  if (!vector) return dispatch();

  const signature = matchSignature(input.prompt);
  let best = null;
  let bestScore = MIN_SIMILARITY;
  for (const entry of cache.values()) {
    if (entry.scope !== scope || entry.signature !== signature || entry.expiresAt <= Date.now()) continue;
    const score = cosine(vector, entry.vector);
    if (score >= bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  if (best) return hitResponse(best, "semantic");

  const response = await dispatch();
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return response;
  try {
    const result = await readBoundedJson(response.clone(), 65_536);
    const choice = result?.choices?.[0];
    const message = choice?.message;
    if (result?.choices?.length === 1 && choice.finish_reason === "stop" &&
        message?.role === "assistant" && typeof message.content === "string" &&
        message.content.trim() && !message.tool_calls?.length && !message.function_call &&
        !message.refusal && !message.audio && typeof result.model === "string") {
      cache.set(key, { scope, signature, vector, model: result.model, content: message.content, expiresAt: Date.now() + TTL_MS });
      if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
    }
  } catch {
    // Caching is optional and the untouched response is still available.
  }
  return response;
}
