import { handleChat } from "@/sse/handlers/chat.js";
import { extractCompletionText } from "open-sse/services/combo.js";
import { initTranslators } from "open-sse/translator/index.js";
import { readBoundedJson } from "@/sse/utils/readBoundedJson.js";

export const GATEWAY_PROMPT_LIMIT = 16_000;
export const GATEWAY_MODEL_LIMIT = 200;

export async function callGatewayChat({ requestUrl, token, model, prompt, signal }) {
  const interrupted = () => ({ status: signal.reason?.name === "TimeoutError" ? 504 : 499, text: "" });
  if (!signal) return dispatch({ requestUrl, token, model, prompt });
  if (signal.aborted) return interrupted();
  let onAbort;
  const canceled = new Promise((resolve) => {
    onAbort = () => resolve(interrupted());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([dispatch({ requestUrl, token, model, prompt, signal }), canceled]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function dispatch({ requestUrl, token, model, prompt, signal }) {
  initTranslators();
  const response = await handleChat(new Request(new URL("/v1/chat/completions", requestUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      max_tokens: 2048,
    }),
    signal,
  }));
  if (!response.ok) {
    response.body?.cancel().catch(() => {});
    return { status: response.status, text: "" };
  }
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    response.body?.cancel().catch(() => {});
    return { status: 502, text: "" };
  }
  try {
    const text = extractCompletionText(await readBoundedJson(response, 65_536));
    return { status: text.trim() ? 200 : 502, text };
  } catch {
    return { status: 502, text: "" };
  }
}
