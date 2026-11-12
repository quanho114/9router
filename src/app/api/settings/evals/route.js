import { createEvalSuite, listEvalSuites } from "@/lib/db/repos/evalSuitesRepo.js";
import { evalResponse, readEvalPayload, validateEvalSuite } from "@/lib/gateway/evals.js";

export const dynamic = "force-dynamic";

export async function GET() {
  return evalResponse({ suites: await listEvalSuites() });
}

export async function POST(request) {
  const payload = await readEvalPayload(request);
  if (payload.response) return payload.response;
  const { suite, error } = validateEvalSuite(payload.input);
  if (error) return evalResponse({ error }, 400);
  return evalResponse({ suite: await createEvalSuite(suite) }, 201);
}
