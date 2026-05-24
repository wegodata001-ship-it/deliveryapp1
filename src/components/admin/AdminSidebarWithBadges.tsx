import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { getPendingOrderEditRequestCount } from "@/lib/admin-layout-cache";
import type { NavSectionDef } from "@/lib/sidebar-nav";

type Props = {
  sections: NavSectionDef[];
  showPendingBadge: boolean;
};

/** Sidebar + badge בקשות עריכה — נטען ב-Suspense, לא חוסם shell */
export async function AdminSidebarWithBadges({ sections, showPendingBadge }: Props) {
  if (!showPendingBadge) {
    return <AdminSidebar sections={sections} />;
  }
  const pending = await getPendingOrderEditRequestCount().catch(() => 0);
  return (
    <AdminSidebar
      sections={sections}
      navBadges={pending > 0 ? { pendingOrderEditRequests: pending } : undefined}
    />
  );
}
