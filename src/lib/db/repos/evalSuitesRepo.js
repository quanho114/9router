import { randomUUID } from "node:crypto";
import { getAdapter } from "../driver.js";
import { makeKv } from "../helpers/kvStore.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const SCOPE = "evalSuites";
const suites = makeKv(SCOPE);

export const getEvalSuite = (id) => suites.get(id);
export const deleteEvalSuite = (id) => suites.remove(id);

export async function listEvalSuites() {
  const all = Object.values(await suites.getAll());
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(({ id, name, model, cases, updatedAt }) => ({ id, name, model, cases: cases.length, updatedAt }));
}

export async function createEvalSuite(input) {
  const now = new Date().toISOString();
  const suite = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
  await suites.set(suite.id, suite);
  return suite;
}

export async function updateEvalSuite(id, input) {
  const db = await getAdapter();
  let updated = null;
  db.transaction(() => {
    const current = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, id]);
    if (!current) return;
    updated = { ...parseJson(current.value, {}), ...input, updatedAt: new Date().toISOString() };
    db.run(`UPDATE kv SET value = ? WHERE scope = ? AND key = ?`, [stringifyJson(updated), SCOPE, id]);
  });
  return updated;
}
