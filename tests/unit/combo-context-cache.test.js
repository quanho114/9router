import { describe, expect, it, vi } from "vitest";
import { deduplicateToolOutputs } from "open-sse/rtk/toolDedup.js";
import { withSemanticCache } from "@/sse/services/semanticCache.js";

function chatBody(content) {
  return { model: "docs", stream: false, temperature: 0, messages: [{ role: "user", content }] };
}

function completion(text) {
  return Response.json({
    model: "example",
    choices: [{ finish_reason: "stop", message: { role: "assistant", content: text } }],
  });
}

describe("combo context processing", () => {
  it("keeps original tool output, IDs and errors in Chat, Messages and Responses inputs", () => {
    const output = "same large output\n".repeat(400);
    const chat = { messages: [
      { role: "tool", tool_call_id: "first", content: output },
      { role: "user", content: "again" },
      { role: "tool", tool_call_id: "second", content: output },
      { role: "tool", tool_call_id: "failed", content: output, is_error: true },
    ] };
    const rewritten = deduplicateToolOutputs(chat);
    expect(rewritten.count).toBe(1);
    expect(rewritten.body.messages[0].content).toBe(output);
    expect(rewritten.body.messages[2]).toMatchObject({ tool_call_id: "second", content: expect.stringContaining("first") });
    expect(rewritten.body.messages[3].content).toBe(output);
    expect(chat.messages[2].content).toBe(output);

    const blocks = [{ type: "tool_result", tool_use_id: "claude-first", content: output },
      { type: "tool_result", tool_use_id: "claude-second", content: [{ type: "text", text: output }] }];
    expect(deduplicateToolOutputs({ messages: blocks.map((block) => ({ role: "user", content: [block] })) }).count).toBe(1);
    const input = [
      { type: "function_call_output", call_id: "first", output },
      { type: "function_call_output", call_id: "second", output: [{ type: "input_text", text: output }] },
    ];
    expect(deduplicateToolOutputs({ input }).body.input[1].output[0].text).toContain("first");
  });

  it("serves exact and vector matches per API key and keeps distinct numeric literals separate", async () => {
    const request = new Request("http://localhost/v1/chat/completions");
    const embed = vi.fn(async () => [0.99, 0.01]);
    const dispatch = vi.fn(async () => completion("First answer"));
    const call = (body, apiKey = "cache-test-a") =>
      withSemanticCache({ request, body, apiKey, config: ["docs"], embed, dispatch });

    expect((await call(chatBody("What is version 3?"))).headers.get("x-9router-cache")).toBeNull();
    expect((await call(chatBody("What is version 3?"))).headers.get("x-9router-cache")).toBe("exact");
    expect(embed).toHaveBeenCalledTimes(1);
    const similar = await call(chatBody("Could you explain version 3?"));
    expect(similar.headers.get("x-9router-cache")).toBe("semantic");
    expect((await similar.json()).usage.total_tokens).toBe(0);
    expect((await call(chatBody("What is version 4?"))).headers.get("x-9router-cache")).toBeNull();
    expect((await call(chatBody("What is version 3?"), "cache-test-b")).headers.get("x-9router-cache")).toBeNull();
    expect(dispatch).toHaveBeenCalledTimes(3);
  });

  it("skips stateful, streaming and tool-enabled requests", async () => {
    const request = new Request("http://localhost/v1/chat/completions");
    const embed = vi.fn();
    const dispatch = vi.fn(async () => completion("Live"));
    const body = chatBody("Do the thing");
    for (const variant of [{ ...body, stream: true }, { ...body, tools: [] }, { ...body, metadata: { user_id: "other" } }]) {
      await withSemanticCache({ request, body: variant, apiKey: "cache-test", config: ["docs"], embed, dispatch });
    }
    expect(embed).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledTimes(3);
  });
});
