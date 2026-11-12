import { getSettings } from "@/lib/localDb";
import { APP_CONFIG } from "@/shared/constants/config.js";
import { gatewayRequestOrigin, RPC_HEADERS } from "@/lib/gateway/rpc.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  if ((await getSettings()).gatewayA2aEnabled !== true) {
    return Response.json({ error: "A2A is disabled" }, { status: 404, headers: RPC_HEADERS });
  }
  let url = new URL("/v1/a2a", gatewayRequestOrigin(request));
  if (process.env.GATEWAY_PUBLIC_ORIGIN) {
    try {
      const configured = new URL("/v1/a2a", process.env.GATEWAY_PUBLIC_ORIGIN);
      if ((configured.protocol === "https:" || configured.protocol === "http:") &&
          !configured.username && !configured.password) url = configured;
    } catch {
      // Use the request origin when a configured origin is invalid.
    }
  }
  return Response.json({
    name: "9router",
    description: "Route text tasks through a configured model or combo.",
    url: url.href,
    preferredTransport: "JSONRPC",
    protocolVersion: "0.3.0",
    version: APP_CONFIG.version,
    capabilities: { streaming: true, pushNotifications: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    securitySchemes: { apiKey: { type: "http", scheme: "bearer" } },
    security: [{ apiKey: [] }],
    skills: [{
      id: "chat", name: "Chat", description: "Send a text prompt to a model or combo. Set metadata.model to override the agent's default.",
      tags: ["chat", "routing"],
    }],
  }, { headers: RPC_HEADERS });
}
