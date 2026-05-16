import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminChrome } from "@/components/admin/AdminChrome";
import { AdminWindowProvider } from "@/components/admin/AdminWindowProvider";
import { AdminNavShell } from "@/components/admin/AdminNavShell";
import { filterSidebarSections } from "@/lib/sidebar-nav";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { ensureAppPermissions } from "@/lib/permissions";
import { countPendingOrderEditRequestsForAdmin } from "@/app/admin/order-edit-requests/actions";
import { ensureDefaultFinancialSettings, getCurrentFinancialSettings, serializeFinancialSettings } from "@/lib/financial-settings";
import "./admin.css";
import "@/styles/wego-order-capture-fluid.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: "noindex, nofollow",
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await ensureAppPermissions(prisma);
  const user = await requireAuth();
  const isAdmin = isAdminUser(user);
  const sections = filterSidebarSections(isAdmin, user.permissionKeys);
  let pendingOrderEditRequests = 0;
  if (isAdmin) {
    try {
      pendingOrderEditRequests = await countPendingOrderEditRequestsForAdmin();
    } catch {
      pendingOrderEditRequests = 0;
    }
  }
  await ensureDefaultFinancialSettings();
  const finRow = await getCurrentFinancialSettings();
  const financial = serializeFinancialSettings(finRow);

  return (
    <AdminWindowProvider>
      <AdminNavShell
        financial={financial}
        canManageFinancial={userHasAnyPermission(user, ["manage_settings"])}
        sidebar={
          <Suspense fallback={<aside className="adm-sidebar" aria-hidden />}>
            <AdminSidebar
              sections={sections}
              navBadges={pendingOrderEditRequests > 0 ? { pendingOrderEditRequests } : undefined}
            />
          </Suspense>
        }
        main={
          <Suspense fallback={<div className="adm-content adm-content--chrome">{children}</div>}>
            <AdminChrome
              displayName={user.fullName}
              roleLabel={isAdminUser(user) ? "מנהל מערכת" : "עובד"}
              financial={financial}
              canManageFinancial={userHasAnyPermission(user, ["manage_settings"])}
              canReceivePayments={userHasAnyPermission(user, ["receive_payments"])}
              canCreateOrders={userHasAnyPermission(user, ["create_orders"])}
              canEditOrders={userHasAnyPermission(user, ["edit_orders"])}
              canViewCustomerCard={userHasAnyPermission(user, ["view_customer_card"])}
              canCreateCustomer={userHasAnyPermission(user, ["create_orders"])}
              viewerIsAdmin={isAdmin}
            >
              {children}
            </AdminChrome>
          </Suspense>
        }
      />
    </AdminWindowProvider>
  );
}
