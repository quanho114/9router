import { normalizeGuardrails } from "@/shared/constants/guardrails.js";
import { ROLE, CLAUDE_BLOCK, OPENAI_BLOCK, RESPONSES_ITEM } from "open-sse/translator/schema/index.js";

const PROMPT_INJECTION = [
  /\b(?:ignore|disregard|forget|override)\s+(?:(?:all|any|the|your)\s+){0,3}(?:previous|prior|above|earlier|system|developer)\s+(?:instructions?|rules?|prompts?|messages?)\b/iu,
  /\b(?:reveal|expose|print|dump|show(?: me)?)\s+(?:(?:the|your|original)\s+){0,3}(?:hidden|system|developer)\s+(?:prompt|instructions?)\b/iu,
  /bỏ qua\s+(?:(?:tất cả|mọi|các)\s+){0,3}(?:hướng dẫn|chỉ dẫn|quy tắc)\s+(?:trước đó|trước đây)/iu,
  /(?:tiết lộ|in ra|hiển thị)\s+(?:prompt|chỉ dẫn|hướng dẫn)\s+hệ thống/iu,
];

const CREDENTIALS = [
  /-----BEGIN ([A-Z ]{0,30}PRIVATE KEY)-----[\s\S]{1,16384}?-----END \1-----/g,
  /\b(?:sk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bAIza[A-Za-z0-9_-]{35}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
];

const EMAIL = /\b[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,24}\b/gi;
const PHONE = /(?<!\w)(?:\+[1-9]\d{0,2}(?:[ .-]?\(?\d{1,4}\)?){2,6}|0[35789](?:[ .-]?\d){8})(?![\w\d])/g;
const CARD = /(?<!\d)\d(?:[ -]?\d){12,18}(?![ -]?\d)/g;

function luhnValid(value) {
  const digits = value.replace(/\D/g, "");
  if (/^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    const digit = Number(digits[index]);
    const doubled = (digits.length - index) % 2 === 0 ? digit * 2 : digit;
    sum += doubled > 9 ? doubled - 9 : doubled;
  }
  return sum % 10 === 0;
}

function inspectText(value, untrusted, policy, result) {
  if (typeof value !== "string") return value;
  if (untrusted && policy.blockPromptInjection && PROMPT_INJECTION.some((pattern) => pattern.test(value))) {
    result.blocked = true;
  }
  const redact = (type) => {
    result.redactions++;
    return `[REDACTED_${type}]`;
  };
  if (policy.maskSecrets) {
    for (const pattern of CREDENTIALS) value = value.replace(pattern, () => redact("SECRET"));
  }
  if (policy.maskPii) {
    value = value.replace(EMAIL, () => redact("EMAIL"));
    value = value.replace(CARD, (match) => luhnValid(match) ? redact("CARD") : match);
    value = value.replace(PHONE, (match) => {
      const count = match.replace(/\D/g, "").length;
      return count >= 8 && count <= 15 ? redact("PHONE") : match;
    });
  }
  return value;
}

export function previewChatGuardrails(text, settings) {
  const result = { blocked: false, redactions: 0 };
  const redacted = inspectText(text, true, normalizeGuardrails(settings), result);
  return { text: redacted, ...result };
}

function editContent(value, untrusted, edit) {
  if (typeof value === "string") return edit(value, untrusted);
  if (!Array.isArray(value)) return value;
  for (const part of value) {
    if (!part || typeof part !== "object") continue;
    if (part.type === CLAUDE_BLOCK.TOOL_RESULT) {
      part.content = editContent(part.content, true, edit);
    } else if (part.type === OPENAI_BLOCK.TEXT || part.type === RESPONSES_ITEM.INPUT_TEXT ||
               part.type === RESPONSES_ITEM.OUTPUT_TEXT || !part.type) {
      if (typeof part.text === "string") part.text = edit(part.text, untrusted);
    }
  }
  return value;
}

function editMessages(messages, edit) {
  if (!Array.isArray(messages)) return;
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    if (message.type === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT || message.type === RESPONSES_ITEM.CUSTOM_TOOL_CALL_OUTPUT) {
      message.output = editContent(message.output, true, edit);
    } else if (message.content !== undefined) {
      const untrusted = !message.role || message.role === ROLE.USER || message.role === ROLE.TOOL;
      message.content = editContent(message.content, untrusted, edit);
    }
  }
}

function editGemini(request, edit) {
  if (!request || typeof request !== "object") return;
  for (const content of Array.isArray(request.contents) ? request.contents : []) {
    if (content) editContent(content.parts, content.role !== "model", edit);
  }
  editContent(request.systemInstruction?.parts, false, edit);
}

export function applyChatGuardrails(body, settings) {
  const policy = normalizeGuardrails(settings);
  if (!Object.values(policy).some(Boolean)) return { body, blocked: false, redactions: 0 };
  const next = structuredClone(body);
  const result = { blocked: false, redactions: 0 };
  const edit = (value, untrusted) => inspectText(value, untrusted, policy, result);
  if (next.instructions !== undefined) next.instructions = editContent(next.instructions, false, edit);
  if (next.system !== undefined) next.system = editContent(next.system, false, edit);
  if (typeof next.input === "string") next.input = edit(next.input, true);
  else editMessages(next.input, edit);
  editMessages(next.messages, edit);
  editGemini(next, edit);
  editGemini(next.request, edit);
  return { body: result.redactions ? next : body, ...result };
}
