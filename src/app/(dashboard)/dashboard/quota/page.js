import { Suspense } from "react";
import { QuotaGridSkeleton } from "@/shared/components/Loading";
import ProviderLimits from "../usage/components/ProviderLimits";

export default function QuotaPage() {
  return (
    <Suspense fallback={<QuotaGridSkeleton />}>
      <ProviderLimits />
    </Suspense>
  );
}
