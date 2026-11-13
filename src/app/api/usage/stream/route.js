import { getUsageStats, statsEmitter, getActiveRequests } from "@/lib/usageDb";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const encoder = new TextEncoder();
  let liveOnly = false;
  try {
    liveOnly = new URL(request?.url || "", "http://localhost").searchParams.get("live") === "1";
  } catch {}
  let closed = false;
  let refreshTimer;
  let sending = false;
  let pending = false;
  let fullRefresh = false;
  let cachedStats = null;
  let controller;

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(refreshTimer);
    statsEmitter.off("update", liveOnly ? sendPending : sendFull);
    statsEmitter.off("pending", sendPending);
    request?.signal?.removeEventListener("abort", close);
    try { controller?.close(); } catch {}
  }

  // Serialize reads: a slow full refresh must not overwrite a newer completion.
  async function send(full = false) {
    if (closed) return;
    pending = true;
    fullRefresh ||= full;
    if (sending) return;
    sending = true;
    try {
      while (pending && !closed) {
        pending = false;
        const refresh = fullRefresh;
        fullRefresh = false;
        if (!liveOnly && (refresh || !cachedStats)) cachedStats = await getUsageStats();
        const live = await getActiveRequests();
        if (closed) return;
        const payload = liveOnly ? live : { ...cachedStats, ...live };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      }
    } catch {
      close();
    } finally {
      sending = false;
    }
  }

  const sendFull = () => { void send(true); };
  const sendPending = () => { void send(); };

  const stream = new ReadableStream({
    start(streamController) {
      controller = streamController;
      // Listen before the initial read so completions during startup aren't lost.
      statsEmitter.on("update", liveOnly ? sendPending : sendFull);
      statsEmitter.on("pending", sendPending);
      request?.signal?.addEventListener("abort", close, { once: true });
      if (request?.signal?.aborted) { close(); return; }
      // Reconcile missed events without repeatedly querying historical usage.
      // These lightweight snapshots also keep the SSE connection alive.
      refreshTimer = setInterval(sendPending, 3000);
      refreshTimer.unref?.();
      if (liveOnly) sendPending();
      else sendFull();
    },
    cancel: close,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
