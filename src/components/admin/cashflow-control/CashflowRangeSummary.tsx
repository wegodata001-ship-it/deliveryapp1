"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { FlowRangeAggregate } from "@/components/admin/cashflow-control/cashflow-control-helpers";
import { money } from "@/components/admin/cashflow-control/cashflow-control-helpers";
import { fcNum } from "@/components/admin/flow-control/shared";
import type { FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import {
  CashflowKpiDrillModal,
  type CashflowKpiUiKind,
} from "@/components/admin/cashflow-control/CashflowKpiDrillModal";

const CARD_TONE: Partial<Record<CashflowKpiUiKind, string>> = {
  receipts: "cfc-range-summary__card--in",
  fxPs: "cfc-range-summary__card--fx-ps",
  fxIl: "cfc-range-summary__card--fx-il",
  fxProfit: "cfc-range-summary__card--fx-profit",
  expenses: "cfc-range-summary__card--out",
  turkeyTransferred: "cfc-range-summary__card--transfer",
  turkeyClosing: "cfc-range-summary__card--transfer",
};

function FxSummaryValue({
  usd,
  ils,
  rate,
  loading,
}: {
  usd: number;
  ils: number;
  rate: string | null | undefined;
  loading?: boolean;
}) {
  if (loading) return <strong dir="ltr">…</strong>;
  if (usd <= 0.005 && ils <= 0.005) {
    return <span className="cfc-range-summary__empty">אין רכישות</span>;
  }
  return (
    <span className="cfc-range-summary__fx-value">
      <strong dir="ltr">{money("USD", usd)}</strong>
      <small dir="ltr">
        {money("ILS", ils)} · {rate ? `שער ${rate}` : ""}
      </small>
    </span>
  );
}

export function CashflowRangeSummary({
  agg,
  focusWeek,
  weekRows,
  focusRow,
  loading,
}: {
  agg: FlowRangeAggregate;
  focusWeek: string;
  weekRows: FlowWeekOverviewRow[];
  focusRow?: FlowWeekOverviewRow | null;
  loading?: boolean;
}) {
  const single = agg.fromWeek === agg.toWeek;
  const [drillKind, setDrillKind] = useState<CashflowKpiUiKind | null>(null);
  const weekCodes = useMemo(() => weekRows.map((r) => r.week), [weekRows]);

  const psUsd = single && focusRow ? fcNum(focusRow.fxPurchaseUsd) : agg.fxPurchaseUsd;
  const psIls = single && focusRow ? fcNum(focusRow.fxPurchaseIls) : agg.fxPurchaseIls;
  const ilUsd = single && focusRow ? fcNum(focusRow.ilFxPurchaseUsd) : agg.ilFxPurchaseUsd;
  const ilIls = single && focusRow ? fcNum(focusRow.ilFxPurchaseIls) : agg.ilFxPurchaseIls;
  const psRate = single && focusRow ? focusRow.fxPsRate : null;
  const ilRate = single && focusRow ? focusRow.fxIlRate : null;

  const cards: { kind: CashflowKpiUiKind; label: string; value: ReactNode }[] = [
    {
      kind: "receipts",
      label: "① קליטות ₪",
      value: loading ? (
        <strong dir="ltr">…</strong>
      ) : (
        <strong dir="ltr">{money("ILS", agg.totalReceivedIls)}</strong>
      ),
    },
    {
      kind: "fxPs",
      label: "② מט״ח PS",
      value: (
        <FxSummaryValue usd={psUsd} ils={psIls} rate={psRate} loading={loading} />
      ),
    },
    {
      kind: "fxIl",
      label: "② מט״ח IL",
      value: (
        <FxSummaryValue usd={ilUsd} ils={ilIls} rate={ilRate} loading={loading} />
      ),
    },
    {
      kind: "fxProfit",
      label: "רווח שער",
      value: loading ? (
        <strong dir="ltr">…</strong>
      ) : (
        <strong dir="ltr">{money("ILS", agg.fxNetIls)}</strong>
      ),
    },
    {
      kind: "expenses",
      label: "③ הוצאות",
      value: loading ? (
        <strong dir="ltr">…</strong>
      ) : (
        <strong dir="ltr">{money("ILS", agg.expensesIls)}</strong>
      ),
    },
    {
      kind: "turkeyTransferred",
      label: "הועבר לטורקיה",
      value: loading ? (
        <strong dir="ltr">…</strong>
      ) : (
        <strong dir="ltr">{money("USD", agg.turkeyTransferredUsd)}</strong>
      ),
    },
    {
      kind: "turkeyClosing",
      label: "④ יתרת טורקיה",
      value: loading ? (
        <strong dir="ltr">…</strong>
      ) : (
        <strong dir="ltr">{money("USD", agg.turkeyClosingUsd)}</strong>
      ),
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
              שבוע <span dir="ltr">{focusWeek || agg.fromWeek}</span>
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
            className={["cfc-range-summary__card", CARD_TONE[card.kind] ?? ""].filter(Boolean).join(" ")}
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
