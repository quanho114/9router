"use client";

import { useState } from "react";
import { Button, Card, Input, Toggle } from "@/shared/components";

export default function AgentProtocolsCard({ settings, onSaved }) {
  const [draft, setDraft] = useState(null);
  const saved = {
    gatewayMcpEnabled: settings.gatewayMcpEnabled === true,
    gatewayA2aEnabled: settings.gatewayA2aEnabled === true,
    gatewayA2aModel: settings.gatewayA2aModel || "",
  };
  const config = draft ?? saved;
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const change = (key, value) => setDraft((current) => ({ ...(current ?? saved), [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!response.ok) throw new Error("Could not save agent protocols.");
      const { gatewayMcpEnabled, gatewayA2aEnabled, gatewayA2aModel } = await response.json();
      onSaved({ gatewayMcpEnabled, gatewayA2aEnabled, gatewayA2aModel });
      setDraft(null);
      setMessage({ text: "Agent protocol settings saved." });
    } catch (error) {
      setMessage({ text: error.message, error: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <h3 className="mb-3 text-base font-semibold sm:text-lg">Agent protocols</h3>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-3">
          <Toggle className="flex-row-reverse justify-between" checked={config.gatewayMcpEnabled} onChange={(value) => change("gatewayMcpEnabled", value)}
            disabled={saving} label="MCP server" description="/v1/mcp · Streamable HTTP" />
          <Toggle className="flex-row-reverse justify-between border-t border-border/50 pt-3" checked={config.gatewayA2aEnabled} onChange={(value) => change("gatewayA2aEnabled", value)}
            disabled={saving} label="Agent-to-Agent (A2A)" description="/v1/a2a · /.well-known/agent-card.json" />
        </div>
        {config.gatewayA2aEnabled && (
          <Input
            label="Default A2A model or combo"
            aria-label="Default A2A model or combo"
            value={config.gatewayA2aModel}
            placeholder="provider/model or combo name"
            maxLength={200}
            onChange={(event) => change("gatewayA2aModel", event.target.value)}
            hint="Clients can override this with metadata.model. Every task uses the caller’s API key and model permissions."
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={saving}>Save</Button>
          {message && <p role="status" className={message.error ? "text-sm text-red-500" : "text-sm text-text-muted"}>{message.text}</p>}
        </div>
      </form>
    </Card>
  );
}
