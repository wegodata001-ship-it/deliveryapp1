import { requireRoutePermission } from "@/lib/route-access";
import { isAdminUser } from "@/lib/admin-auth";
import { CashControlClient } from "@/components/admin/CashControlDailyClient";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";

export const dynamic = "force-dynamic";

export default async function ShipmentCashControlPage() {
  const me = await requireRoutePermission(["manage_shipments", "view_shipments"]);
  return (
    <CashControlClient
      mode="shipping"
      isAdmin={isAdminUser(me)}
      initialWeek={ACTIVE_WORK_WEEK_CODE}
      currentUserName={me.fullName?.trim() || me.email || ""}
    />
  );
}
