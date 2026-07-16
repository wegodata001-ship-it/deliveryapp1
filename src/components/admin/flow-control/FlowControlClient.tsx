"use client";

import type { CashFlowCapabilities } from "@/app/admin/cash-flow/types";
import { CashflowControlScreen } from "@/components/admin/cashflow-control/CashflowControlScreen";

/** נקודת כניסה למסך בקרת תזרים — UI חדש בלבד, אותן actions/לוגיקה */
export function FlowControlClient({
  caps,
  initialWeek,
}: {
  caps: CashFlowCapabilities;
  initialWeek: string;
}) {
  return <CashflowControlScreen caps={caps} initialWeek={initialWeek} />;
}

export default FlowControlClient;
