"use client";

import { useState, useEffect, useRef } from "react";
import { LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { LOCALE_FLAGS } from "@/shared/constants/locales";
import { translate } from "@/i18n/runtime";
import LanguageSwitcher from "./LanguageSwitcher";

function getLocaleFromCookie() {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

export default function HeaderLanguage() {
  const [open, setOpen] = useState(false);
  const [locale, setLocale] = useState("en");
  const triggerRef = useRef(null);
  const [anchorPosition, setAnchorPosition] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setLocale(getLocaleFromCookie()), 0);
    return () => clearTimeout(timer);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          const rect = triggerRef.current.getBoundingClientRect();
          setAnchorPosition({
            top: rect.bottom + 8,
            right: Math.max(12, window.innerWidth - rect.right),
            width: Math.min(300, window.innerWidth - 24),
            maxHeight: Math.max(160, window.innerHeight - rect.bottom - 20),
          });
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex items-center justify-center p-2 rounded-lg text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5 transition-all"
        title={translate("Language")}
        aria-label={translate("Language")}
        data-i18n-skip="true"
      >
        <span className="text-xs font-semibold leading-none">{LOCALE_FLAGS[locale] || "US"}</span>
      </button>

      <LanguageSwitcher
        hideTrigger
        anchorRef={triggerRef}
        anchorPosition={anchorPosition}
        isOpen={open}
        onClose={(next) => {
          setOpen(false);
          setLocale(next);
        }}
      />
    </>
  );
}
