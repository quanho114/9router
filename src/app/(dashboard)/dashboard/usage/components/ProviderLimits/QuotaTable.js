"use client";

import { useEffect, useMemo, useState } from "react";
import { formatResetTime, getRemainingPercentage } from "./utils";

const PAGE_SIZE = 10;

/**
 * Format reset time display (Today, 12:00 PM)
 */
function formatResetTimeDisplay(resetTime) {
  if (!resetTime) return null;

  try {
    const date = new Date(resetTime);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let dayStr = "";
    if (date >= today && date < tomorrow) {
      dayStr = "Today";
    } else if (date >= tomorrow && date < new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)) {
      dayStr = "Tomorrow";
    } else {
      dayStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }

    const timeStr = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    return `${dayStr}, ${timeStr}`;
  } catch {
    return null;
  }
}

/**
 * Get color classes based on remaining percentage
 */
function getColorClasses(remainingPercentage) {
  if (remainingPercentage > 70) {
    return {
      text: "text-text-primary",
      bg: "bg-emerald-600",
      bgLight: "bg-emerald-600/10",
    };
  }

  if (remainingPercentage >= 30) {
    return {
      text: "text-amber-700 dark:text-amber-400",
      bg: "bg-amber-500",
      bgLight: "bg-amber-500/10",
    };
  }

  return {
    text: "text-red-600 dark:text-red-400",
    bg: "bg-red-500",
    bgLight: "bg-red-500/10",
  };
}

function sortQuotas(quotas, sortMode) {
  if (sortMode === "remaining-asc") {
    return [...quotas].sort((a, b) => a.remaining - b.remaining || a.name.localeCompare(b.name));
  }

  if (sortMode === "remaining-desc") {
    return [...quotas].sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name));
  }

  return quotas;
}

/**
 * Quota Table Component - Table-based display for quota data
 */
export default function QuotaTable({
  quotas = [],
  compact = false,
  sortMode = "default",
  showSortLabel = false,
  onHideQuota = null,
}) {
  const [paginationState, setPaginationState] = useState({ page: 1, sortMode });
  // Countdown advances independently of slow or failed provider quota requests.
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setClockTick((tick) => tick + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const normalizedQuotas = useMemo(
    () => quotas.map((quota, index) => ({
      ...quota,
      index,
      remaining: getRemainingPercentage(quota),
    })),
    [quotas],
  );

  const sortedQuotas = useMemo(
    () => sortQuotas(normalizedQuotas, sortMode),
    [normalizedQuotas, sortMode],
  );

  const totalPages = Math.max(1, Math.ceil(sortedQuotas.length / PAGE_SIZE));

  const page = paginationState.sortMode === sortMode ? Math.min(paginationState.page, totalPages) : 1;
  const setPage = (update) => setPaginationState({ page: update(page), sortMode });

  if (!quotas || quotas.length === 0) {
    return null;
  }

  const currentPageRows = sortedQuotas.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );
  const pageStart = sortedQuotas.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(page * PAGE_SIZE, sortedQuotas.length);

  const cellPad = compact ? "py-1" : "py-2";
  const nameText = compact ? "text-[13px]" : "text-sm";
  const resetPrimary = "text-sm";
  const resetSecondary = "text-xs";
  const sortLabel = "Sorted by account remaining";
  const hasHideAction = typeof onHideQuota === "function";

  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-text-muted">
          {sortedQuotas.length} model limits
        </div>
        {showSortLabel && (
          <div className="rounded-md border border-black/10 bg-black/[0.02] px-2 py-1 text-xs text-text-muted dark:border-white/10 dark:bg-white/[0.03]">
            {sortLabel}
          </div>
        )}
      </div>

      <div className="space-y-px">
        {currentPageRows.map((quota) => {
          const isUnlimited = quota.unlimited === true;
          const isCreditBalance = quota.isCreditBalance === true;
          const colors = isCreditBalance
            ? { text: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500", bgLight: "bg-blue-500/10", }
            : getColorClasses(quota.colorPercentage ?? quota.remaining);
          // Qoder flags open-ended plans with `neverExpires` (its API reports a
          // year-9999 sentinel). Return "-"/"Never expires" rather than an empty
          // countdown: the render below branches on `countdown !== "-"`, so an
          // empty string would fall through to the "in " label.
          const countdown = quota.neverExpires ? "-" : formatResetTime(quota.resetAt);
          // Providers that expose a detail page but no per-bucket reset date
          // (Qoder add-on grants) get a pointer to it instead of a bare "N/A".
          const seeDetails = !quota.neverExpires && !quota.resetAt && Boolean(quota.detailUrl);
          const resetDisplay = quota.emptyMessage
            ? quota.emptyMessage
            : quota.neverExpires
            ? "Never expires"
            : seeDetails
              ? "See details"
              : formatResetTimeDisplay(quota.resetAt);
          const resetSecondaryText = seeDetails && quota.detailUrl ? quota.detailUrl : resetDisplay;
          // recurring defaults true: a missing flag means the quota
          // refreshes at resetAt. Bonus/one-shot packs set recurring:false
          // and their resetAt is a hard expiry, so word it as "expires".
          const recurring = quota.recurring !== false;
          const countdownLabel = recurring ? `Reset in ${countdown}` : `expires in ${countdown}`;

          // "See details" rows are a link to the provider's own usage page —
          // used where the API exposes no per-bucket date (Qoder add-on grants).
          const renderResetCell = (className) =>
            seeDetails ? (
              <a
                href={quota.detailUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`${className} inline-flex items-center gap-0.5 hover:text-text-primary hover:underline`}
                title={`Open usage details: ${resetSecondaryText}`}
                aria-label={`Open usage details for ${quota.name}`}
              >
                {resetDisplay}
                <span className="material-symbols-outlined text-[12px]">open_in_new</span>
              </a>
            ) : (
              resetDisplay
            );

          return (
            <div
              key={`${quota.name}-${quota.index}`}
              className={`group grid grid-cols-[minmax(0,1fr)_minmax(100px,1fr)_auto] sm:grid-cols-[minmax(0,1.4fr)_minmax(100px,1fr)_112px_24px] items-center gap-x-3 gap-y-1 border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors ${cellPad}`}
            >
              {/* Name */}
              <div className="flex min-w-0 items-center gap-1.5">
                <span className={`${nameText} font-medium text-text-primary leading-snug`} title={quota.name}>
                  {quota.name}
                </span>
              </div>

              {/* Progress + used/total */}
              <div className={`min-w-0 flex-1 ${compact ? "space-y-0.5" : "space-y-1.5"}`}>
                {!isUnlimited && !isCreditBalance && (
                <div className={`${compact ? "h-1" : "h-1.5"} rounded-full overflow-hidden border ${colors.bgLight} ${
                  quota.remaining === 0 ? "border-black/10 dark:border-white/10" : "border-transparent"
                }`}>
                  <div
                    className={`h-full ${colors.bg}`}
                    style={{ width: `${Math.min(quota.remaining, 100)}%` }}
                  />
                </div>
                )}

                <div className={`flex items-center justify-between gap-1 min-w-0 ${compact ? "text-xs" : "text-xs"}`}>
                  <span
                    className="text-text-muted truncate"
                    title={
                      isUnlimited
                        ? `${quota.used.toLocaleString()} used · Unlimited`
                        : isCreditBalance
                        ? `Credit balance: ${quota.total.toFixed(2)} ${quota.currency || ""}`
                        : `${quota.used.toLocaleString()} / ${quota.total > 0 ? quota.total.toLocaleString() : "∞"}`
                    }
                  >
                    {isUnlimited
                      ? `${quota.used.toLocaleString()} used · Unlimited`
                      : isCreditBalance
                      ? `Credit: ${quota.total.toFixed(2)} ${quota.currency || ""}`
                      : `${quota.used.toLocaleString()} / ${quota.total > 0 ? quota.total.toLocaleString() : "∞"}${
                          quota.unit ? ` ${quota.unit}` : ""
                        }`}
                  </span>
                  <span className={`font-medium ${isUnlimited ? "text-text-primary" : isCreditBalance ? "text-blue-600 dark:text-blue-400" : colors.text} shrink-0`}>
                    {isUnlimited ? "Unlimited" : isCreditBalance ? "" : `${quota.remaining}% left`}
                  </span>
                </div>
              </div>

              {/* Reset time */}
              <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-auto min-w-0 text-text-muted">
                {countdown !== "-" || resetDisplay ? (
                  compact ? (
                    <div
                      className={`${resetPrimary} text-text-muted text-xs leading-snug`}
                      title={resetSecondaryText || ""}
                    >
                      {countdown !== "-" ? countdownLabel : renderResetCell(resetPrimary)}
                    </div>
                  ) : (
                    <div className="min-w-0 space-y-0.5">
                      {countdown !== "-" && (
                        <div className={`${resetPrimary} text-text-primary font-medium truncate`}>
                          {countdownLabel}
                        </div>
                      )}
                      {resetDisplay && (
                        <div className={`${resetSecondary} text-text-muted truncate`}>
                          {renderResetCell(resetSecondary)}
                        </div>
                      )}
                    </div>
                  )
                ) : (
                  <div className={`${resetPrimary} text-text-muted italic`}>N/A</div>
                )}
              </div>

              {/* Hide action */}
              {hasHideAction && (
                <button
                  type="button"
                  onClick={() => onHideQuota(quota)}
                  className="inline-flex h-6 w-6 col-start-3 row-start-1 sm:col-start-auto sm:row-auto shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/5"
                  title="Hide this quota row"
                  aria-label={`Hide quota ${quota.name}`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A11 11 0 0 1 12 5c7 0 10 7 10 7a17 17 0 0 1-3 4M6.1 6.1A18 18 0 0 0 2 12s3 7 10 7a11 11 0 0 0 5-1.2" /></svg>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="rounded-md border border-black/10 bg-black/[0.02] px-2 py-1.5 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
            <span>
              Showing {pageStart}-{pageEnd} of {sortedQuotas.length}
            </span>
            <span>
              Page {page} / {totalPages}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
              disabled={page === 1}
              className="flex h-6 items-center rounded-md border border-black/10 px-2 text-xs text-text-primary transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
              disabled={page === totalPages}
              className="flex h-6 items-center rounded-md border border-black/10 px-2 text-xs text-text-primary transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
