"use client";

import { useEffect, useId, useRef, useState } from "react";
import QuotaIcon from "./QuotaIcon";

export default function QuotaSelect({ value, options, onChange, label, placement = "bottom" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const id = useId();
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector('[aria-selected="true"]')?.focus();
    const outside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const choose = (next) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="relative" ref={rootRef} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button type="button" ref={triggerRef} aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); }
        }}
        className="flex h-8 items-center gap-2 rounded-lg border border-black/10 bg-white/25 px-3 text-xs text-text-main hover:bg-white/45 dark:border-white/15 dark:bg-white/5 dark:hover:bg-white/10 transition-colors focus-visible:outline-2 focus-visible:outline-primary">
        <span>{selected?.label || label}</span>
        <QuotaIcon name="expand_more" className="text-text-muted" />
      </button>
      {open && (
        <div id={id} role="listbox" aria-label={label}
          className={`app-popover absolute left-0 z-40 min-w-[180px] w-max max-w-[calc(100vw-32px)] rounded-xl border border-black/10 dark:border-white/15 p-1.5 shadow-xl ${placement === "top" ? "bottom-full mb-2" : "top-full mt-2"}`}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); return; }
            const items = [...event.currentTarget.querySelectorAll('[role="option"]')];
            const index = items.indexOf(document.activeElement);
            let next;
            if (event.key === "ArrowDown") next = (index + 1) % items.length;
            if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
            if (event.key === "Home") next = 0;
            if (event.key === "End") next = items.length - 1;
            if (next !== undefined) { event.preventDefault(); items[next]?.focus(); }
          }}>
          {options.map((option) => (
            <button type="button" role="option" aria-selected={option.value === value} tabIndex={-1} key={option.value}
              onClick={() => choose(option.value)}
              className={`flex w-full items-center justify-between gap-5 rounded-lg px-3 py-2.5 text-left text-xs text-text-main outline-none hover:bg-black/5 focus:bg-black/5 dark:hover:bg-white/10 dark:focus:bg-white/10 ${option.value === value ? "bg-black/5 dark:bg-white/10 font-medium" : ""}`}>
              <span>{option.label}</span>
              <span className={`material-symbols-outlined text-[17px] ${option.value === value ? "" : "invisible"}`} aria-hidden="true">check</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
