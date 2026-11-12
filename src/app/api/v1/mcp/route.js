import { getSettings } from "@/lib/localDb";
import { APP_CONFIG } from "@/shared/constants/config.js";
import { buildModelsList } from "../models/route.js";
import { filterModelsListForKey, getKeyAccessContext } from "@/sse/services/keyAccess.js";
import { callGatewayChat, GATEWAY_MODEL_LIMIT, GATEWAY_PROMPT_LIMIT } from "@/lib/gateway/chat.js";
import { parseRpc, requireGatewayKey, rpcError, rpcResult, RPC_HEADERS, validGatewayOrigin } from "@/lib/gateway/rpc.js";

export const dynamic = "force-dynamic";

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const TOOLS = [
  {
    name: "list_models",
    description: "List chat models and combos available to this API key.",
    inputSchema: { type: "object", properties: {
      limit: { type: "integer", minimum: 1, maximum: 100 },
    }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "chat",
    description: "Send a text prompt to a 9router model or combo. Uses the caller's API key and may incur usage.",
    inputSchema: { type: "object", properties: {
      model: { type: "string", minLength: 1, maxLength: GATEWAY_MODEL_LIMIT },
      prompt: { type: "string", minLength: 1, maxLength: GATEWAY_PROMPT_LIMIT },
    }, required: ["model", "prompt"], additionalProperties: false },
  },
];

async function authorize(request) {
  if (!validGatewayOrigin(request)) return { response: rpcError(null, -32600, "Origin is not allowed", 403) };
  const version = request.headers.get("mcp-protocol-version");
  if (version !== null && !PROTOCOL_VERSIONS.includes(version)) {
    return { response: rpcError(null, -32600, "Unsupported MCP protocol version", 400) };
  }
  if ((await getSettings()).gatewayMcpEnabled !== true) {
    return { response: rpcError(null, -32601, "MCP is disabled", 404) };
  }
  return requireGatewayKey(request);
}

export async function GET(request) {
  const { response } = await authorize(request);
  return response || new Response(null, { status: 405, headers: { ...RPC_HEADERS, Allow: "POST" } });
}

export const DELETE = GET;

export async function POST(request) {
  const auth = await authorize(request);
  if (auth.response) return auth.response;
  const accept = request.headers.get("accept") || "";
  if (accept && !/application\/json|application\/\*|\*\/\*/i.test(accept)) {
    return rpcError(null, -32600, "Client must accept application/json", 406);
  }
  const rpc = await parseRpc(request, { allowNotifications: true });
  if (rpc.response) return rpc.response;
  if (rpc.notification) return new Response(null, { status: 202, headers: RPC_HEADERS });

  const { id, method, params } = rpc.message;
  switch (method) {
    case "initialize": {
      const protocolVersion = params?.protocolVersion;
      if (typeof protocolVersion !== "string") return rpcError(id, -32602, "protocolVersion is required");
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(protocolVersion) ? protocolVersion : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "9router", version: APP_CONFIG.version },
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call":
      return callTool(request, auth.token, id, params);
    default:
      return rpcError(id, -32601, "Method not found");
  }
}

async function callTool(request, token, id, params) {
  const args = params?.arguments ?? {};
  if (typeof args !== "object" || Array.isArray(args)) return rpcError(id, -32602, "Invalid tool arguments");
  try {
    if (params?.name === "list_models") {
      const limit = args.limit ?? 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return rpcError(id, -32602, "limit must be an integer from 1 to 100");
      }
      const models = await filterModelsListForKey(
        await getKeyAccessContext(request),
        await buildModelsList(["llm"], { skipDynamicFetch: true })
      );
      const data = models.slice(0, limit).map(({ id, owned_by }) => ({ id, owned_by }));
      return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(data) }] });
    }
    if (params?.name !== "chat") return rpcError(id, -32602, "Unknown tool");
    const { model, prompt } = args;
    if (typeof model !== "string" || !model.trim() || model.length > GATEWAY_MODEL_LIMIT ||
        typeof prompt !== "string" || !prompt.trim() || prompt.length > GATEWAY_PROMPT_LIMIT) {
      return rpcError(id, -32602, "A model and text prompt are required");
    }
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]);
    const result = await callGatewayChat({ requestUrl: request.url, token, model: model.trim(), prompt, signal });
    if (result.status !== 200) {
      return rpcResult(id, { isError: true, content: [{ type: "text", text: `Gateway returned HTTP ${result.status}` }] });
    }
    return rpcResult(id, { content: [{ type: "text", text: result.text }] });
  } catch {
    return rpcResult(id, { isError: true, content: [{ type: "text", text: "Gateway tool failed" }] });
  }
}
