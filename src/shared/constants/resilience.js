export const RESILIENCE_DEFAULTS = Object.freeze({
  enabled: false,
  maxConcurrent: 8,
  queueTimeoutMs: 1000,
  failureThreshold: 3,
  cooldownMs: 30_000,
});

export const RESILIENCE_LIMITS = Object.freeze({
  maxConcurrent: [1, 128],
  queueTimeoutMs: [0, 30_000],
  failureThreshold: [1, 20],
  cooldownMs: [1000, 300_000],
});

export function resolveResilienceConfig(input = {}) {
  const config = { ...RESILIENCE_DEFAULTS, enabled: input?.enabled === true };
  for (const [key, [min, max]] of Object.entries(RESILIENCE_LIMITS)) {
    if (Number.isInteger(input?.[key]) && input[key] >= min && input[key] <= max) {
      config[key] = input[key];
    }
  }
  return config;
}
