import { getApiKeyByKey } from "@/lib/db/repos/apiKeysRepo.js";
import { checkKeyStatus } from "@/shared/utils/keyAccess.js";
import { PayloadTooLarge, readBoundedJson } from "@/sse/utils/readBoundedJson.js";

export const RPC_HEADERS = { "Cache-Control": "no-store" };
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function resultEnvelope(id, result) {
  return { jsonrpc: "2.0", id, result };
}

export function rpcResult(id, result) {
  return Response.json(resultEnvelope(id, result), { headers: RPC_HEADERS });
}

export function rpcError(id, code, message, status = 200) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status, headers: RPC_HEADERS });
}

export function gatewayRequestOrigin(request) {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  if (host && !/[/\\@?#\s]/.test(host)) {
    try {
      return new URL(`${url.protocol}//${host}`).origin;
    } catch {
      // Some adapters omit or normalize Host. Keep their parsed origin.
    }
  }
  return url.origin;
}

export function validGatewayOrigin(request) {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  if (!origin || origin === "null") return false;
  const url = new URL(gatewayRequestOrigin(request));
  if (LOOPBACK.has(url.hostname) && origin === url.origin) return true;
  const allowed = (process.env.GATEWAY_PROTOCOL_ORIGINS || "").split(",").map((item) => item.trim());
  return allowed.includes(origin);
}

export async function requireGatewayKey(request) {
  const token = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];
  const record = token ? await getApiKeyByKey(token) : null;
  const status = checkKeyStatus(record);
  if (!status.ok) {
    const response = Response.json({ error: status.message }, { status: status.status, headers: RPC_HEADERS });
    if (status.status === 401) response.headers.set("WWW-Authenticate", "Bearer");
    return { response };
  }
  return { token, owner: record.id };
}

export async function parseRpc(request, { allowNotifications = false } = {}) {
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return { response: rpcError(null, -32600, "Expected application/json", 415) };

  let message;
  try {
    message = await readBoundedJson(request, 65_536);
  } catch (error) {
    return { response: error instanceof PayloadTooLarge
      ? rpcError(null, -32600, "Request body is too large", 413)
      : rpcError(null, -32700, "Parse error", 400) };
  }

  const validId = typeof message?.id === "string" && message.id.length <= 256 || Number.isSafeInteger(message?.id);
  const notification = allowNotifications && message && !Object.hasOwn(message, "id");
  if (!message || Array.isArray(message) || message.jsonrpc !== "2.0" ||
      typeof message.method !== "string" || !(validId || notification)) {
    return { response: rpcError(null, -32600, "Invalid JSON-RPC request", 400) };
  }
  return { message, notification };
}
