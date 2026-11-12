"use client";

import PropTypes from "prop-types";

export function formatTokenCompact(n) {
  const num = Number(n) || 0;
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(num % 1_000_000_000 === 0 ? 0 : 2)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(num % 1_000_000 === 0 ? 0 : 2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(num % 1_000 === 0 ? 0 : 1)}K`;
  return num.toLocaleString("en-US");
}

export default function TokenQuotaRing({
  label,
  used = 0,
  max = 0,
  accent = "cyan",
  size = 54,
}) {
  const safeUsed = Math.max(0, Number(used) || 0);
  const safeMax = Math.max(0, Number(max) || 0);
  const hasLimit = safeMax > 0;
  const rawPct = hasLimit ? (safeUsed / safeMax) * 100 : 0;
  const clampedPct = hasLimit ? Math.min(100, Math.max(0, rawPct)) : 0;
  const isExhausted = hasLimit && safeUsed >= safeMax;
  const isWarning = hasLimit && !isExhausted && clampedPct >= 80;

  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (clampedPct / 100) * circumference;

  let strokeColor = accent === "violet" ? "#8b5cf6" : "#06b6d4";
  if (isExhausted) strokeColor = "#ef4444";
  else if (isWarning) strokeColor = "#f59e0b";

  const remaining = hasLimit ? Math.max(0, safeMax - safeUsed) : null;

  return (
    <div
      className="flex items-center gap-2.5 rounded-xl border border-black/[0.06] dark:border-white/[0.07] bg-black/[0.015] dark:bg-white/[0.02] px-3 py-2 min-w-[170px]"
      title={
        hasLimit
          ? `${label}: ${safeUsed.toLocaleString("en-US")} / ${safeMax.toLocaleString("en-US")} tokens (${rawPct.toFixed(1)}% used, ${remaining.toLocaleString("en-US")} remaining)`
          : `${label}: ${safeUsed.toLocaleString("en-US")} tokens used (No limit)`
      }
    >
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-black/[0.08] dark:text-white/[0.1]"
          />
          {hasLimit && clampedPct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.35s ease, stroke 0.25s ease" }}
          />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          {hasLimit ? (
            <span
              className={`font-mono text-[11px] font-semibold leading-none ${
                isExhausted
                  ? "text-red-500"
                  : isWarning
                  ? "text-amber-500"
                  : "text-text-main"
              }`}
            >
              {Math.round(clampedPct)}%
            </span>
          ) : (
            <span className="font-mono text-sm font-semibold leading-none text-text-muted">
              ∞
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
            {label}
          </span>
          {isExhausted && (
            <span className="rounded bg-red-500/15 px-1 py-0.2 text-[9px] font-semibold uppercase text-red-500">
              Full
            </span>
          )}
        </div>
        <div className="font-mono text-xs font-semibold text-text-main truncate">
          {formatTokenCompact(safeUsed)}
          <span className="font-normal text-text-muted">
            {" / "}
            {hasLimit ? formatTokenCompact(safeMax) : "∞"}
          </span>
        </div>
        <div className="text-[10px] text-text-muted truncate">
          {hasLimit
            ? isExhausted
              ? "Hết hạn mức"
              : `Còn ${formatTokenCompact(remaining)}`
            : "Không giới hạn"}
        </div>
      </div>
    </div>
  );
}

TokenQuotaRing.propTypes = {
  label: PropTypes.string.isRequired,
  used: PropTypes.number,
  max: PropTypes.number,
  accent: PropTypes.oneOf(["cyan", "violet"]),
  size: PropTypes.number,
};
