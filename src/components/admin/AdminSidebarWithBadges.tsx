import { AdminSidebar } from "@/components/admin/AdminSidebar";
import {
  getPendingInvoiceCancelRequestCount,
  getPendingOrderEditRequestCount,
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
  const [pendingOrderEdits, pendingInvoiceCancels] = await adminLayoutPerfRun("layout.kpi", async () => {
    const pendingOrderEdits = await getPendingOrderEditRequestCount().catch(() => 0);
    const pendingInvoiceCancels = await getPendingInvoiceCancelRequestCount().catch(() => 0);
    return [pendingOrderEdits, pendingInvoiceCancels] as const;
  });
  const navBadges =
    pendingOrderEdits > 0 || pendingInvoiceCancels > 0
      ? {
          pendingOrderEditRequests: pendingOrderEdits,
          pendingInvoiceCancelRequests: pendingInvoiceCancels,
        }
      : undefined;
  return <AdminSidebar groups={groups} homeItem={homeItem} navBadges={navBadges} />;
}
