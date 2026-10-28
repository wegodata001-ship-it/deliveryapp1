"use client";

import type { FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";

export function CashflowWeekContextBanner({ row }: { row: FlowWeekOverviewRow | null }) {
  if (!row) return null;
  const byIntake = row.paymentsReceivedInWeek ?? 0;
  const byCode = row.paymentsByWeekCodeOnly ?? 0;
  if (byIntake === byCode) return null;
  return (
    <div className="cfc-week-context-banner" role="status">
      <strong>הפרדת שבועות:</strong> נוצרו השבוע {row.totalOrders} (${row.totalOrdersUsd}) · לגבייה{" "}
      {row.ordersDueCount ?? 0} מ-{row.ordersDueSourceWeek ?? "—"} (${row.ordersDueUsd ?? "0"}). תקבולים
      לפי קליטה: <span dir="ltr">{byIntake}</span> · weekCode={row.week}:{" "}
      <span dir="ltr">{byCode}</span>. אין להשוות ישירות הזמנות לתקבולים.
    </div>
  );
}
