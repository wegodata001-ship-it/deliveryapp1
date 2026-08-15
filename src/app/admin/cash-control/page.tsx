import { requireRoutePermission } from "@/lib/route-access";
import { CashControlClient } from "@/components/admin/CashControlDailyClient";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import { isAdminUser } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function CashControlPage() {
  const me = await requireRoutePermission(["view_payment_control"]);
  return (
    <CashControlClient
      isAdmin={isAdminUser(me)}
      initialWeek={ACTIVE_WORK_WEEK_CODE}
      currentUserId={me.id}
      currentUserName={me.fullName?.trim() || me.email || ""}
    />
  );
}
