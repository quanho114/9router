"use client";

import { translate } from "@/i18n/runtime";

/** Reusable endpoint row component */
export default function EndpointRow({ label, url, copyId, copied, onCopy, badge, actions }) {
  return (
    <div className="flex flex-col gap-2 xl:col-span-2">
      <span className="text-xs font-medium text-text-muted">{label}{badge ? ` · ${badge}` : ""}</span>
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 p-1.5 pl-4 focus-within:ring-2 focus-within:ring-primary/20">
      <input value={url} readOnly aria-label={translate("API Endpoint")} spellCheck={false}
        className="h-9 w-full min-w-0 flex-1 bg-transparent font-mono text-sm sm:text-[15px] text-text-main outline-none" />
      <button
        type="button"
        aria-label={translate(copied === copyId ? "Copied!" : "Copy")}
        title={translate(copied === copyId ? "Copied!" : "Copy")}
        onClick={() => onCopy(url, copyId)}
        className="flex size-9 items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 rounded-lg text-text-muted hover:text-primary transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-primary"
      >
        <span className="material-symbols-outlined text-[18px]">{copied === copyId ? "check" : "content_copy"}</span>
      </button>
      {actions}
      </div>
    </div>
  );
}
