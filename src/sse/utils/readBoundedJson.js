export class PayloadTooLarge extends Error {}

export async function readBoundedJson(message, limit, { allowEmpty = false } = {}) {
  if (!message.body) {
    if (allowEmpty) return undefined;
    throw new SyntaxError("Missing JSON body");
  }
  const reader = message.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        if (allowEmpty && size === 0) return undefined;
        return JSON.parse(text + decoder.decode());
      }
      size += value.byteLength;
      if (size > limit) {
        reader.cancel().catch(() => {});
        throw new PayloadTooLarge("JSON payload is too large");
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}
