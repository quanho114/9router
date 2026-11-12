import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  modelList: vi.fn(),
  settings: { gatewayMcpEnabled: true, gatewayA2aEnabled: true, gatewayA2aModel: "Main" },
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => mocks.settings }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({
  getApiKeyByKey: async (token) => ["key-a", "key-b"].includes(token) ? { id: token, isActive: true } : null,
}));
vi.mock("@/sse/services/keyAccess.js", () => ({
  getKeyAccessContext: async (request) => ({ token: request.headers.get("authorization") }),
  filterModelsListForKey: async (ctx, models) => ctx.token === "Bearer key-a" ? models.slice(0, 1) : models,
}));
vi.mock("@/app/api/v1/models/route.js", () => ({ buildModelsList: mocks.modelList }));
vi.mock("@/lib/gateway/chat.js", () => ({
  callGatewayChat: mocks.chat,
  GATEWAY_MODEL_LIMIT: 200,
  GATEWAY_PROMPT_LIMIT: 16_000,
}));

const mcp = await import("@/app/api/v1/mcp/route.js");
const a2a = await import("@/app/api/v1/a2a/route.js");
const card = await import("@/app/api/v1/a2a/card/route.js");

function rpc(path, method, params, { key = "key-a", origin, id = 1 } = {}) {
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (origin) headers.Origin = origin;
  const message = { jsonrpc: "2.0", method, params };
  if (id !== null) message.id = id;
  return new Request(`http://localhost${path}`, { method: "POST", headers, body: JSON.stringify(message) });
}

const a2aMessage = (messageId, blocking) => ({
  configuration: { blocking },
  message: { kind: "message", role: "user", messageId, parts: [{ kind: "text", text: "Say hello" }] },
});

beforeEach(() => {
  mocks.chat.mockReset().mockResolvedValue({ status: 200, text: "Hello" });
  mocks.modelList.mockReset().mockResolvedValue([{ id: "Main" }, { id: "private-model" }]);
});

describe("MCP Streamable HTTP", () => {
  it("requires a bearer key and rejects unexpected browser origins", async () => {
    expect((await mcp.POST(rpc("/v1/mcp", "tools/list", {}, { key: null }))).status).toBe(401);
    expect((await mcp.POST(rpc("/v1/mcp", "tools/list", {}, { origin: "https://untrusted.test" }))).status).toBe(403);
  });

  it("initializes, accepts notifications and uses the same key for model visibility and chat", async () => {
    const init = await mcp.POST(rpc("/v1/mcp", "initialize", { protocolVersion: "2025-11-25" }));
    expect((await init.json()).result).toMatchObject({ protocolVersion: "2025-11-25", capabilities: { tools: {} } });
    const notice = await mcp.POST(rpc("/v1/mcp", "notifications/initialized", {}, { id: null }));
    expect(notice.status).toBe(202);
    const response = await mcp.POST(rpc("/v1/mcp", "tools/call", { name: "list_models" }));
    expect(JSON.parse((await response.json()).result.content[0].text)).toEqual([{ id: "Main" }]);
    const chat = await mcp.POST(rpc("/v1/mcp", "tools/call", { name: "chat", arguments: { model: "Main", prompt: "Hello" } }));
    expect((await chat.json()).result.content[0].text).toBe("Hello");
    expect(mocks.chat).toHaveBeenCalledWith(expect.objectContaining({ token: "key-a", model: "Main", prompt: "Hello" }));
  });
});

describe("A2A", () => {
  it("publishes an agent card and handles a streaming task with final status and artifact", async () => {
    const agent = await card.GET(new Request("http://localhost/.well-known/agent-card.json", { headers: { Host: "127.0.0.1:3999" } }));
    expect(await agent.json()).toMatchObject({ protocolVersion: "0.3.0", url: "http://127.0.0.1:3999/v1/a2a" });

    const response = await a2a.POST(rpc("/v1/a2a", "message/stream", a2aMessage("stream-test")));
    const events = (await response.text()).trim().split("\n\n").map((frame) => JSON.parse(frame.slice(6)).result);
    expect(events[0]).toMatchObject({ kind: "task" });
    expect(events[1]).toMatchObject({ kind: "artifact-update", artifact: { parts: [{ kind: "text", text: "Hello" }] } });
    expect(events[2]).toMatchObject({ kind: "status-update", status: { state: "completed" }, final: true });
  });

  it("isolates task owners, reuses duplicate requests and cancels in-flight work", async () => {
    let signal;
    mocks.chat.mockImplementation((input) => {
      signal = input.signal;
      return new Promise((resolve) => signal.addEventListener("abort", () => resolve({ status: 499 }), { once: true }));
    });
    const send = () => a2a.POST(rpc("/v1/a2a", "message/send", a2aMessage("owner-test", false)));
    const first = (await (await send()).json()).result;
    const duplicate = (await (await send()).json()).result;
    expect(duplicate.id).toBe(first.id);
    expect(mocks.chat).toHaveBeenCalledTimes(1);
    const otherKey = await a2a.POST(rpc("/v1/a2a", "tasks/get", { id: first.id }, { key: "key-b" }));
    expect((await otherKey.json()).error.code).toBe(-32001);
    const cancel = await a2a.POST(rpc("/v1/a2a", "tasks/cancel", { id: first.id }));
    expect((await cancel.json()).result.status.state).toBe("canceled");
    expect(signal.aborted).toBe(true);
  });
});
