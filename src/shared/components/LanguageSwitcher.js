"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { LOCALES, LOCALE_NAMES, LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { LOCALE_FLAGS } from "@/shared/constants/locales";
import { translate, reloadTranslations } from "@/i18n/runtime";

function getLocaleFromCookie() {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

const getLocaleInfo = (locale) => ({ name: LOCALE_NAMES[locale], flag: LOCALE_FLAGS[locale] });

export default function LanguageSwitcher({ className = "", isOpen: controlledOpen, onClose, hideTrigger = false, anchorRef, anchorPosition }) {
  const [locale, setLocale] = useState("en");
  const [isPending, setIsPending] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const modalRef = useRef(null);

  const isControlled = typeof controlledOpen === "boolean";
  const isOpen = isControlled ? controlledOpen : internalOpen;
  const setIsOpen = useCallback((value, nextLocale = locale) => {
    if (isControlled) {
      if (!value && onClose) onClose(nextLocale);
    } else {
      setInternalOpen(value);
    }
  }, [isControlled, locale, onClose]);

  useEffect(() => {
    const timer = setTimeout(() => setLocale(getLocaleFromCookie()), 0);
    return () => clearTimeout(timer);
  }, []);

  // Close modal when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (modalRef.current && !modalRef.current.contains(event.target) && !anchorRef?.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, setIsOpen, anchorRef]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        anchorRef?.current?.focus();
      }
    };
    const closeOnResize = () => setIsOpen(false);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnResize);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [isOpen, setIsOpen, anchorRef]);

  const handleSetLocale = async (nextLocale) => {
    if (isPending) return;
    if (nextLocale === locale) {
      setIsOpen(false);
      anchorRef?.current?.focus();
      return;
    }

    setIsPending(true);
    try {
      const response = await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: nextLocale }),
      });
      
      if (!response.ok) throw new Error("Failed to change language");
      // Reload translations without full page reload
      await reloadTranslations();
      setLocale(nextLocale);
      setIsOpen(false, nextLocale);
      anchorRef?.current?.focus();
    } catch (err) {
      console.error("Failed to set locale:", err);
    } finally {
      setIsPending(false);
    }
  };

  const anchor = anchorPosition;
  const dropdownStyle = anchorPosition || undefined;

  return (
    <div className={className}>
      {/* Trigger button */}
      {!hideTrigger && (
        <button
          onClick={() => setIsOpen(!isOpen)}
          disabled={isPending}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-text-muted hover:text-text-main hover:bg-surface/60 transition-colors"
          title="Language"
          data-i18n-skip="true"
        >
          <span className="material-symbols-outlined text-[20px]">language</span>
          <span className="text-sm font-medium">{getLocaleInfo(locale).name}</span>
          <span className="text-lg">{getLocaleInfo(locale).flag}</span>
        </button>
      )}

      {/* Portal modal - renders at document.body to avoid parent layout constraints */}
      {isOpen && createPortal(
        <div className={anchor ? "fixed z-50" : "fixed inset-0 z-50 flex items-center justify-center p-4"} style={dropdownStyle} data-i18n-skip="true">
          {/* Overlay */}
          {!anchor && <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
          />}

          {/* Modal content */}
          <div
            ref={modalRef}
            role="dialog"
            aria-modal={anchor ? undefined : true}
            aria-labelledby="language-dialog-title"
            className="relative w-full bg-[#fafaf9] dark:bg-[#0a0a0a] border border-black/10 dark:border-white/15 rounded-[24px] shadow-2xl animate-in fade-in zoom-in-95 duration-200 max-w-sm flex flex-col max-h-[80vh] overflow-hidden"
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h2 id="language-dialog-title" className="text-base font-semibold tracking-tight text-text-main">{translate("Select Language")}</h2>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-text-muted hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                aria-label={translate("Close")}
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="px-3 pb-3 overflow-y-auto flex-1">
              <div className="flex flex-col gap-1">
                {LOCALES.map((item) => {
                  const active = locale === item;
                  const info = getLocaleInfo(item);
                  return (
                    <button
                      key={item}
                      type="button"
                      autoFocus={active}
                      onClick={() => handleSetLocale(item)}
                      disabled={isPending}
                      aria-pressed={active}
                      className={`flex items-center gap-3 px-3 py-3 rounded-[14px] text-sm font-medium transition-colors w-full text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary ${
                        active
                          ? "bg-black/[0.06] dark:bg-white/[0.09] text-text-main"
                          : "text-text-main hover:bg-black/5 dark:hover:bg-white/5"
                      } ${isPending ? "opacity-70 cursor-wait" : ""}`}
                      title={info.name}
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-black/[0.07] dark:border-white/10 bg-white dark:bg-[#171717] text-xs font-semibold tracking-wide text-text-muted">{info.flag}</span>
                      <span lang={item} className="flex-1 leading-snug">{info.name}</span>
                      <span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${active ? "bg-text-main text-bg" : "text-transparent"}`} aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3.5 8 3 3 6-6" /></svg>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
