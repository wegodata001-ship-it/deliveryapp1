"use client";

import { AlertTriangle, Search } from "lucide-react";
import { formatUsdDisplay } from "@/lib/money-format";
import type { CustomerDebtBreakdownDto } from "@/lib/customer-debt-breakdown-types";

function money(n: number): string {
  return `$${formatUsdDisplay(n)}`;
}

export function DebtMismatchAlert({
  data,
  onInspectSources,
}: {
  data: CustomerDebtBreakdownDto;
  onInspectSources?: () => void;
}) {
  if (!data.mismatch && Math.abs(data.totals.unexplainedDifference) <= 0.02) return null;

  const { totals } = data;

  return (
    <div className="debt-breakdown-mismatch" role="alert">
      <div className="debt-breakdown-mismatch__head">
        <AlertTriangle size={18} aria-hidden />
        <strong>נמצאה אי־התאמה בחוב</strong>
      </div>
      <ul className="debt-breakdown-mismatch__list">
        <li>
          <span>חוב בכרטסת:</span>
          <strong dir="ltr">{money(totals.currentDebt)}</strong>
        </li>
        <li>
          <span>יתרות הזמנות פתוחות (כלליות):</span>
          <strong dir="ltr">{money(totals.openOrdersDebtAll)}</strong>
        </li>
        {totals.openOrdersDebtHidden > 0.01 ? (
          <li>
            <span>מתוכן מחוץ לשבוע הקליטה:</span>
            <strong dir="ltr">{money(totals.openOrdersDebtHidden)}</strong>
          </li>
        ) : null}
        <li>
          <span>הפרש לא מוסבר:</span>
          <strong dir="ltr" className="debt-breakdown-mismatch__diff">
            {money(Math.abs(totals.unexplainedDifference))}
          </strong>
        </li>
      </ul>
      {onInspectSources ? (
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--dense debt-breakdown-mismatch__btn" onClick={onInspectSources}>
          <Search size={14} aria-hidden /> בדוק מקור הפרש
        </button>
      ) : null}
    </div>
  );
}

export default DebtMismatchAlert;
