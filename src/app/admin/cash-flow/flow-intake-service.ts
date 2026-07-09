/**
 * טעינת «כספים שהתקבלו» — מקור: CashDailyDrawerCount בלבד (ספירת קופה מאושרת).
 * אין גישה ל-Payment.
 */

import { loadFlowWeekApprovedSummary } from "@/lib/flow-control/services/cash-count-summary-service";
import type { CashDailyWeekSummaryPayload } from "@/app/admin/cash-control/daily-types";

export { FLOW_COUNTRY_LABEL } from "@/lib/flow-control/services/cash-count-summary-service";

export async function loadFlowWeekReceivedSummary(week: string): Promise<CashDailyWeekSummaryPayload | null> {
  return loadFlowWeekApprovedSummary(week);
}

/** @deprecated — בקרת תזרים אינה מציגה פירוט קליטות תשלום */
export async function loadFlowDayIntakes(_input: {
  week: string;
  dateYmd: string;
  column: string;
}): Promise<[]> {
  return [];
}
