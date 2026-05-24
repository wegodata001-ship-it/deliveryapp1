import { Suspense } from "react";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { parseDateFilterFromSearchParams } from "@/lib/work-week";
import { DashboardQuickActions } from "@/components/admin/DashboardQuickActions";
import {
  DashboardStatsSections,
  DashboardStatsSkeleton,
} from "@/components/admin/DashboardStatsSections";
import { withPerfTimer } from "@/lib/perf-log";

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return withPerfTimer("admin.route.dashboard.page", async () => {
    const me = await requireAuth();
    const sp = await searchParams;
    const range = parseDateFilterFromSearchParams(sp);
    const showStaffStats = isAdminUser(me) || me.permissionKeys.includes("manage_users");
    const displayName = me.fullName?.trim() || me.username || "משתמש";

    const canCreateOrders = userHasAnyPermission(me, ["create_orders"]);
    const canReceivePayments = userHasAnyPermission(me, ["receive_payments"]);
    const canViewReports = userHasAnyPermission(me, ["view_reports"]);

    return (
      <div className="adm-dashboard adm-dashboard--compact adm-page--floating-actions" dir="rtl">
        <header className="adm-dash-home-bar adm-dash-reveal">
          <p className="adm-dash-home-bar__greet">
            שלום, <strong>{displayName}</strong>
          </p>
        </header>

        <Suspense fallback={<DashboardStatsSkeleton />}>
          <DashboardStatsSections me={me} range={range} searchParams={sp} showStaffStats={showStaffStats} />
        </Suspense>

        {(canCreateOrders || canReceivePayments || canViewReports) && (
          <DashboardQuickActions
            canCreateOrders={canCreateOrders}
            canReceivePayments={canReceivePayments}
            canViewReports={canViewReports}
          />
        )}
      </div>
    );
  });
}
