"use client";

import { cn } from "@/shared/utils/cn";

// Spinner loading
export function Spinner({ size = "md", className }) {
  const sizes = {
    sm: "size-4",
    md: "size-6",
    lg: "size-8",
    xl: "size-12",
  };

  return (
    <span
      className={cn(
        "material-symbols-outlined animate-spin text-brand-500",
        sizes[size],
        className
      )}
    >
      progress_activity
    </span>
  );
}

// Full page loading
export function PageLoading({ message = "Loading..." }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-bg">
      <Spinner size="xl" />
      <p className="mt-4 text-text-muted">{message}</p>
    </div>
  );
}

// Skeleton loading
export function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[10px] bg-surface-2",
        className
      )}
      {...props}
    />
  );
}

// Card skeleton
export function CardSkeleton({ className }) {
  return (
    <div className={cn("p-6 rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)]", className)}>
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="size-10 rounded-[10px]" />
      </div>
      <Skeleton className="h-8 w-16 mb-2" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

// Quota tracker card skeleton
export function QuotaCardSkeleton() {
  return (
    <div className="min-w-0 rounded-xl border border-black/[0.08] dark:border-white/10 bg-surface">
      <div className="px-3 py-2.5 border-b border-black/5 dark:border-white/10 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Skeleton className="size-7 rounded-md shrink-0" />
          <Skeleton className="h-4 w-36 rounded-md" />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Skeleton className="size-7 rounded-lg" />
          <Skeleton className="size-7 rounded-lg" />
          <Skeleton className="h-5 w-9 rounded-full" />
        </div>
      </div>
      <div className="px-3 py-3 space-y-2.5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-3.5 w-32 shrink-0" />
          <Skeleton className="h-2 flex-1 rounded-full" />
          <Skeleton className="h-3.5 w-16 shrink-0" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-3.5 w-28 shrink-0" />
          <Skeleton className="h-2 flex-1 rounded-full" />
          <Skeleton className="h-3.5 w-16 shrink-0" />
        </div>
      </div>
    </div>
  );
}

// Quota tracker grid skeleton
export function QuotaGridSkeleton({ count = 6 }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Skeleton className="h-8 w-32 rounded-lg" />
        <Skeleton className="h-8 w-28 rounded-lg" />
        <Skeleton className="h-8 w-28 rounded-lg" />
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 items-start gap-3">
        {Array.from({ length: count }).map((_, i) => (
          <QuotaCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

// Compact provider grid skeleton
export function ProvidersGridSkeleton({ count = 12 }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-8 w-32 rounded-lg" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 p-3.5 rounded-[14px] border border-border-subtle bg-surface/60"
          >
            <Skeleton className="size-8 rounded-lg shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Route-aware page skeleton for instant sidebar transitions
export function DashboardPageSkeleton({ pathname = "" }) {
  if (pathname.startsWith("/dashboard/quota")) {
    return <QuotaGridSkeleton />;
  }
  if (
    pathname === "/dashboard/providers" ||
    pathname.startsWith("/dashboard/media-providers") ||
    pathname.startsWith("/dashboard/cli-tools")
  ) {
    return <ProvidersGridSkeleton />;
  }
  if (pathname.startsWith("/dashboard/usage")) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-9 w-44 rounded-xl" />
          <Skeleton className="h-8 w-64 rounded-xl" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <CardSkeleton className="h-64" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <CardSkeleton />
      <CardSkeleton />
    </div>
  );
}

export default function Loading({ type = "spinner", ...props }) {
  switch (type) {
    case "page":
      return <PageLoading {...props} />;
    case "skeleton":
      return <Skeleton {...props} />;
    case "card":
      return <CardSkeleton {...props} />;
    case "quota":
      return <QuotaGridSkeleton {...props} />;
    case "dashboard":
      return <DashboardPageSkeleton {...props} />;
    default:
      return <Spinner {...props} />;
  }
}
