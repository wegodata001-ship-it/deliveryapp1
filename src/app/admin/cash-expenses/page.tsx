import { requireRoutePermission } from "@/lib/route-access";
import { getCashExpenseCapabilitiesAction } from "@/app/admin/cash-expenses/capabilities-action";
import { CashExpensesClient } from "@/components/admin/CashExpensesClient";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";

export const dynamic = "force-dynamic";

export default async function CashExpensesPage() {
  await requireRoutePermission(["manage_cash_expenses", "view_payment_control"]);
  const caps = await getCashExpenseCapabilitiesAction();
  return <CashExpensesClient caps={caps} initialWeek={ACTIVE_WORK_WEEK_CODE} />;
}
