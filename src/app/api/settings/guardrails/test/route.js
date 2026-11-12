import { getSettings } from "@/lib/localDb";
import { previewChatGuardrails } from "@/sse/services/chatGuardrails.js";
import { PayloadTooLarge, readBoundedJson } from "@/sse/utils/readBoundedJson.js";

export async function POST(request) {
  let input;
  try {
    input = await readBoundedJson(request, 65_536);
  } catch (error) {
    return Response.json({ error: "Invalid guardrail test payload" }, { status: error instanceof PayloadTooLarge ? 413 : 400 });
  }
  if (typeof input?.text !== "string" || input.text.length > 16_000) {
    return Response.json({ error: "Provide up to 16,000 characters of text" }, { status: 400 });
  }
  const policy = input.policy ?? (await getSettings()).chatGuardrails;
  return Response.json(previewChatGuardrails(input.text, policy), { headers: { "Cache-Control": "no-store" } });
}
