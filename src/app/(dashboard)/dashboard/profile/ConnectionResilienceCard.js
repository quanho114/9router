"use client";

import { useState } from "react";
import { Button, Card, Input, Toggle } from "@/shared/components";
import { resolveResilienceConfig, RESILIENCE_LIMITS } from "@/shared/constants/resilience.js";

const FIELDS = {
  maxConcurrent: "Concurrent requests per connection",
  queueTimeoutMs: "Maximum queue wait (ms)",
  failureThreshold: "Consecutive upstream failures",
  cooldownMs: "Circuit breaker cooldown (ms)",
};

export default function ConnectionResilienceCard({ settings, onSaved }) {
  const [draft, setDraft] = useState(null);
  const config = draft ?? resolveResilienceConfig(settings);
  const [snapshot, setSnapshot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const change = (key, value) => setDraft((current) => ({
    ...(current ?? resolveResilienceConfig(settings)), [key]: value,
  }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionResilience: config }),
      });
      if (!response.ok) throw new Error("Could not save connection settings.");
      onSaved({ connectionResilience: (await response.json()).connectionResilience });
      setDraft(null);
      setSnapshot(null);
      setMessage({ text: "Connection settings saved." });
    } catch (error) {
      setMessage({ text: error.message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/resilience");
      if (!response.ok) throw new Error("Could not load connection status.");
      setSnapshot(await response.json());
    } catch (error) {
      setMessage({ text: error.message, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h3 className="mb-3 text-base font-semibold sm:text-lg">Connection resilience</h3>
      <form onSubmit={submit} className="space-y-4">
        <Toggle
          className="flex-row-reverse justify-between"
          checked={config.enabled}
          onChange={(enabled) => change("enabled", enabled)}
          label="Enable connection limits"
          description="Limit concurrent chat requests and pause connections after repeated failures."
          disabled={busy}
        />
        {config.enabled && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Object.entries(FIELDS).map(([key, label]) => (
              <Input
                key={key}
                label={label}
                aria-label={label}
                type="number"
                min={RESILIENCE_LIMITS[key][0]}
                max={RESILIENCE_LIMITS[key][1]}
                step={1}
                required
                value={config[key]}
                onChange={(event) => {
                  const value = event.target.value === "" ? "" : Number(event.target.value);
                  change(key, value);
                }}
              />
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={busy}>Save</Button>
          <Button type="button" size="sm" variant="secondary" onClick={refresh} disabled={busy}>
            Refresh connection status
          </Button>
          {message && <p role="status" className={message.error ? "text-sm text-red-500" : "text-sm text-text-muted"}>{message.text}</p>}
        </div>
      </form>
      {snapshot && (
        <div className="mt-4 border-t border-border pt-3" aria-live="polite">
          {snapshot.breakers.length === 0 && snapshot.cooldowns.length === 0 ? (
            <p className="text-sm text-text-muted">No recent connection activity or active cooldowns.</p>
          ) : (
            <ul className="max-h-64 divide-y divide-border overflow-auto text-sm">
              {snapshot.breakers.map((row) => (
                <li key={`breaker:${row.provider}:${row.connectionId}`} className="flex flex-wrap justify-between gap-x-3 gap-y-1 py-2">
                  <span className="break-all">{row.provider} · {row.name}</span>
                  <span className="text-text-muted">
                    {row.state} · {row.active} active · {row.queued} queued
                    {row.retryAt && ` · retries at ${new Date(row.retryAt).toLocaleTimeString()}`}
                  </span>
                </li>
              ))}
              {snapshot.cooldowns.map((row) => (
                <li key={`cooldown:${row.connectionId}:${row.model}`} className="flex flex-wrap justify-between gap-x-3 gap-y-1 py-2">
                  <span className="break-all">{row.provider} · {row.name} · {row.model === "__all" ? "All models" : row.model}</span>
                  <span className="text-text-muted">Cooldown until {new Date(row.retryAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
