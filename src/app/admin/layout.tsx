import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminChrome } from "@/components/admin/AdminChrome";
import { filterSidebarSections } from "@/lib/sidebar-nav";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { ensureDefaultFinancialSettings, getCurrentFinancialSettings, serializeFinancialSettings } from "@/lib/financial-settings";
import "./admin.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "וויגו פרו — מערכת ניהול",
  robots: "noindex, nofollow",
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();
  const sections = filterSidebarSections(isAdminUser(user), user.permissionKeys);
  await ensureDefaultFinancialSettings();
  const finRow = await getCurrentFinancialSettings();
  const financial = serializeFinancialSettings(finRow);

  return (
    <div className="adm-root" dir="rtl" lang="he">
      <Suspense fallback={<aside className="adm-sidebar" aria-hidden />}>
        <AdminSidebar sections={sections} />
      </Suspense>
      <div className="adm-main">
        <Suspense
          fallback={<div className="adm-content adm-content--chrome">{children}</div>}
        >
          <AdminChrome
            displayName={user.fullName}
            roleLabel={isAdminUser(user) ? "מנהל מערכת" : "עובד"}
            financial={financial}
            canManageFinancial={userHasAnyPermission(user, ["manage_settings"])}
            canReceivePayments={userHasAnyPermission(user, ["receive_payments"])}
            canCreateOrders={userHasAnyPermission(user, ["create_orders"])}
            canEditOrders={userHasAnyPermission(user, ["edit_orders"])}
          >
            {children}
          </AdminChrome>
        </Suspense>
      </div>
    </div>
  );
}
