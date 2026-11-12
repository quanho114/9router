// Keep the release tied to the response body, including client cancellation.
export function withResponseFinalizer(response, finalize) {
  if (!response.body) {
    finalize("complete");
    return response;
  }
  const reader = response.body.getReader();
  let finalized;
  const finish = (outcome) => finalized ??= Promise.resolve().then(() => finalize(outcome));
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          await finish("complete");
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        try {
          await finish("error");
        } finally {
          controller.error(error);
        }
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        await finish("cancel");
      }
    },
  }, { highWaterMark: 0 });
  return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
}
