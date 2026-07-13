"use client";

import { formatUsdDisplay } from "@/lib/money-format";
import type { CustomerDebtBreakdownDto } from "@/lib/customer-debt-breakdown-types";

function money(n: number): string {
  return `$${formatUsdDisplay(n)}`;
}

export function CustomerDebtSummary({ data }: { data: CustomerDebtBreakdownDto }) {
  const s = data.summary;
  const cards = [
    { label: "חוב כולל", value: money(s.currentDebt), tone: "debt" },
    { label: "מספר הזמנות פתוחות", value: String(s.openOrdersCount), tone: "neutral" },
    { label: "סכום מקור כולל", value: money(s.totalOriginalAmount), tone: "neutral" },
    { label: "עמלות", value: money(s.totalCommission), tone: "neutral" },
    { label: "שולם בפועל", value: money(s.totalPaid), tone: "paid" },
    { label: "יתרה פתוחה", value: money(s.openOrdersDebt), tone: "open" },
  ];

  return (
    <div className="debt-breakdown-summary" dir="rtl">
      {cards.map((c) => (
        <div key={c.label} className={`debt-breakdown-summary__card is-${c.tone}`}>
          <span className="debt-breakdown-summary__label">{c.label}</span>
          <strong className="debt-breakdown-summary__value" dir="ltr">
            {c.value}
          </strong>
        </div>
      ))}
      {s.creditUsd > 0.01 ? (
        <div className="debt-breakdown-summary__card is-credit">
          <span className="debt-breakdown-summary__label">יתרת זכות</span>
          <strong className="debt-breakdown-summary__value" dir="ltr">
            {money(s.creditUsd)}
          </strong>
        </div>
      ) : null}
    </div>
  );
}

export default CustomerDebtSummary;
