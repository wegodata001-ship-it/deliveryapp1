"use client";

import { Check } from "lucide-react";
import { formatMoneyAmount } from "@/lib/money-format";
import { formatSignedUsdDisplay } from "@/lib/debt-withdrawal-order";
import type { OrdersResultSummary, OrdersResultSummaryLine } from "@/lib/orders-list-result-summary";
import type { OrdersKpiFilterKey } from "@/lib/orders-status-kpi-filter";

function moneyCell(n: number): string {
  if (n < -0.0001) return `$${formatSignedUsdDisplay(n)}`;
  return `$${formatMoneyAmount(n)}`;
}

const TONE: Record<OrdersKpiFilterKey, string> = {
  open: "orsb--open",
  inProgress: "orsb--progress",
  completed: "orsb--completed",
  operationalCompleted: "orsb--operational",
  debtWithdrawal: "orsb--withdrawal",
  cancelled: "orsb--cancelled",
};

function SummaryBar({
  line,
  compact = false,
  isTotal = false,
}: {
  line: OrdersResultSummaryLine;
  compact?: boolean;
  isTotal?: boolean;
}) {
  const tone = isTotal || line.key === "total" ? "orsb--grand" : TONE[line.key];
  const countLabel = `${line.count.toLocaleString("he-IL")} הזמנות`;
  const balanceZero = Math.abs(line.balanceUsd) <= 0.01;

  return (
    <article
      className={["orsb", tone, compact ? "orsb--compact" : ""].filter(Boolean).join(" ")}
      data-summary-key={line.key}
      data-total-count={isTotal || line.key === "total" ? line.count : undefined}
    >
      <div className="orsb__status">
        <span className="orsb__icon" aria-hidden>
          {isTotal ? <span className="orsb__sigma">Σ</span> : <Check size={18} strokeWidth={2.4} />}
        </span>
        <div className="orsb__status-text">
          <strong className="orsb__title">{isTotal ? "סה״כ" : line.label}</strong>
          <span className="orsb__count">{countLabel}</span>
        </div>
      </div>
      <div className="orsb__metric orsb__metric--deal">
        <span className="orsb__label">לפני עמלה</span>
        <strong className="orsb__value" dir="ltr">
          {moneyCell(line.dealUsd)}
        </strong>
      </div>
      <div className="orsb__metric orsb__metric--gross">
        <span className="orsb__label">כולל עמלה</span>
        <strong className="orsb__value" dir="ltr">
          {moneyCell(line.totalUsd)}
        </strong>
      </div>
      <div className="orsb__metric orsb__metric--balance">
        <span className="orsb__label">יתרה</span>
        <strong className={["orsb__value", balanceZero ? "orsb__value--zero" : ""].filter(Boolean).join(" ")} dir="ltr">
          {moneyCell(line.balanceUsd)}
        </strong>
      </div>
    </article>
  );
}

export function OrdersResultSummaryTable({
  summary,
  selectedCount = 0,
}: {
  summary: OrdersResultSummary;
  selectedCount?: number;
}) {
  const showTotal = selectedCount !== 1;
  const allMode = selectedCount === 0;

  return (
    <section
      className="adm-orders-result-summary"
      dir="rtl"
      aria-label="סיכום התוצאות"
      data-testid="orders-result-summary"
      data-total-count={summary.total.count}
    >
      <h2 className="adm-orders-result-summary__sr">סיכום התוצאות</h2>
      <div className="orsb-stack">
        {allMode ? <SummaryBar line={{ ...summary.total, label: "סה״כ" }} isTotal /> : null}
        {summary.lines.map((line) => (
          <SummaryBar key={line.key} line={line} compact={allMode} />
        ))}
        {showTotal && !allMode ? <SummaryBar line={summary.total} isTotal /> : null}
      </div>
    </section>
  );
}
