import { AdminSidebar } from "@/components/admin/AdminSidebar";
import {
  getPendingInvoiceCancelRequestCount,
  getPendingOrderEditRequestCount,
} from "@/lib/admin-layout-cache";
import { adminLayoutPerfRun } from "@/lib/admin-layout-perf";
import type { NavSectionDef } from "@/lib/sidebar-nav";

type Props = {
  sections: NavSectionDef[];
  showPendingBadge: boolean;
};

/** Sidebar + badge בקשות עריכה / ביטול חשbונית — נטען ב-Suspense */
export async function AdminSidebarWithBadges({ sections, showPendingBadge }: Props) {
  if (!showPendingBadge) {
    return <AdminSidebar sections={sections} />;
  }
  const [pendingOrderEdits, pendingInvoiceCancels] = await adminLayoutPerfRun("layout.kpi", () =>
    Promise.all([
      getPendingOrderEditRequestCount().catch(() => 0),
      getPendingInvoiceCancelRequestCount().catch(() => 0),
    ]),
  );
  const navBadges =
    pendingOrderEdits > 0 || pendingInvoiceCancels > 0
      ? {
          pendingOrderEditRequests: pendingOrderEdits,
          pendingInvoiceCancelRequests: pendingInvoiceCancels,
        }
      : undefined;
  return <AdminSidebar sections={sections} navBadges={navBadges} />;
}
