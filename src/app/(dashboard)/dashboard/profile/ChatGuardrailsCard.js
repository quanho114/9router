"use client";

import { useState } from "react";
import { Button, Card, Toggle } from "@/shared/components";
import { normalizeGuardrails } from "@/shared/constants/guardrails.js";

const FIELDS = {
  maskPii: ["Mask personal data", "Redact matching email addresses, phone numbers and payment card numbers."],
  maskSecrets: ["Mask credentials", "Redact common API keys, bearer tokens and private keys in chat text."],
  blockPromptInjection: ["Block prompt injection patterns", "Reject matching instructions in user messages and tool results."],
};

export default function ChatGuardrailsCard({ settings, onSaved }) {
  const [draft, setDraft] = useState(null);
  const policy = draft ?? normalizeGuardrails(settings);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const send = async (test) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(test ? "/api/settings/guardrails/test" : "/api/settings", {
        method: test ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(test ? { policy, text } : { chatGuardrails: policy }),
      });
      if (!response.ok) throw new Error(test ? "Could not run guardrail preview." : "Could not save guardrails.");
      if (test) setPreview(await response.json());
      else {
        onSaved({ chatGuardrails: (await response.json()).chatGuardrails });
        setDraft(null);
        setMessage({ text: "Guardrails saved." });
      }
    } catch (error) {
      setMessage({ text: error.message, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h3 className="mb-3 text-base font-semibold sm:text-lg">Chat guardrails</h3>
      <div className="space-y-3">
        {Object.entries(FIELDS).map(([key, [label, description]]) => (
          <Toggle key={key} className="flex-row-reverse justify-between border-t border-border/50 pt-3 first:border-0 first:pt-0"
            label={label} description={description} checked={policy[key]} disabled={busy}
            onChange={(value) => {
              setDraft((current) => ({ ...(current ?? normalizeGuardrails(settings)), [key]: value }));
              setPreview(null);
            }} />
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={() => send(false)} disabled={busy}>Save</Button>
          {message && <p role="status" className={message.error ? "text-sm text-red-500" : "text-sm text-text-muted"}>{message.text}</p>}
        </div>
      </div>
      <details className="mt-4 border-t border-border pt-3">
        <summary className="cursor-pointer text-sm font-medium">Preview the current rules</summary>
        <div className="mt-3 space-y-2">
          <textarea aria-label="Guardrail test text" className="w-full rounded-lg border border-border bg-surface-2 p-2 text-sm"
            rows={3} maxLength={16000} placeholder="Enter sample text" value={text}
            onChange={(event) => { setText(event.target.value); setPreview(null); }} />
          <Button type="button" size="sm" variant="secondary" onClick={() => send(true)} disabled={busy || !text.trim()}>
            Test guardrails
          </Button>
          {preview && (
            <div className="space-y-1 text-sm">
              <p role="status" className={preview.blocked ? "text-red-500" : "text-text-muted"}>
                {preview.blocked ? "Blocked" : "Allowed"} · {preview.redactions} redactions
              </p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border p-2 text-xs">{preview.text}</pre>
            </div>
          )}
        </div>
      </details>
    </Card>
  );
}
