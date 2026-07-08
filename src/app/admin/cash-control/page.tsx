import { CashControlClient } from "@/components/admin/CashControlDailyClient";
import { requireRoutePermission } from "@/lib/route-access";
import { isAdminUser } from "@/lib/admin-auth";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";

export default async function CashControlPage() {
  const me = await requireRoutePermission(["view_payment_control"]);
  return <CashControlClient isAdmin={isAdminUser(me)} initialWeek={ACTIVE_WORK_WEEK_CODE} />;
}
