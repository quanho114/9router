import { deleteEvalSuite, getEvalSuite, updateEvalSuite } from "@/lib/db/repos/evalSuitesRepo.js";
import { evalResponse, readEvalPayload, validateEvalSuite } from "@/lib/gateway/evals.js";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { id } = await params;
  const suite = await getEvalSuite(id);
  return suite ? evalResponse({ suite }) : evalResponse({ error: "Eval suite not found" }, 404);
}

export async function PUT(request, { params }) {
  const { id } = await params;
  const payload = await readEvalPayload(request);
  if (payload.response) return payload.response;
  const { suite, error } = validateEvalSuite(payload.input);
  if (error) return evalResponse({ error }, 400);
  const updated = await updateEvalSuite(id, suite);
  return updated ? evalResponse({ suite: updated }) : evalResponse({ error: "Eval suite not found" }, 404);
}

export async function DELETE(_request, { params }) {
  const { id } = await params;
  await deleteEvalSuite(id);
  return new Response(null, { status: 204 });
}
