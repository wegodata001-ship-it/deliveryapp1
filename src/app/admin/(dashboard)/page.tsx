import { Suspense } from "react";
import { DashboardGreeting } from "@/components/admin/DashboardGreeting";
import { DashboardQuickActionsServer } from "@/components/admin/DashboardQuickActionsServer";
import { DashboardStatsLoader } from "@/components/admin/DashboardStatsLoader";
import { DashboardStatsSkeleton } from "@/components/admin/DashboardStatsSections";

function GreetSkeleton() {
  return (
    <header className="adm-dash-home-bar" aria-busy="true">
      <div className="adm-skeleton-line" style={{ height: 28, width: 220, maxWidth: "55%" }} />
    </header>
  );
}

/** דף הבית — shell מיידי; סטטיסטיקות ב-Suspense נפרד */
export default function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <div className="adm-dashboard adm-dashboard--compact adm-page--floating-actions" dir="rtl">
      <Suspense fallback={<GreetSkeleton />}>
        <DashboardGreeting />
      </Suspense>

      <Suspense fallback={<DashboardStatsSkeleton />}>
        <DashboardStatsLoader searchParams={searchParams} />
      </Suspense>

      <Suspense fallback={null}>
        <DashboardQuickActionsServer />
      </Suspense>
    </div>
  );
}
