export const GUARDRAIL_DEFAULTS = Object.freeze({
  maskPii: false,
  maskSecrets: false,
  blockPromptInjection: false,
});

export function normalizeGuardrails(input) {
  return Object.fromEntries(Object.keys(GUARDRAIL_DEFAULTS).map((key) => [key, input?.[key] === true]));
}
