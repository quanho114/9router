"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { useNotificationStore } from "@/store/notificationStore";
import Sidebar from "../Sidebar";
import Header from "../Header";
import { DashboardPageSkeleton } from "../Loading";
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
  const pathname = usePathname();
  const [pendingNav, setPendingNav] = useState(null);
  const notifications = useNotificationStore((state) => state.notifications);
  const removeNotification = useNotificationStore((state) => state.removeNotification);

  // Active optimistic navigation only while `pathname` is still at the route where click happened
  const isNavigating = Boolean(
    pendingNav && pendingNav.from === pathname && pendingNav.target !== pathname
  );
  const effectivePathname = isNavigating ? pendingNav.target : pathname;

  // Clear pending state as soon as Next.js commits the route transition
  useEffect(() => {
    setPendingNav(null);
  }, [pathname]);

  // Safety fallback in case navigation is cancelled or intercepted
  useEffect(() => {
    if (!isNavigating) return;
    const timer = setTimeout(() => setPendingNav(null), 5000);
    return () => clearTimeout(timer);
  }, [isNavigating, pendingNav]);

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

  // Preload heavy usage charts in background when browser is idle
  useEffect(() => {
    const preload = () => {
      import("@/shared/components/UsageStats").catch(() => {});
      import("@/app/(dashboard)/dashboard/usage/components/UsageChart").catch(() => {});
      import("@/app/(dashboard)/dashboard/usage/components/ProviderBarChart").catch(() => {});
      import("@/app/(dashboard)/dashboard/usage/components/TopModelsChart").catch(() => {});
    };
    if (typeof window !== "undefined") {
      if ("requestIdleCallback" in window) {
        const id = window.requestIdleCallback(preload, { timeout: 4000 });
        return () => window.cancelIdleCallback(id);
      }
      const timer = setTimeout(preload, 2500);
      return () => clearTimeout(timer);
    }
  }, []);

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-bg isolate">

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
      <div className="hidden lg:flex p-3 pr-0 h-full">
        <Sidebar activePathname={effectivePathname} onNavigate={handleNavigate} />
      </div>

      {/* Sidebar - Mobile */}
      <div
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
      <main className="flex flex-col flex-1 h-full min-w-0 relative transition-colors duration-300 isolate">
        {/* Subtle Apple spatial grid + mesh */}
        <div className="landing-grid absolute inset-0 pointer-events-none -z-10" aria-hidden="true" />
        <Header activePathname={effectivePathname} onMenuClick={() => setSidebarOpen(true)} />
        <div className={`flex-1 overflow-y-auto custom-scrollbar ${effectivePathname === "/dashboard/basic-chat" ? "" : "p-5 lg:p-9"} ${effectivePathname === "/dashboard/basic-chat" ? "flex flex-col overflow-hidden" : ""}`}>
          <div className={`${effectivePathname === "/dashboard/basic-chat" ? "flex-1 w-full h-full flex flex-col" : "max-w-7xl mx-auto"}`}>
            {isNavigating && <DashboardPageSkeleton pathname={effectivePathname} />}
            <div className={isNavigating ? "hidden" : "contents"}>
              {children}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
