"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useNotificationStore } from "@/store/notificationStore";
import { markDashboardHydrated, readCache, writeCache } from "@/shared/utils/dashboardCache";
import Sidebar from "../Sidebar";
import Header from "../Header";

const PREFETCH_ROUTES = [
  "/dashboard/endpoint",
  "/dashboard/providers",
  "/dashboard/combos",
  "/dashboard/usage",
  "/dashboard/quota",
  "/dashboard/token-saver",
  "/dashboard/cli-tools",
  "/dashboard/proxy-pools",
  "/dashboard/skills",
  "/dashboard/console-log",
  "/dashboard/profile",
  "/dashboard/media-providers/embedding",
  "/dashboard/media-providers/image",
  "/dashboard/media-providers/video",
  "/dashboard/media-providers/tts",
  "/dashboard/media-providers/stt",
  "/dashboard/media-providers/systemone",
  "/dashboard/media-providers/web",
];
function getToastStyle(type) {
  if (type === "success") {
    return {
      wrapper:
        "border-emerald-200 dark:border-emerald-500/40 bg-emerald-50/95 dark:bg-emerald-950/90 text-emerald-900 dark:text-emerald-100 shadow-lg backdrop-blur-md",
      icon: "check_circle",
      iconClass: "text-emerald-600 dark:text-emerald-400",
    };
  }
  if (type === "error") {
    return {
      wrapper:
        "border-red-200 dark:border-red-500/40 bg-red-50/95 dark:bg-red-950/90 text-red-900 dark:text-red-100 shadow-lg backdrop-blur-md",
      icon: "error",
      iconClass: "text-red-600 dark:text-red-400",
    };
  }
  if (type === "warning") {
    return {
      wrapper:
        "border-amber-200 dark:border-amber-500/40 bg-amber-50/95 dark:bg-amber-950/90 text-amber-900 dark:text-amber-100 shadow-lg backdrop-blur-md",
      icon: "warning",
      iconClass: "text-amber-600 dark:text-amber-400",
    };
  }
  return {
    wrapper:
      "border-sky-200 dark:border-sky-500/40 bg-sky-50/95 dark:bg-sky-950/90 text-sky-900 dark:text-sky-100 shadow-lg backdrop-blur-md",
    icon: "info",
    iconClass: "text-sky-600 dark:text-sky-400",
  };
}

export default function DashboardLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const [pendingNav, setPendingNav] = useState(null);
  const notifications = useNotificationStore((state) => state.notifications);
  const removeNotification = useNotificationStore((state) => state.removeNotification);

  useEffect(() => {
    markDashboardHydrated();
  }, []);

  // Active optimistic navigation only while `pathname` is still at the route where click happened
  const isNavigating = Boolean(
    pendingNav && pendingNav.from === pathname && pendingNav.target !== pathname
  );
  const effectivePathname = isNavigating ? pendingNav.target : pathname;

  // Safety fallback in case navigation is cancelled or intercepted
  useEffect(() => {
    if (!isNavigating) return;
    const resetTimer = setTimeout(() => setPendingNav(null), 5000);
    return () => clearTimeout(resetTimer);
  }, [isNavigating]);

  const handleNavigate = useCallback(
    (targetHref) => {
      setSidebarOpen(false);
      if (!targetHref) return;
      const isSameEndpointAlias =
        (pathname === "/dashboard" || pathname === "/dashboard/endpoint") &&
        (targetHref === "/dashboard" || targetHref === "/dashboard/endpoint");
      if (targetHref === pathname || isSameEndpointAlias) {
        setPendingNav(null);
        return;
      }
      setPendingNav({ from: pathname, target: targetHref });
    },
    [pathname]
  );

  // Preload heavy usage charts, prefetch routes, and pre-warm SWR cache when browser is idle
  useEffect(() => {
    const preload = () => {
      for (const route of PREFETCH_ROUTES) {
        try {
          router.prefetch(route);
        } catch {}
      }
      import("@/shared/components/UsageStats").catch(() => {});
      import("@/app/(dashboard)/dashboard/usage/components/UsageChart").catch(() => {});
      import("@/app/(dashboard)/dashboard/usage/components/ProviderBarChart").catch(() => {});
      import("@/app/(dashboard)/dashboard/usage/components/TopModelsChart").catch(() => {});

      const warmIfEmpty = (cacheKey, url, transform) => {
        if (readCache(cacheKey, null) !== null) return;
        fetch(url)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data) writeCache(cacheKey, transform ? transform(data) : data);
          })
          .catch(() => {});
      };

      warmIfEmpty("providers", "/api/providers", (d) => d.connections || []);
      warmIfEmpty("providerNodes", "/api/provider-nodes", (d) => d.nodes || []);
      warmIfEmpty("settings", "/api/settings");
      warmIfEmpty("combos", "/api/combos", (d) => d.combos || []);
      warmIfEmpty("keys", "/api/keys", (d) => d.keys || []);
      warmIfEmpty("usageStats:today", "/api/usage/stats?period=today");
      warmIfEmpty(
        "quotaConnections:all:all:1:20",
        "/api/providers/client?page=1&pageSize=20&accountStatus=all&sort=priority"
      );
    };
    if (typeof window !== "undefined") {
      if ("requestIdleCallback" in window) {
        const id = window.requestIdleCallback(preload, { timeout: 2000 });
        return () => window.cancelIdleCallback(id);
      }
      const timer = setTimeout(preload, 1000);
      return () => clearTimeout(timer);
    }
  }, [router]);

  return (
    <div className="dolphin-dashboard relative flex h-screen w-full overflow-hidden bg-bg isolate">
      <div className="dolphin-wallpaper pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />

      {/* Apple Dynamic Island / Glass Toast Notifications */}
      <div className="fixed top-4 right-4 z-[80] flex w-[min(92vw,380px)] flex-col gap-2.5">
        {notifications.map((n) => {
          const style = getToastStyle(n.type);
          return (
            <div
              key={n.id}
              className={`rounded-2xl border px-3.5 py-2.5 slide-in-top ${style.wrapper}`}
            >
              <div className="flex items-start gap-2.5">
                <span className={`material-symbols-outlined text-[18px] leading-5 ${style.iconClass || ""}`}>{style.icon}</span>
                <div className="min-w-0 flex-1">
                  {n.title ? <p className="text-xs font-semibold mb-0.5">{n.title}</p> : null}
                  <p className="text-xs font-medium whitespace-pre-wrap break-words leading-relaxed">{n.message}</p>
                </div>
                {n.dismissible ? (
                  <button
                    type="button"
                    onClick={() => removeNotification(n.id)}
                    className="rounded-full p-0.5 text-current/70 hover:bg-black/5 dark:hover:bg-white/10 hover:text-current transition-colors"
                    aria-label="Dismiss notification"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar - Desktop */}
      <div
        id="desktop-sidebar"
        className={`hidden lg:flex shrink-0 overflow-hidden h-full transition-[width] duration-200 motion-reduce:transition-none ${sidebarCollapsed ? "w-[84px]" : "w-[300px]"}`}
      >
        <div className="p-3 pr-0 h-full shrink-0">
        <Sidebar activePathname={effectivePathname} onNavigate={handleNavigate} collapsed={sidebarCollapsed} onCollapse={() => setSidebarCollapsed((collapsed) => !collapsed)} />
        </div>
      </div>

      {/* Sidebar - Mobile */}
      <div
        id="mobile-sidebar"
        inert={!sidebarOpen ? true : undefined}
        className={`fixed inset-y-0 left-0 z-50 transform lg:hidden transition-transform duration-300 ease-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar
          activePathname={effectivePathname}
          onNavigate={handleNavigate}
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      {/* Main content */}
      <main className="dolphin-workspace flex flex-col flex-1 min-h-0 min-w-0 relative transition-colors duration-300 isolate">
        <Header
          activePathname={effectivePathname}
          onMenuClick={() => setSidebarOpen((open) => !open)}
          mobileSidebarOpen={sidebarOpen}
          sidebarCollapsed={sidebarCollapsed}
        />
        <div className={`flex-1 min-h-0 overflow-y-auto custom-scrollbar ${effectivePathname === "/dashboard/basic-chat" ? "" : "px-5 pb-5 pt-4 lg:px-9 lg:pb-9 lg:pt-6"} ${effectivePathname === "/dashboard/basic-chat" ? "flex flex-col overflow-hidden" : ""}`}>
          <div className={`dolphin-content ${effectivePathname === "/dashboard/basic-chat" ? "flex-1 w-full h-full flex flex-col" : "max-w-7xl mx-auto"}`}>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
