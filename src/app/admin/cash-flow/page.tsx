import { requireRoutePermission } from "@/lib/route-access";
import { getCashFlowCapabilitiesAction } from "@/app/admin/cash-flow/actions";
import { FlowControlClient } from "@/components/admin/flow-control/FlowControlClient";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";

export const dynamic = "force-dynamic";

export default async function CashFlowPage() {
  await requireRoutePermission(["cashflow.view", "view_payment_control"]);
  const caps = await getCashFlowCapabilitiesAction();
  return <FlowControlClient caps={caps} initialWeek={ACTIVE_WORK_WEEK_CODE} />;
}
