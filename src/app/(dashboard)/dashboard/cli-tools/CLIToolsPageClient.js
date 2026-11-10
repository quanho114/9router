"use client";

import { useState, useEffect } from "react";
import { CLI_TOOLS, MITM_TOOLS } from "@/shared/constants/cliTools";
import { getInitialCache, readCache, runWithCache, writeCache } from "@/shared/utils/dashboardCache";
import { MitmLinkCard } from "./components";
import ToolSummaryCard from "./components/ToolSummaryCard";

const ALL_STATUSES_URL = "/api/cli-tools/all-statuses";

export default function CLIToolsPageClient({ machineId }) {
  const [toolStatuses, setToolStatuses] = useState(() =>
    getInitialCache("cliToolStatuses", {})
  );

  useEffect(() => {
    let mounted = true;
    runWithCache(() => {
      const cached = readCache("cliToolStatuses", null);
      if (cached && mounted) setToolStatuses(cached);
    });
    (async () => {
      try {
        const res = await fetch(ALL_STATUSES_URL);
        if (res.ok && mounted) {
          const data = await res.json();
          writeCache("cliToolStatuses", data);
          setToolStatuses(data);
        }
      } catch (error) {
        console.log("Error fetching tool statuses:", error);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const regularTools = Object.entries(CLI_TOOLS);
  const mitmTools = Object.entries(MITM_TOOLS);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-1 sm:px-0">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {regularTools.map(([toolId, tool]) => (
          <ToolSummaryCard key={toolId} toolId={toolId} tool={tool} status={toolStatuses[toolId]} />
        ))}
      </div>
      <div className="flex flex-col gap-3 sm:gap-4">
        <div className="flex items-center gap-2 px-1">
          <span className="material-symbols-outlined text-[18px] text-primary">security</span>
          <h2 className="text-sm font-semibold text-text-main">MITM Tools</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {mitmTools.map(([toolId, tool]) => (
            <MitmLinkCard key={toolId} tool={tool} />
          ))}
        </div>
      </div>
    </div>
  );
}
