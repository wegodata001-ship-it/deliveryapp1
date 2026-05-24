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
import { withPerfTimer } from "@/lib/perf-log";

type Props = {
  mode: AdminRouteMode;
  children: React.ReactNode;
};

/** Shared admin shell — full mode loads financial + sidebar badges; light mode skips heavy layout fetches. */
export async function AdminShellLayout({ mode, children }: Props) {
  return withPerfTimer(`adminDomain.layout.${mode}`, async () => {
    const user = await withPerfTimer("admin.auth.requireAuth", () => requireAuth());
    const isAdmin = isAdminUser(user);
    const sections = filterSidebarSections(isAdmin, user.permissionKeys);
    const isLight = mode === "light";

    const financial = isLight
      ? null
      : await withPerfTimer("admin.layout.financial", () => getLayoutFinancialSettings());

    const sidebar = isLight ? (
      <AdminSidebar sections={sections} />
    ) : (
      <Suspense fallback={<AdminSidebar sections={sections} />}>
        <AdminSidebarWithBadges sections={sections} showPendingBadge={isAdmin} />
      </Suspense>
    );

    const canManageFinancial = userHasAnyPermission(user, ["manage_settings"]);

    return (
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
              loadOrderStatusCatalog={!isLight}
            >
              {children}
            </AdminChrome>
          }
        />
      </AdminWindowProvider>
    );
  });
}
