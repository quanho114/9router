"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import PropTypes from "prop-types";
import { cn } from "@/shared/utils/cn";
import {
  formatCompactTokens,
  formatRelativeTime,
  normalizeLiveCallsPayload,
} from "@/shared/utils/liveCalls";
import ProviderIcon from "./ProviderIcon";

const EMPTY_STATE = {
  activeCalls: [],
  totalActive: 0,
  recentCalls: [],
  errorProvider: "",
};

// Shared singleton EventSource across mounted desktop/mobile Sidebars
const sseState = {
  es: null,
  listeners: new Set(),
  snapshot: EMPTY_STATE,
  connected: false,
};

function notifyListeners() {
  for (const listener of sseState.listeners) {
    listener(sseState.snapshot, sseState.connected);
  }
}

function subscribeLiveCalls(listener) {
  sseState.listeners.add(listener);
  listener(sseState.snapshot, sseState.connected);

  if (!sseState.es && typeof EventSource !== "undefined") {
    const es = new EventSource("/api/usage/stream?live=1");
    sseState.es = es;

    es.onopen = () => {
      sseState.connected = true;
      notifyListeners();
    };

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        sseState.snapshot = normalizeLiveCallsPayload(parsed, 6);
        sseState.connected = true;
        notifyListeners();
      } catch {
        // Ignore malformed SSE frames
      }
    };

    es.onerror = () => {
      sseState.connected = false;
      notifyListeners();
    };
  }

  return () => {
    sseState.listeners.delete(listener);
    if (sseState.listeners.size === 0 && sseState.es) {
      sseState.es.close();
      sseState.es = null;
      sseState.connected = false;
    }
  };
}

const POPOVER_WIDTH = 340;
const HOVER_CLOSE_DELAY_MS = 180;

function computePopoverStyle(rect) {
  if (!rect || typeof window === "undefined") return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxHeight = Math.min(440, vh - 24);

  if (vw < 640) {
    const width = Math.min(POPOVER_WIDTH, vw - 24);
    const left = Math.max(12, Math.min(rect.left, vw - width - 12));
    const top = Math.min(rect.bottom + 8, vh - maxHeight - 12);
    return { position: "fixed", top: Math.max(12, top), left, width, maxHeight };
  }

  const left = Math.min(rect.right + 12, vw - POPOVER_WIDTH - 12);
  const top = Math.max(12, Math.min(rect.top - 8, vh - maxHeight - 12));
  return { position: "fixed", top, left, width: POPOVER_WIDTH, maxHeight };
}

function isErrorStatus(status) {
  if (!status) return false;
  const s = String(status).toLowerCase();
  return s !== "ok" && s !== "success" && s !== "200";
}

function ActiveCallRow({ call }) {
  const subtitle = [call.provider, call.account].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 bg-emerald-500/[0.07] dark:bg-emerald-500/[0.11] border border-emerald-500/20">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/70 dark:bg-white/10">
        <ProviderIcon
          providerId={call.provider}
          alt={call.provider}
          size={18}
          fallbackText={call.provider.slice(0, 2).toUpperCase()}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-semibold text-text-main leading-tight">
          {call.model}
        </p>
        <p className="truncate text-[11px] text-text-muted mt-0.5">
          {subtitle || "routing"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-300">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
          <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
        </span>
        <span>{call.count > 1 ? `x${call.count}` : "Live"}</span>
      </div>
    </div>
  );
}

ActiveCallRow.propTypes = {
  call: PropTypes.shape({
    model: PropTypes.string.isRequired,
    provider: PropTypes.string.isRequired,
    account: PropTypes.string,
    count: PropTypes.number.isRequired,
  }).isRequired,
};

function RecentCallRow({ call, nowMs }) {
  const errored = isErrorStatus(call.status);
  const relTime = formatRelativeTime(call.timestamp, nowMs);
  const hasTokens = call.promptTokens > 0 || call.completionTokens > 0;
  return (
    <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-colors">
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          errored ? "bg-red-500" : "bg-emerald-500/80"
        )}
        title={errored ? `Status: ${call.status}` : "Success"}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[12px] font-medium text-text-main">
            {call.model}
          </p>
          {relTime && (
            <span className="shrink-0 text-[10.5px] text-text-muted tabular-nums">
              {relTime}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 text-[10.5px] text-text-muted">
          <span className="truncate">{call.provider}</span>
          {hasTokens && (
            <span className="shrink-0 tabular-nums font-mono">
              {formatCompactTokens(call.promptTokens)} → {formatCompactTokens(call.completionTokens)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

RecentCallRow.propTypes = {
  call: PropTypes.shape({
    timestamp: PropTypes.string,
    model: PropTypes.string.isRequired,
    provider: PropTypes.string.isRequired,
    promptTokens: PropTypes.number,
    completionTokens: PropTypes.number,
    status: PropTypes.string,
  }).isRequired,
  nowMs: PropTypes.number.isRequired,
};

export default function LiveCallsBell({ compact = false, onNavigate, onCloseSidebar }) {
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);
  const closeTimerRef = useRef(null);

  const [snapshot, setSnapshot] = useState(EMPTY_STATE);
  const [connected, setConnected] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const isOpen = hoverOpen || pinned;

  useEffect(() => {
    return subscribeLiveCalls((nextSnapshot, isConnected) => {
      setSnapshot(nextSnapshot);
      setConnected(isConnected);
    });
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const updatePosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPopoverStyle(computePopoverStyle(rect));
  }, []);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setHoverOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  const handleOpenHover = useCallback(() => {
    clearCloseTimer();
    updatePosition();
    setNowMs(Date.now());
    setHoverOpen(true);
  }, [clearCloseTimer, updatePosition]);

  const handleTogglePin = useCallback(() => {
    clearCloseTimer();
    updatePosition();
    setNowMs(Date.now());
    setPinned((prev) => {
      const next = !prev;
      if (!next) setHoverOpen(false);
      return next;
    });
  }, [clearCloseTimer, updatePosition]);

  const closeAll = useCallback(() => {
    clearCloseTimer();
    setPinned(false);
    setHoverOpen(false);
  }, [clearCloseTimer]);

  useEffect(() => {
    return () => clearCloseTimer();
  }, [clearCloseTimer]);

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    const onResizeOrScroll = () => updatePosition();
    const onKeyDown = (e) => {
      if (e.key === "Escape") closeAll();
    };
    const onPointerDown = (e) => {
      const target = e.target;
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      closeAll();
    };

    window.addEventListener("resize", onResizeOrScroll);
    window.addEventListener("scroll", onResizeOrScroll, true);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      clearInterval(tick);
      window.removeEventListener("resize", onResizeOrScroll);
      window.removeEventListener("scroll", onResizeOrScroll, true);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [isOpen, updatePosition, closeAll]);

  const { activeCalls, totalActive, recentCalls, errorProvider } = snapshot;
  const hasActive = totalActive > 0;

  const handleQuickLink = (e, href) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    closeAll();
    onNavigate?.(href);
    onCloseSidebar?.();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onMouseEnter={handleOpenHover}
        onMouseLeave={scheduleClose}
        onFocus={handleOpenHover}
        onBlur={scheduleClose}
        onClick={handleTogglePin}
        aria-label={hasActive ? `Live model calls (${totalActive} active)` : "Live model calls monitor"}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className={cn(
          "relative inline-flex shrink-0 items-center justify-center rounded-xl transition-all duration-150",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          compact ? "size-9" : "size-8",
          hasActive
            ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
            : isOpen
              ? "bg-black/8 dark:bg-white/12 text-text-main"
              : "text-text-main/65 hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-main"
        )}
      >
        <span
          className={cn(
            "material-symbols-outlined transition-transform duration-150",
            compact ? "text-[20px]" : "text-[19px]",
            hasActive && "fill-1"
          )}
          aria-hidden="true"
        >
          {hasActive ? "notifications_active" : "notifications"}
        </span>

        {hasActive ? (
          <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-emerald-500 text-white text-[9.5px] font-bold leading-none shadow-sm tabular-nums">
            <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-45" />
            <span className="relative">{totalActive > 99 ? "99+" : totalActive}</span>
          </span>
        ) : errorProvider ? (
          <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-red-500 ring-2 ring-white/80 dark:ring-black/80" />
        ) : null}
      </button>

      {isOpen && popoverStyle && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Live Model Calls"
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleClose}
          style={popoverStyle}
          className="app-popover z-[70] flex flex-col overflow-hidden rounded-2xl border border-black/10 dark:border-white/15 shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-black/8 dark:border-white/10">
            <div className="flex items-center gap-2 min-w-0">
              <span className="relative flex size-2 shrink-0">
                {hasActive && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                )}
                <span
                  className={cn(
                    "relative inline-flex size-2 rounded-full",
                    hasActive ? "bg-emerald-500" : connected ? "bg-emerald-500/45" : "bg-amber-500/70"
                  )}
                />
              </span>
              <span className="text-[12.5px] font-semibold tracking-tight text-text-main truncate">
                Live Model Calls
              </span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                  hasActive
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-black/6 dark:bg-white/10 text-text-muted"
                )}
              >
                {hasActive ? `${totalActive} active` : "Idle"}
              </span>
            </div>

            {pinned ? (
              <button
                type="button"
                onClick={closeAll}
                title="Close"
                aria-label="Close live calls panel"
                className="flex size-6 items-center justify-center rounded-lg text-text-muted hover:bg-black/6 dark:hover:bg-white/10 hover:text-text-main transition-colors"
              >
                <span className="material-symbols-outlined text-[15px]">close</span>
              </button>
            ) : (
              <span className="text-[10px] font-medium text-text-muted/80">
                {connected ? "Realtime" : "Connecting"}
              </span>
            )}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2.5 space-y-3">
            {/* Active calls */}
            <div>
              <p className="px-1 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-text-muted">
                Calling Now
              </p>
              {activeCalls.length > 0 ? (
                <div className="space-y-1.5">
                  {activeCalls.map((call, idx) => (
                    <ActiveCallRow
                      key={`${call.provider}-${call.model}-${call.account}-${idx}`}
                      call={call}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-xl px-2.5 py-2 bg-black/[0.03] dark:bg-white/[0.04] text-[11.5px] text-text-muted">
                  <span className="material-symbols-outlined text-[16px] opacity-65">graphic_eq</span>
                  <span>No models currently running</span>
                </div>
              )}
            </div>

            {/* Recent completed calls */}
            {recentCalls.length > 0 && (
              <div>
                <p className="px-1 mb-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-text-muted">
                  Recent Calls
                </p>
                <div className="space-y-0.5">
                  {recentCalls.map((call, idx) => (
                    <RecentCallRow
                      key={`${call.timestamp}-${call.provider}-${call.model}-${idx}`}
                      call={call}
                      nowMs={nowMs}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 px-3.5 py-2 border-t border-black/8 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] text-[11px]">
            <Link
              href="/dashboard/usage"
              onClick={(e) => handleQuickLink(e, "/dashboard/usage")}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              <span className="material-symbols-outlined text-[14px]">bar_chart</span>
              <span>Usage</span>
            </Link>
            <Link
              href="/dashboard/console-log"
              onClick={(e) => handleQuickLink(e, "/dashboard/console-log")}
              className="inline-flex items-center gap-1 font-medium text-text-muted hover:text-text-main transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">terminal</span>
              <span>Console Log</span>
            </Link>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

LiveCallsBell.propTypes = {
  compact: PropTypes.bool,
  onNavigate: PropTypes.func,
  onCloseSidebar: PropTypes.func,
};

