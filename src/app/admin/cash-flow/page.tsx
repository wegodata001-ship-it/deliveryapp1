import { requireRoutePermission } from "@/lib/route-access";
import { getCashFlowCapabilitiesAction } from "@/app/admin/cash-flow/actions";
import { CashFlowControlClient } from "@/components/admin/CashFlowControlClient";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";

export const dynamic = "force-dynamic";

export default async function CashFlowPage() {
  await requireRoutePermission(["cashflow.view", "view_payment_control"]);
  const caps = await getCashFlowCapabilitiesAction();
  return <CashFlowControlClient caps={caps} initialWeek={ACTIVE_WORK_WEEK_CODE} />;
}
