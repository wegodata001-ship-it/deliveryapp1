"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { FlowRangeAggregate } from "@/components/admin/cashflow-control/cashflow-control-helpers";
import { money } from "@/components/admin/cashflow-control/cashflow-control-helpers";
import type { FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import {
  CashflowKpiDrillModal,
  type CashflowKpiUiKind,
} from "@/components/admin/cashflow-control/CashflowKpiDrillModal";

export function CashflowRangeSummary({
  agg,
  focusWeek,
  weekRows,
}: {
  agg: FlowRangeAggregate;
  focusWeek: string;
  weekRows: FlowWeekOverviewRow[];
}) {
  const single = agg.fromWeek === agg.toWeek;
  const [drillKind, setDrillKind] = useState<CashflowKpiUiKind | null>(null);
  const weekCodes = useMemo(() => weekRows.map((r) => r.week), [weekRows]);

  const cards: { kind: CashflowKpiUiKind; label: string; value: ReactNode }[] = [
    {
      kind: "receipts",
      label: "קליטות ₪",
      value: <strong dir="ltr">{money("ILS", agg.totalReceivedIls)}</strong>,
    },
    {
      kind: "fxPs",
      label: "מט״ח PS",
      value: (
        <strong dir="ltr">
          {money("ILS", agg.fxPurchaseIls)} · {money("USD", agg.fxPurchaseUsd)}
        </strong>
      ),
    },
    {
      kind: "fxProfit",
      label: "רווח שער",
      value: <strong dir="ltr">{money("ILS", agg.fxNetIls)}</strong>,
    },
    {
      kind: "expenses",
      label: "הוצאות",
      value: <strong dir="ltr">{money("ILS", agg.expensesIls)}</strong>,
    },
    {
      kind: "turkeyTransferred",
      label: "הועבר לטורקיה",
      value: <strong dir="ltr">{money("USD", agg.turkeyTransferredUsd)}</strong>,
    },
    {
      kind: "turkeyClosing",
      label: "יתרת טורקיה (סגירה)",
      value: <strong dir="ltr">{money("USD", agg.turkeyClosingUsd)}</strong>,
    },
    {
      kind: "weeksOk",
      label: "שבועות תקינים",
      value: <strong>{agg.okWeekCount}</strong>,
    },
    {
      kind: "weeksAlert",
      label: "שבועות חריגים / ממתינים",
      value: (
        <strong>
          {agg.alertWeekCount} / {agg.pendingWeekCount}
        </strong>
      ),
    },
  ];

  return (
    <section className="cfc-range-summary" aria-label="סיכום טווח שבועות">
      <header>
        <h2>
          {single ? (
            <>
              שבוע <span dir="ltr">{agg.fromWeek}</span>
            </>
          ) : (
            <>
              טווח <span dir="ltr">{agg.fromWeek}</span>
              {" → "}
              <span dir="ltr">{agg.toWeek}</span>
              <span className="cfc-range-summary__count"> · {agg.weekCount} שבועות</span>
            </>
          )}
        </h2>
        {!single ? (
          <p>
            נתונים מצטברים לטווח · פירוט טבלאות מציג את שבוע{" "}
            <span dir="ltr">{focusWeek}</span> (בחרו שורה בטבלה לשינוי)
          </p>
        ) : null}
        <p className="cfc-range-summary__hint">לחצו על כרטיס לפירוט מלא של מקור המספר</p>
      </header>
      <div className="cfc-range-summary__grid">
        {cards.map((card) => (
          <button
            key={card.kind}
            type="button"
            className="cfc-range-summary__card"
            onClick={() => setDrillKind(card.kind)}
          >
            <span>{card.label}</span>
            {card.value}
          </button>
        ))}
      </div>

      <CashflowKpiDrillModal
        open={drillKind != null}
        kind={drillKind}
        weekCodes={weekCodes}
        weekRows={weekRows}
        onClose={() => setDrillKind(null)}
      />
    </section>
  );
}

export default CashflowRangeSummary;
