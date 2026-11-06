"use client";

import { usePathname } from "next/navigation";
import { DashboardPageSkeleton } from "@/shared/components/Loading";

export default function DashboardRouteLoading() {
  const pathname = usePathname();
  return <DashboardPageSkeleton pathname={pathname || ""} />;
}

