const MAX_QUEUE_SIZE = 64;
const IDLE_TTL_MS = 10 * 60_000;
const states = globalThis[Symbol.for("9router.connectionResilience")] ??= new Map();

function getConnectionKey(provider, connectionId) {
  return JSON.stringify([provider, connectionId]);
}

function prune(now) {
  for (const [key, state] of states) {
    if (!state.active && !state.queue.length && state.openUntil <= now &&
      now - state.updatedAt > IDLE_TTL_MS) states.delete(key);
  }
}

export function connectionRetryAt(provider, connectionId) {
  const state = states.get(getConnectionKey(provider, connectionId));
  if (!state) return 0;
  const now = Date.now();
  if (state.openUntil > now) return state.openUntil;
  return state.probing ? now + 1000 : 0;
}

function admit(state, config) {
  const isProbe = state.openUntil > 0;
  const generation = state.generation;
  if (isProbe) state.probing = true;
  state.active++;
  state.updatedAt = Date.now();
  let done = false;
  return {
    complete(outcome) {
      if (done) return;
      done = true;
      state.active--;
      state.updatedAt = Date.now();
      if (generation === state.generation) {
        if (isProbe) state.probing = false;
        if (outcome === "success") {
          state.failures = 0;
          state.openUntil = 0;
        } else if (outcome === "failure" && (++state.failures >= config.failureThreshold || isProbe)) {
          state.openUntil = state.updatedAt + config.cooldownMs;
          state.generation++;
        }
      }
      drainQueue(state);
    },
  };
}

function drainQueue(state) {
  while (state.queue.length) {
    const entry = state.queue[0];
    const retryAt = connectionRetryAt(state.provider, state.connectionId);
    if (retryAt) {
      entry.finish({ retryAt });
    } else if (state.active < entry.config.maxConcurrent) {
      entry.finish(admit(state, entry.config));
    } else {
      return;
    }
  }
}

export function enterConnection(provider, connectionId, config, signal) {
  if (signal?.aborted) return { aborted: true };
  const now = Date.now();
  const key = getConnectionKey(provider, connectionId);
  let state = states.get(key);
  if (!state) {
    prune(now);
    state = { provider, connectionId, active: 0, queue: [], failures: 0,
      openUntil: 0, generation: 0, probing: false, updatedAt: now };
    states.set(key, state);
  }
  const retryAt = connectionRetryAt(provider, connectionId);
  if (retryAt) return { retryAt };
  if (!state.queue.length && state.active < config.maxConcurrent) return admit(state, config);
  if (!config.queueTimeoutMs || state.queue.length >= MAX_QUEUE_SIZE) return { retryAt: now + 1000 };

  return new Promise((resolve) => {
    const entry = { config, finish };
    const timer = setTimeout(() => finish({ retryAt: Date.now() + 1000 }), config.queueTimeoutMs);
    const abort = () => finish({ aborted: true });
    state.queue.push(entry);
    signal?.addEventListener("abort", abort, { once: true });

    function finish(result) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      const index = state.queue.indexOf(entry);
      if (index !== -1) state.queue.splice(index, 1);
      resolve(result);
    }
  });
}

export function getConnectionResilienceSnapshot() {
  const now = Date.now();
  prune(now);
  return [...states.values()].map((state) => ({
    provider: state.provider,
    connectionId: state.connectionId,
    active: state.active,
    queued: state.queue.length,
    failures: state.failures,
    state: state.openUntil > now ? "open" : state.openUntil ? "half-open" : "closed",
    retryAt: state.openUntil > now ? new Date(state.openUntil).toISOString() : null,
  }));
}
