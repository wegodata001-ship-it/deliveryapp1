import { Suspense } from "react";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminSidebarWithBadges } from "@/components/admin/AdminSidebarWithBadges";
import { AdminChrome } from "@/components/admin/AdminChrome";
import { AdminWindowProvider } from "@/components/admin/AdminWindowProvider";
import { AdminNavShell } from "@/components/admin/AdminNavShell";
import { filterSidebarSections } from "@/lib/sidebar-nav";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { getLayoutFinancialSettings } from "@/lib/admin-layout-cache";
import type { AdminRouteMode } from "@/lib/admin-route-mode";
import { getLoginTraceFromCookies } from "@/lib/login-trace-server";
import { loginTraceMark, loginTraceTimed } from "@/lib/login-trace";
import { logAdminLoadDiagnostics, runAdminLoadSafe } from "@/lib/admin-load-safe";
import {
  adminLayoutPerfEnd,
  adminLayoutPerfLog,
  adminLayoutPerfRun,
  adminLayoutPerfStart,
} from "@/lib/admin-layout-perf";
import { withPerfTimer } from "@/lib/perf-log";

type Props = {
  mode: AdminRouteMode;
  children: React.ReactNode;
};

/** Shared admin shell — light mode skips financial + sidebar badge queries. */
export async function AdminShellLayout({ mode, children }: Props) {
  const trace = await getLoginTraceFromCookies();

  const render = async () => {
    adminLayoutPerfStart("layout.total");
    try {
      await logAdminLoadDiagnostics("AdminShellLayout.start");

      await adminLayoutPerfRun("layout.counts", async () => {
        adminLayoutPerfLog("layout.counts skipped — no global table counts on shell");
      });

      const user = await adminLayoutPerfRun("layout.auth", () => requireAuth());
      const isAdmin = isAdminUser(user);
      const sections = filterSidebarSections(isAdmin, user.permissionKeys);
      const isLight = mode === "light";

      if (trace) {
        loginTraceMark(trace, "7.adminLayout", { mode, isLight });
      }

      adminLayoutPerfLog("shell", { mode, isLight, isAdmin });

      const financial = isLight
        ? null
        : await adminLayoutPerfRun("layout.financial", () => getLayoutFinancialSettings());

      adminLayoutPerfStart("layout.render");
      const sidebar = isLight ? (
        <AdminSidebar sections={sections} />
      ) : (
        <Suspense fallback={<AdminSidebar sections={sections} />}>
          <AdminSidebarWithBadges sections={sections} showPendingBadge={isAdmin} />
        </Suspense>
      );

      const canManageFinancial = userHasAnyPermission(user, ["manage_settings"]);

      const tree = (
        <AdminWindowProvider>
          <AdminNavShell
            financial={financial}
            canManageFinancial={canManageFinancial}
            sidebar={sidebar}
            main={
              <AdminChrome
                displayName={user.fullName}
                roleLabel={isAdmin ? "מנהל מערכת" : "עובד"}
                financial={financial}
                canManageFinancial={canManageFinancial}
                canReceivePayments={userHasAnyPermission(user, ["receive_payments"])}
                canCreateOrders={userHasAnyPermission(user, ["create_orders"])}
                canEditOrders={userHasAnyPermission(user, ["edit_orders"])}
                canViewCustomerCard={userHasAnyPermission(user, ["view_customer_card"])}
                canCreateCustomer={userHasAnyPermission(user, ["create_orders"])}
                viewerIsAdmin={isAdmin}
              >
                {children}
              </AdminChrome>
            }
          />
        </AdminWindowProvider>
      );
      adminLayoutPerfEnd("layout.render");

      return tree;
    } finally {
      adminLayoutPerfEnd("layout.total");
    }
  };

  const run = () => runAdminLoadSafe(`AdminShellLayout.${mode}`, render);

  if (trace) {
    return loginTraceTimed(trace.traceId, "adminLayout", () =>
      withPerfTimer(`adminDomain.layout.${mode}`, run),
    );
  }
  return withPerfTimer(`adminDomain.layout.${mode}`, run);
}
