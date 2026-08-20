import { AdminSidebar } from "@/components/admin/AdminSidebar";
import {
  getPendingInvoiceCancelRequestCount,
  getPendingOrderEditRequestCount,
  getPendingPaymentMethodAdjustmentCount,
} from "@/lib/admin-layout-cache";
import { adminLayoutPerfRun } from "@/lib/admin-layout-perf";
import type { NavGroupDef, NavItemDef } from "@/lib/sidebar-nav";

type Props = {
  groups: NavGroupDef[];
  homeItem: NavItemDef | null;
  showPendingBadge: boolean;
};

/** Sidebar + badge בקשות עריכה / ביטול חשbונית — נטען ב-Suspense */
export async function AdminSidebarWithBadges({ groups, homeItem, showPendingBadge }: Props) {
  if (!showPendingBadge) {
    return <AdminSidebar groups={groups} homeItem={homeItem} />;
  }
  const [pendingOrderEdits, pendingInvoiceCancels, pendingPaymentMethodAdjustments] = await adminLayoutPerfRun("layout.kpi", async () => {
    const pendingOrderEdits = await getPendingOrderEditRequestCount().catch(() => 0);
    const pendingInvoiceCancels = await getPendingInvoiceCancelRequestCount().catch(() => 0);
    const pendingPaymentMethodAdjustments = await getPendingPaymentMethodAdjustmentCount().catch(() => 0);
    return [pendingOrderEdits, pendingInvoiceCancels, pendingPaymentMethodAdjustments] as const;
  });
  const navBadges =
    pendingOrderEdits > 0 || pendingInvoiceCancels > 0 || pendingPaymentMethodAdjustments > 0
      ? {
          pendingOrderEditRequests: pendingOrderEdits,
          pendingInvoiceCancelRequests: pendingInvoiceCancels,
          pendingPaymentMethodAdjustments,
        }
      : undefined;
  return <AdminSidebar groups={groups} homeItem={homeItem} navBadges={navBadges} />;
}
