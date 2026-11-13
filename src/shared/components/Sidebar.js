"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import useSettingsStore from "@/store/settingsStore";
import LiveCallsBell from "./LiveCallsBell";

// const VISIBLE_MEDIA_KINDS = ["embedding", "image", "imageToText", "tts", "stt", "webSearch", "webFetch", "video", "music"];
const VISIBLE_MEDIA_KINDS = ["embedding", "image", "video", "tts", "stt", "systemone"];
// Combined entry: webSearch + webFetch share one page at /dashboard/media-providers/web
const COMBINED_WEB_ITEM = { id: "web", label: "Web Fetch & Search", icon: "travel_explore", href: "/dashboard/media-providers/web" };

const navItems = [
  { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api" },
  { href: "/dashboard/providers", label: "Providers", icon: "dns" },
  // { href: "/dashboard/basic-chat", label: "Basic Chat", icon: "chat" }, // Hidden
  { href: "/dashboard/combos", label: "Combo & Vision Adapter", icon: "layers" },
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
  { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings" },
  // { href: "/dashboard/pxpipe", label: "PXPIPE", icon: "image" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
];

const debugItems = [
  { href: "/dashboard/console-log", label: "Console Log", icon: "terminal" },
  { href: "/dashboard/translator", label: "Translator", icon: "translate" },
];

const systemItems = [
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
  { href: "/dashboard/skills", label: "Skills", icon: "extension" },
];

export default function Sidebar({ onClose, onCollapse, onNavigate, activePathname, collapsed = false }) {
  const routerPathname = usePathname();
  const pathname = activePathname || routerPathname;
  const [mediaOpen, setMediaOpen] = useState(false);
  const [enableTranslator, setEnableTranslator] = useState(false);

  useEffect(() => {
    useSettingsStore.getState().fetchSettings().then((data) => {
      if (data?.enableTranslator) setEnableTranslator(true);
    });
  }, []);

  const isActive = (href) => {
    if (href === "/dashboard/endpoint") {
      return pathname === "/dashboard" || pathname.startsWith("/dashboard/endpoint");
    }
    return pathname.startsWith(href);
  };

  const handleLinkClick = (e, href) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    onNavigate?.(href);
    onClose?.();
  };

  const navItemClass = (active) =>
    cn(
      "flex items-center gap-3 px-3.5 py-2 rounded-[12px] transition-all duration-200 group relative",
      active
        ? "liquid-active text-primary font-semibold"
        : "text-text-main/75 hover:bg-white/30 dark:hover:bg-white/[0.06] hover:text-text-main font-medium"
    );

  if (collapsed) {
    const compactItems = [
      ...navItems,
      { href: "/dashboard/media-providers", label: "Media Providers", icon: "perm_media" },
      ...systemItems,
      ...debugItems.filter((item) => item.icon !== "translate" || enableTranslator),
    ];
    const compactLink = (item) => (
      <Link key={item.href} href={item.href} onClick={(event) => handleLinkClick(event, item.href)}
        title={item.label} aria-label={item.label} aria-current={isActive(item.href) ? "page" : undefined}
        className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-primary", isActive(item.href) ? "liquid-active text-primary" : "text-text-main/65 hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-main")}>
        <span className="material-symbols-outlined text-[22px]" aria-hidden="true">{item.icon}</span>
      </Link>
    );
    return (
      <aside className="flex w-[72px] h-full min-h-0 flex-col items-center rounded-[24px] bg-sidebar liquid-sidebar py-4 gap-3">
        <button type="button" onClick={onCollapse} title="Open sidebar" aria-label="Open sidebar" aria-expanded={false} aria-controls="desktop-sidebar"
          className="group relative flex size-10 shrink-0 items-center justify-center rounded-xl text-text-main/65 hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          <img src="/logo.svg" alt="" className="size-8 opacity-100 group-hover:opacity-0 group-focus-visible:opacity-0 transition-opacity duration-150 motion-reduce:transition-none" />
          <svg className="absolute opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150 motion-reduce:transition-none" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <rect x="3" y="4.5" width="18" height="15" rx="2.5" /><path d="M9 4.5v15" />
          </svg>
        </button>
        <LiveCallsBell compact onNavigate={onNavigate} onCloseSidebar={onClose} />
        <nav aria-label="Main navigation" className="flex flex-1 min-h-0 w-full flex-col items-center gap-1 overflow-y-auto custom-scrollbar py-1">
          {compactItems.map(compactLink)}
        </nav>
        {compactLink({ href: "/dashboard/profile", label: "Settings", icon: "settings" })}
      </aside>
    );
  }

  return (
    <>
      <aside className="flex w-72 flex-col bg-sidebar liquid-sidebar transition-colors duration-300 h-full min-h-0 rounded-[28px] select-none">
        {/* macOS Sequoia Traffic lights */}
        <div className="flex items-center gap-2 px-6 pt-5 pb-2">
          <div className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E]/60 shadow-[inset_0_1px_0.5px_rgba(255,255,255,0.55),0_1px_2px_rgba(0,0,0,0.12)]" />
          <div className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123]/60 shadow-[inset_0_1px_0.5px_rgba(255,255,255,0.55),0_1px_2px_rgba(0,0,0,0.12)]" />
          <div className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29]/60 shadow-[inset_0_1px_0.5px_rgba(255,255,255,0.55),0_1px_2px_rgba(0,0,0,0.12)]" />
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              aria-label="Close sidebar"
              title="Close sidebar"
              aria-expanded={true}
              aria-controls="desktop-sidebar"
              className="ml-auto flex size-8 items-center justify-center rounded-lg text-text-main/65 hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-main transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
                <path d="M9 4.5v15" />
                <path d="M3 7a2.5 2.5 0 0 1 2.5-2.5H9v15H5.5A2.5 2.5 0 0 1 3 17Z" fill="currentColor" fillOpacity="0.12" stroke="none" />
              </svg>
            </button>
          )}
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close sidebar" title="Close sidebar" className="ml-auto flex size-8 items-center justify-center rounded-full text-text-muted hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-main focus-visible:outline-2 focus-visible:outline-primary">
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">close</span>
            </button>
          )}
        </div>

        {/* Brand Identity */}
        <div className="px-6 py-4 flex items-center justify-between gap-2">
          <Link href="/dashboard" prefetch={true} onClick={(e) => handleLinkClick(e, "/dashboard")} className="flex items-center gap-3.5 group min-w-0">
            <div className="flex items-center justify-center size-10 shrink-0 rounded-[12px] group-hover:scale-[1.03] transition-transform duration-200">
              <img src="/logo.svg" alt="" className="size-9" />
            </div>
            <div className="flex flex-col min-w-0">
              <h1 className="text-[17px] font-semibold tracking-tight text-text-main leading-tight truncate">
                {APP_CONFIG.name}
              </h1>
              <span className="text-[11px] font-medium text-text-muted/85">
                v{APP_CONFIG.version}
              </span>
            </div>
          </Link>
          <LiveCallsBell onNavigate={onNavigate} onCloseSidebar={onClose} />
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3.5 py-2 space-y-1 overflow-y-auto custom-scrollbar">
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={true}
                onClick={(e) => handleLinkClick(e, item.href)}
                className={navItemClass(active)}
              >
                <span
                  className={cn(
                    "material-symbols-outlined text-[19px] transition-transform duration-200 group-hover:scale-105",
                    active ? "fill-1 text-primary" : "text-text-muted group-hover:text-primary transition-colors"
                  )}
                >
                  {item.icon}
                </span>
                <span className="text-[13.5px] tracking-[-0.01em]">{item.label}</span>
              </Link>
            );
          })}

          {/* System section */}
          <div className="pt-4 mt-3 space-y-1">
            <p className="px-3.5 text-[10.5px] font-semibold text-text-muted/65 uppercase tracking-[0.08em] mb-1.5">
              System
            </p>

            {/* Media Providers accordion */}
            <button
              onClick={() => setMediaOpen((v) => !v)}
              className={cn(
                "w-full",
                navItemClass(pathname.startsWith("/dashboard/media-providers"))
              )}
            >
              <span className="material-symbols-outlined text-[19px]">perm_media</span>
              <span className="text-[13.5px] tracking-[-0.01em] flex-1 text-left">Media Providers</span>
              <span
                className="material-symbols-outlined text-[16px] transition-transform duration-200"
                style={{ transform: mediaOpen ? "rotate(180deg)" : "rotate(0deg)" }}
              >
                expand_more
              </span>
            </button>
            {mediaOpen && (
              <div className="pl-3.5 space-y-0.5 pt-0.5">
                {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => {
                  const subActive = pathname.startsWith(`/dashboard/media-providers/${kind.id}`);
                  return (
                    <Link
                      key={kind.id}
                      href={`/dashboard/media-providers/${kind.id}`}
                      prefetch={true}
                      onClick={(e) => handleLinkClick(e, `/dashboard/media-providers/${kind.id}`)}
                      className={cn(
                        "flex items-center gap-3 px-3.5 py-1.5 rounded-[11px] transition-all duration-150 group",
                        subActive
                          ? "liquid-active text-primary font-semibold"
                          : "text-text-main/75 hover:bg-white/30 dark:hover:bg-white/[0.06] hover:text-text-main"
                      )}
                    >
                      <span className="material-symbols-outlined text-[16px]">{kind.icon}</span>
                      <span className="text-[13px]">{kind.label}</span>
                    </Link>
                  );
                })}
                <Link
                  key={COMBINED_WEB_ITEM.id}
                  href={COMBINED_WEB_ITEM.href}
                  prefetch={true}
                  onClick={(e) => handleLinkClick(e, COMBINED_WEB_ITEM.href)}
                  className={cn(
                    "flex items-center gap-3 px-3.5 py-1.5 rounded-[11px] transition-all duration-150 group",
                    pathname.startsWith(COMBINED_WEB_ITEM.href)
                      ? "liquid-active text-primary font-semibold"
                      : "text-text-main/75 hover:bg-white/30 dark:hover:bg-white/[0.06] hover:text-text-main"
                  )}
                >
                  <span className="material-symbols-outlined text-[16px]">{COMBINED_WEB_ITEM.icon}</span>
                  <span className="text-[13px]">{COMBINED_WEB_ITEM.label}</span>
                </Link>
              </div>
            )}

            {systemItems.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={true}
                  onClick={(e) => handleLinkClick(e, item.href)}
                  className={navItemClass(active)}
                >
                  <span
                    className={cn(
                      "material-symbols-outlined text-[19px]",
                      active ? "fill-1 text-primary" : "group-hover:text-primary transition-colors"
                    )}
                  >
                    {item.icon}
                  </span>
                  <span className="text-[13.5px] tracking-[-0.01em]">{item.label}</span>
                </Link>
              );
            })}

            {/* Debug items (inside System section, before Settings) */}
            {debugItems.map((item) => {
              const show = item.href !== "/dashboard/translator" || enableTranslator;
              const active = isActive(item.href);
              return show ? (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={true}
                  onClick={(e) => handleLinkClick(e, item.href)}
                  className={navItemClass(active)}
                >
                  <span
                    className={cn(
                      "material-symbols-outlined text-[19px]",
                      active ? "fill-1 text-primary" : "group-hover:text-primary transition-colors"
                    )}
                  >
                    {item.icon}
                  </span>
                  <span className="text-[13.5px] tracking-[-0.01em]">{item.label}</span>
                </Link>
              ) : null;
            })}

            {/* Settings */}
            <Link
              href="/dashboard/profile"
              prefetch={true}
              onClick={(e) => handleLinkClick(e, "/dashboard/profile")}
              className={navItemClass(isActive("/dashboard/profile"))}
            >
              <span
                className={cn(
                  "material-symbols-outlined text-[19px]",
                  isActive("/dashboard/profile") ? "fill-1 text-primary" : "group-hover:text-primary transition-colors"
                )}
              >
                settings
              </span>
              <span className="text-[13.5px] tracking-[-0.01em]">Settings</span>
            </Link>
          </div>
        </nav>
      </aside>
    </>
  );
}

Sidebar.propTypes = {
  collapsed: PropTypes.bool,
  onCollapse: PropTypes.func,
  onClose: PropTypes.func,
  onNavigate: PropTypes.func,
  activePathname: PropTypes.string,
};
