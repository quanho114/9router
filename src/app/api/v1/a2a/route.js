import { after } from "next/server";
import { getSettings } from "@/lib/localDb";
import { callGatewayChat, GATEWAY_MODEL_LIMIT, GATEWAY_PROMPT_LIMIT } from "@/lib/gateway/chat.js";
import { getA2aTask, startA2aTask } from "@/lib/gateway/a2aTasks.js";
import { parseRpc, requireGatewayKey, resultEnvelope, rpcError, rpcResult, RPC_HEADERS, validGatewayOrigin } from "@/lib/gateway/rpc.js";

export const dynamic = "force-dynamic";
export const maxDuration = 125;

function readMessage(params, defaultModel) {
  const message = params?.message;
  if (message?.role !== "user" || typeof message.messageId !== "string" ||
      !message.messageId.trim() || message.messageId.length > 128 ||
      !Array.isArray(message.parts) || !message.parts.length || message.parts.length > 32) {
    return { code: -32602, message: "A user message with a messageId and text parts is required" };
  }
  if (message.taskId || message.contextId) {
    return { code: -32004, message: "Send a new message without taskId or contextId for a single-turn task" };
  }
  if (params.configuration?.pushNotificationConfig) return { code: -32003, message: "Push notifications are unavailable" };
  const modes = params.configuration?.acceptedOutputModes;
  if (message.parts.some((part) => part?.kind !== "text" || typeof part.text !== "string") ||
      (modes?.length && (!Array.isArray(modes) || !modes.includes("text/plain")))) {
    return { code: -32005, message: "This agent accepts and produces text/plain" };
  }
  const prompt = message.parts.map((part) => part.text).join("\n");
  const model = params.metadata?.model ?? defaultModel;
  if (typeof model !== "string" || !model.trim() || model.length > GATEWAY_MODEL_LIMIT ||
      !prompt.trim() || prompt.length > GATEWAY_PROMPT_LIMIT) {
    return { code: -32602, message: "A valid text prompt and a model in metadata.model or the agent settings are required" };
  }
  return { prompt, model: model.trim(), messageId: message.messageId };
}

function streamTask(id, entry) {
  const encoder = new TextEncoder();
  let open = true;
  let heartbeat;
  const close = () => {
    open = false;
    clearInterval(heartbeat);
  };
  const stream = new ReadableStream({
    start(controller) {
      const emit = (event) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(resultEnvelope(id, event))}\n\n`));
      const initial = entry.task;
      emit(initial);
      heartbeat = setInterval(() => {
        if (open) controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 15_000);
      heartbeat.unref?.();
      entry.done.then((task) => {
        if (!open) return;
        if (!initial.artifacts && task.artifacts) {
          for (const artifact of task.artifacts) {
            emit({ kind: "artifact-update", taskId: task.id, contextId: task.contextId, artifact, lastChunk: true });
          }
        }
        emit({ kind: "status-update", taskId: task.id, contextId: task.contextId, status: task.status, final: true });
        close();
        controller.close();
      });
    },
    cancel: close,
  });
  return new Response(stream, {
    headers: { ...RPC_HEADERS, "Content-Type": "text/event-stream", "X-Accel-Buffering": "no" },
  });
}

export async function POST(request) {
  if (!validGatewayOrigin(request)) return rpcError(null, -32600, "Origin is not allowed", 403);
  const settings = await getSettings();
  if (settings.gatewayA2aEnabled !== true) return rpcError(null, -32601, "A2A is disabled", 404);
  const auth = await requireGatewayKey(request);
  if (auth.response) return auth.response;
  const rpc = await parseRpc(request);
  if (rpc.response) return rpc.response;

  const { id, method, params } = rpc.message;
  switch (method) {
    case "message/send":
    case "message/stream": {
      const input = readMessage(params, settings.gatewayA2aModel);
      if (input.code) return rpcError(id, input.code, input.message);
      const result = startA2aTask({
        ...input,
        owner: auth.owner,
        run: (signal) => callGatewayChat({ requestUrl: request.url, token: auth.token, ...input, signal }),
      });
      if (result.code) return rpcError(id, result.code, result.message);
      const { entry } = result;
      if (method === "message/stream") {
        after(() => entry.work);
        return streamTask(id, entry);
      }
      if (params.configuration?.blocking === false) {
        after(() => entry.work);
        return rpcResult(id, entry.task);
      }
      return rpcResult(id, await entry.done);
    }
    case "tasks/get":
    case "tasks/cancel":
    case "tasks/resubscribe": {
      if (typeof params?.id !== "string") return rpcError(id, -32602, "A task id is required");
      const entry = getA2aTask(params.id, auth.owner);
      if (!entry) return rpcError(id, -32001, "Task not found");
      if (method === "tasks/resubscribe") return streamTask(id, entry);
      if (method === "tasks/cancel" && !entry.cancel()) return rpcError(id, -32002, "Task cannot be canceled");
      return rpcResult(id, entry.task);
    }
    default:
      return rpcError(id, -32601, "Method not found");
  }
}
