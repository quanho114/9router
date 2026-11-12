"use client";

import { useState } from "react";
import { Button, Card, Input, Select } from "@/shared/components";

const SUITES_URL = "/api/settings/evals";
const EXPECTATIONS = [
  { value: "contains", label: "Answer contains" },
  { value: "equals", label: "Answer equals" },
  { value: "status", label: "HTTP status is" },
];
const newCase = () => ({ name: "", prompt: "", expect: { type: "contains", value: "" } });
const newSuite = () => ({ name: "", model: "", cases: [newCase()] });

async function getJson(url, options) {
  const response = await fetch(url, options);
  if (response.status === 204) return {};
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The request failed.");
  return data;
}

export default function EvalSuitesCard() {
  const [open, setOpen] = useState(false);
  const [suites, setSuites] = useState([]);
  const [draft, setDraft] = useState(newSuite);
  const [apiKey, setApiKey] = useState("");
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const currentUrl = draft.id ? `${SUITES_URL}/${encodeURIComponent(draft.id)}` : SUITES_URL;

  const perform = async (action) => {
    setMessage(null);
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setMessage({ text: error.message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => setSuites((await getJson(SUITES_URL)).suites);
  const changeSuite = (id) => perform(async () => {
    setRun(null);
    setDraft(id ? (await getJson(`${SUITES_URL}/${encodeURIComponent(id)}`)).suite : newSuite());
  });
  const updateCase = (index, patch) => setDraft((current) => ({
    ...current, cases: current.cases.map((item, i) => i === index ? { ...item, ...patch } : item),
  }));

  const save = (event) => {
    event.preventDefault();
    return perform(async () => {
      const cases = draft.cases.map((item) => ({
        ...item,
        expect: { ...item.expect, value: item.expect.type === "status" ? Number(item.expect.value) : item.expect.value },
      }));
      const { suite } = await getJson(currentUrl, {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name, model: draft.model, cases }),
      });
      setDraft(suite);
      setRun(null);
      await refresh();
      setMessage({ text: "Suite saved." });
    });
  };

  const remove = () => {
    if (!window.confirm(`Delete eval suite "${draft.name}"?`)) return;
    return perform(async () => {
      await getJson(currentUrl, { method: "DELETE" });
      setDraft(newSuite());
      setRun(null);
      await refresh();
    });
  };

  const runSuite = () => perform(async () => {
    setRun(null);
    const data = await getJson(`${currentUrl}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey.trim()}` },
      body: "{}",
    });
    setRun(data.run);
  });

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold sm:text-lg">Eval suites</h3>
        <Button type="button" size="sm" variant="secondary" onClick={() => {
          if (open) { setOpen(false); setApiKey(""); } else { setOpen(true); perform(refresh); }
        }}>{open ? "Close" : "Manage suites"}</Button>
      </div>
      {open && (
        <div className="mt-4 space-y-4">
          <Select label="Saved suites" aria-label="Saved suites" value={draft.id || "new"} disabled={busy}
            options={[{ value: "new", label: "New suite" }, ...suites.map((suite) => ({ value: suite.id, label: `${suite.name} · ${suite.cases} cases` }))]}
            onChange={(event) => changeSuite(event.target.value === "new" ? null : event.target.value)} />
          <form onSubmit={save} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="Suite name" aria-label="Suite name" value={draft.name} maxLength={120} required
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
              <Input label="Model or combo" aria-label="Eval model or combo" value={draft.model} maxLength={200} required
                onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))} />
            </div>
            {draft.cases.map((item, index) => (
              <fieldset key={index} className="space-y-2 border-t border-border pt-2">
                <legend className="pr-2 text-sm font-medium">Case {index + 1}</legend>
                <Input aria-label={`Case ${index + 1} name`} value={item.name} required maxLength={120}
                  placeholder="Case name" onChange={(event) => updateCase(index, { name: event.target.value })} />
                <textarea aria-label={`Case ${index + 1} prompt`} value={item.prompt} rows={2} required maxLength={16000}
                  className="w-full rounded-lg border border-border bg-surface-2 p-2 text-sm"
                  placeholder="Prompt" onChange={(event) => updateCase(index, { prompt: event.target.value })} />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Select aria-label={`Case ${index + 1} expectation`} value={item.expect.type} options={EXPECTATIONS}
                    onChange={(event) => updateCase(index, { expect: { type: event.target.value, value: "" } })} />
                  <Input aria-label={`Case ${index + 1} expected value`} value={item.expect.value} required
                    type={item.expect.type === "status" ? "number" : "text"} min={100} max={599} maxLength={8000}
                    placeholder={item.expect.type === "status" ? "e.g. 200" : "Expected text"}
                    onChange={(event) => updateCase(index, { expect: { ...item.expect, value: event.target.value } })} />
                </div>
                {draft.cases.length > 1 && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setDraft((current) => ({
                    ...current, cases: current.cases.filter((_, i) => i !== index),
                  }))}>Remove case</Button>
                )}
              </fieldset>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={busy}>Save suite</Button>
              <Button type="button" size="sm" variant="secondary" disabled={busy || draft.cases.length >= 16}
                onClick={() => setDraft((current) => ({ ...current, cases: [...current.cases, newCase()] }))}>Add case</Button>
              {draft.id && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={remove}>Delete suite</Button>}
            </div>
          </form>
          {draft.id && (
            <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <Input label="API key for this run" aria-label="Eval API key" className="min-w-48 flex-1"
                value={apiKey} type="password" autoComplete="off" onChange={(event) => setApiKey(event.target.value)} />
              <Button type="button" variant="secondary" onClick={runSuite} disabled={busy || !apiKey.trim()}>Run saved suite</Button>
            </div>
          )}
          {busy && <p role="status" className="text-sm text-text-muted">Working…</p>}
          {message && <p role="status" className={message.error ? "text-sm text-red-500" : "text-sm text-text-muted"}>{message.text}</p>}
          {run && (
            <div className="space-y-2" aria-live="polite">
              <p className="text-sm font-medium">{run.passed} passed · {run.failed} failed · {run.skipped} skipped</p>
              <ul className="divide-y divide-border text-sm">
                {run.results.map((item, index) => (
                  <li key={index} className="py-2">
                    <div className="flex flex-wrap justify-between gap-1">
                      <span>{item.name}</span>
                      <span className={item.passed === false ? "text-red-500" : "text-text-muted"}>
                        {item.passed === null ? "Skipped" : `${item.passed ? "Pass" : "Fail"} · HTTP ${item.status} · ${item.durationMs} ms`}
                      </span>
                    </div>
                    {item.output && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-text-muted">{item.output}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
