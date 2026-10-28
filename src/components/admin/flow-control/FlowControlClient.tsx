"use client";

import { Suspense } from "react";
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
  return (
    <Suspense
      fallback={
        <div className="cfc-page" dir="rtl">
          <p className="cfc-empty">טוען בקרת תזרים…</p>
        </div>
      }
    >
      <CashflowControlScreen caps={caps} initialWeek={initialWeek} />
    </Suspense>
  );
}

export default FlowControlClient;
