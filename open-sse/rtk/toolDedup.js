import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK, RESPONSES_ITEM } from "../translator/schema/index.js";
import { MIN_COMPRESS_SIZE } from "./constants.js";

const TOOL_CALL_ID = /^[A-Za-z0-9_-]{1,128}$/;

function visitToolOutputs(body, visit) {
  for (const item of body.messages || body.input || []) {
    if (!item || item.is_error || item.status === "error") continue;
    if (item.role === ROLE.TOOL) {
      visit(item, "content", item.tool_call_id, OPENAI_BLOCK.TEXT);
    } else if (item.type === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT) {
      visit(item, "output", item.call_id, RESPONSES_ITEM.INPUT_TEXT);
    } else if (Array.isArray(item.content)) {
      for (const block of item.content) {
        if (block?.type === CLAUDE_BLOCK.TOOL_RESULT && !block.is_error) {
          visit(block, "content", block.tool_use_id, CLAUDE_BLOCK.TEXT);
        }
      }
    }
  }
}

// Keep the first full result in the supplied history and preserve each call ID.
export function deduplicateToolOutputs(body) {
  const items = body.messages ?? body.input;
  if (!Array.isArray(items)) return { body, count: 0 };
  const seen = new Map();
  const replacements = new Map();
  let index = 0;
  const readText = (owner, field, partType) => {
    const output = owner[field];
    if (typeof output === "string") return output;
    return Array.isArray(output) && output.length === 1 && output[0]?.type === partType
      ? output[0].text
      : null;
  };

  visitToolOutputs(body, (owner, field, id, partType) => {
    const position = index++;
    if (typeof id !== "string" || !TOOL_CALL_ID.test(id)) return;
    const output = readText(owner, field, partType);
    if (typeof output !== "string" || output.length < MIN_COMPRESS_SIZE) return;
    const originalId = seen.get(output);
    if (!originalId) {
      seen.set(output, id);
    } else if (originalId !== id) {
      const reference = `[Identical tool output. See earlier tool call ${originalId}.]`;
      if (reference.length < output.length) replacements.set(position, reference);
    }
  });

  if (!replacements.size) return { body, count: 0 };
  const next = structuredClone(body);
  index = 0;
  visitToolOutputs(next, (owner, field) => {
    const replacement = replacements.get(index++);
    if (!replacement) return;
    if (typeof owner[field] === "string") owner[field] = replacement;
    else owner[field][0].text = replacement;
  });
  return { body: next, count: replacements.size };
}
