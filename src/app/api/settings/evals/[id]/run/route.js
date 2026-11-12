import { getEvalSuite } from "@/lib/db/repos/evalSuitesRepo.js";
import { evalResponse, isEvalModel, readEvalPayload, runEvalSuite } from "@/lib/gateway/evals.js";
import { requireGatewayKey } from "@/lib/gateway/rpc.js";

export const maxDuration = 95;

export async function POST(request, { params }) {
  const auth = await requireGatewayKey(request);
  if (auth.response) return auth.response;
  const { id } = await params;
  const suite = await getEvalSuite(id);
  if (!suite) return evalResponse({ error: "Eval suite not found" }, 404);
  const payload = await readEvalPayload(request, { optional: true });
  if (payload.response) return payload.response;
  const model = payload.input.model ?? suite.model;
  if (!isEvalModel(model)) return evalResponse({ error: "Invalid eval model" }, 400);
  const run = await runEvalSuite({ suite, model: model.trim(), token: auth.token, request });
  return evalResponse({ run });
}
