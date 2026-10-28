"use client";

import type { FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";

export function CashflowWeekContextBanner({ row }: { row: FlowWeekOverviewRow | null }) {
  if (!row) return null;
  const byIntake = row.paymentsReceivedInWeek ?? 0;
  const byCode = row.paymentsByWeekCodeOnly ?? 0;
  if (byIntake === byCode) return null;
  return (
    <div className="cfc-week-context-banner" role="status">
      <strong>הפרדת שבועות:</strong> הזמנות לפי שבוע הזמנה ({row.totalOrders} · ${row.totalOrdersUsd}).
      תשלומים שהתקבלו בשבוע זה (תאריך קליטה): <span dir="ltr">{byIntake}</span>.
      תשלומים עם weekCode={row.week} (היסטורי): <span dir="ltr">{byCode}</span>.
    </div>
  );
}
