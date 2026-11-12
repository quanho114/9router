// Shared by the response lifecycle and usage writers across Next route bundles.
const inFlight = globalThis[Symbol.for("9router.keySpendWrites")] ??= new Map();

export function beginKeySpend(apiKey) {
  if (inFlight.has(apiKey)) return null;
  const writes = new Set();
  inFlight.set(apiKey, writes);
  return async () => {
    await waitForKeySpendWrites(apiKey);
    if (inFlight.get(apiKey) === writes) inFlight.delete(apiKey);
  };
}

export async function waitForKeySpendWrites(apiKey) {
  const writes = inFlight.get(apiKey);
  while (writes?.size) await Promise.allSettled(writes);
}

export function trackKeySpendWrite(apiKey, promise) {
  const writes = inFlight.get(apiKey);
  if (!writes) return;
  writes.add(promise);
  const remove = () => writes.delete(promise);
  promise.then(remove, remove);
}
