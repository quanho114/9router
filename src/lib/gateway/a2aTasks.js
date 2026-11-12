import { createHash, randomUUID } from "node:crypto";

const TASK_TTL_MS = 15 * 60_000;
const TASK_TIMEOUT_MS = 120_000;
const TASK_CAPACITY = 128;
const ACTIVE_PER_KEY = 4;
const tasks = globalThis[Symbol.for("9router.a2aTasks")] ??= new Map();

function pruneTasks() {
  const now = Date.now();
  for (const [id, entry] of tasks) {
    if (!entry.running && entry.expiresAt <= now) tasks.delete(id);
  }
}

export function getA2aTask(id, owner) {
  pruneTasks();
  const entry = tasks.get(id);
  return entry?.owner === owner ? entry : null;
}

function status(state, contextId, taskId, text) {
  const result = { state, timestamp: new Date().toISOString() };
  if (text) result.message = {
    kind: "message", role: "agent", messageId: randomUUID(), contextId, taskId, parts: [{ kind: "text", text }],
  };
  return result;
}

export function startA2aTask({ owner, messageId, model, prompt, run }) {
  pruneTasks();
  const signature = createHash("sha256").update(JSON.stringify([model, prompt])).digest("hex");
  let active = 0;
  for (const entry of tasks.values()) {
    if (entry.owner !== owner) continue;
    if (entry.messageId === messageId) {
      return entry.signature === signature ? { entry } : { code: -32602, message: "messageId is already in use" };
    }
    if (entry.running) active++;
  }
  if (active >= ACTIVE_PER_KEY) return { code: -32000, message: "Too many active tasks for this API key" };
  if (tasks.size >= TASK_CAPACITY) {
    const settled = [...tasks.values()].find((entry) => !entry.running);
    if (!settled) return { code: -32000, message: "The task queue is full" };
    tasks.delete(settled.task.id);
  }

  const id = randomUUID();
  const contextId = randomUUID();
  const controller = new AbortController();
  let resolve;
  const done = new Promise((finish) => { resolve = finish; });
  const entry = {
    task: { kind: "task", id, contextId, status: status("submitted", contextId, id) },
    owner, messageId, signature, running: true, expiresAt: Infinity, done, cancel,
  };
  tasks.set(id, entry);
  let terminal = false;
  const timer = setTimeout(() => {
    controller.abort();
    finish("failed", "The gateway task timed out.");
  }, TASK_TIMEOUT_MS);
  timer.unref?.();

  function finish(state, text, artifacts) {
    if (terminal) return;
    terminal = true;
    clearTimeout(timer);
    entry.expiresAt = Date.now() + TASK_TTL_MS;
    entry.task = { ...entry.task, status: status(state, contextId, id, text), ...(artifacts ? { artifacts } : {}) };
    resolve(entry.task);
  }

  function cancel() {
    if (terminal) return false;
    controller.abort();
    finish("canceled");
    return true;
  }

  entry.work = Promise.resolve().then(async () => {
    if (terminal) return;
    entry.task = { ...entry.task, status: status("working", contextId, id) };
    try {
      const result = await run(controller.signal);
      if (result.status === 200) {
        finish("completed", null, [{ artifactId: randomUUID(), name: "Answer", parts: [{ kind: "text", text: result.text }] }]);
      } else {
        finish("failed", `Gateway returned HTTP ${result.status}`);
      }
    } catch {
      finish("failed", "The gateway task failed.");
    }
  }).finally(() => { entry.running = false; });
  return { entry };
}
