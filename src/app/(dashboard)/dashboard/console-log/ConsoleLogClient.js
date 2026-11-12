"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";

const LOG_URL = "/api/translator/console-logs";
const LEVELS = {
  ERROR: "text-red-300",
  WARN: "text-amber-300",
  INFO: "text-zinc-400",
  DEBUG: "text-zinc-400",
  LOG: "text-zinc-400",
};

function parseLine(line) {
  const [, time, message] = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*([\s\S]*)$/) || ["", "", line];
  const tag = message.match(/\[(ERROR|WARN|INFO|DEBUG|LOG)\]/i)?.[1]?.toUpperCase();
  let level = tag || "LOG";
  if (!tag) {
    if (/^(?:✗|❌|error\b|\[browser\].*\bError\b)|^\S+\s+✗/i.test(message)) level = "ERROR";
    else if (/^(?:⚠|warn(?:ing)?\b)/i.test(message)) level = "WARN";
    else if (/^ℹ/.test(message)) level = "INFO";
    else if (/\[DBG:[^\]]+\]/.test(message)) level = "DEBUG";
  }
  return { line, time, message, level };
}

export default function ConsoleLogClient() {
  const [logs, setLogs] = useState([]);
  const [connection, setConnection] = useState("Connecting");
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("");
  const [follow, setFollow] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState("");
  const logRef = useRef(null);

  useEffect(() => {
    const source = new EventSource(`${LOG_URL}/stream`);
    source.onopen = () => setConnection("Live");
    source.onerror = () => setConnection("Reconnecting");
    source.onmessage = ({ data }) => {
      try {
        const event = JSON.parse(data);
        if (event.type === "clear") setLogs([]);
        else if (event.type === "init" && Array.isArray(event.logs)) {
          setLogs(event.logs.slice(-CONSOLE_LOG_CONFIG.maxLines));
        } else {
          const incoming = event.type === "line" ? [event.line] : event.type === "lines" ? event.lines : null;
          if (Array.isArray(incoming)) setLogs((previous) => [...previous, ...incoming].slice(-CONSOLE_LOG_CONFIG.maxLines));
        }
      } catch {
        // Ignore malformed frames and keep the stream open.
      }
    };
    return () => source.close();
  }, []);

  const visibleLogs = useMemo(() => {
    const search = query.trim().toLowerCase();
    return logs.filter((line) => typeof line === "string").map(parseLine)
      .filter((row) => (!level || row.level === level) && row.line.toLowerCase().includes(search));
  }, [logs, query, level]);

  useEffect(() => {
    if (follow && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [follow, visibleLogs]);

  async function clearLogs() {
    setClearing(true);
    setClearError("");
    try {
      const response = await fetch(LOG_URL, { method: "DELETE" });
      if (!response.ok) throw new Error("Clear failed");
    } catch {
      setClearError("Could not clear server logs. Try again.");
    } finally {
      setClearing(false);
    }
  }

  return (
    <section aria-label="Server console" className="mx-auto flex h-[calc(100dvh-15rem)] min-h-80 max-w-7xl flex-col overflow-hidden rounded-2xl border border-border bg-surface sm:h-[calc(100dvh-13rem)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-text-main" role="status">
          <span className={`size-2 rounded-full ${connection === "Live" ? "bg-emerald-500" : "bg-amber-500"}`} />
          {connection}
        </div>
        <span className="text-xs tabular-nums text-text-muted">{visibleLogs.length} of {logs.length} lines</span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="md" variant={follow ? "secondary" : "ghost"} aria-pressed={follow} onClick={() => setFollow(!follow)}>
            Follow
          </Button>
          <Button size="md" variant="outline" icon="delete" loading={clearing} disabled={!logs.length} onClick={clearLogs}>
            Clear
          </Button>
        </div>
        <div className="flex w-full flex-wrap gap-2 lg:order-first lg:w-auto">
          <input type="search" aria-label="Search logs" placeholder="Search logs" value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-9 min-w-28 flex-1 rounded-lg border border-border bg-surface-2 px-3 text-sm text-text-main lg:w-56" />
          <select aria-label="Log level" value={level} onChange={(event) => setLevel(event.target.value)}
            className="h-9 rounded-lg border border-border bg-surface-2 px-2 text-sm text-text-main">
            <option value="">All levels</option>
            {Object.keys(LEVELS).map((value) => <option key={value}>{value}</option>)}
          </select>
        </div>
      </div>
      {clearError && <p role="alert" className="px-4 py-2 text-sm text-red-600 dark:text-red-300">{clearError}</p>}
      <div ref={logRef} tabIndex={0} aria-label="Log output"
        className="min-h-0 flex-1 overflow-y-auto bg-zinc-950 text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-400">
        <div className="sticky top-0 z-10 hidden grid-cols-[5.5rem_4rem_minmax(0,1fr)] gap-3 border-b border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-400 sm:grid">
          <span>Time</span><span>Level</span><span>Message</span>
        </div>
        {visibleLogs.length ? (
          <ol className="divide-y divide-zinc-800/70 font-mono text-[13px] leading-relaxed">
            {visibleLogs.map(({ time, level, message }, index) => (
              <li key={index} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-4 py-2 sm:grid-cols-[5.5rem_4rem_minmax(0,1fr)]">
                <span className="tabular-nums text-zinc-400">{time || "—"}</span>
                <span className={LEVELS[level]}>{level}</span>
                <span className="col-span-2 min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] sm:col-span-1">{message}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="p-6 text-sm text-zinc-400">{logs.length ? "No logs match your filters." : "No console logs yet."}</p>
        )}
      </div>
    </section>
  );
}
