"use client";

import { useMemo, useState } from "react";
import type { FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import {
  aggregateReceiptMethodTotals,
  aggregateTurkeyReceiptTotals,
  money,
} from "@/components/admin/cashflow-control/cashflow-control-helpers";
import {
  CashflowKpiDrillModal,
  type CashflowKpiUiKind,
} from "@/components/admin/cashflow-control/CashflowKpiDrillModal";
import type { CashflowKpiKind } from "@/lib/flow-control/services/cashflow-kpi-drill-service";

const KPI_CARDS: {
  kind: CashflowKpiKind;
  label: string;
  currency: "ILS" | "USD";
  field: keyof ReturnType<typeof aggregateReceiptMethodTotals>;
}[] = [
  { kind: "cashIls", label: "סה\"כ מזומן ₪", currency: "ILS", field: "cashIls" },
  { kind: "cashUsd", label: "סה\"כ דולר $", currency: "USD", field: "cashUsd" },
  { kind: "bankTransferIls", label: "סה\"כ העברות ₪", currency: "ILS", field: "bankTransferIls" },
  { kind: "creditIls", label: "סה\"כ אשראי ₪", currency: "ILS", field: "creditIls" },
  { kind: "checkIls", label: "סה\"כ צ'קים ₪", currency: "ILS", field: "checksIls" },
];

export type CashflowWeekSummaryKpiStripProps = {
  rows: FlowWeekOverviewRow[];
};

export function CashflowWeekSummaryKpiStrip({ rows }: CashflowWeekSummaryKpiStripProps) {
  const totals = useMemo(() => aggregateReceiptMethodTotals(rows), [rows]);
  const turkeyTotals = useMemo(() => aggregateTurkeyReceiptTotals(rows), [rows]);
  const weekCodes = useMemo(() => rows.map((r) => r.week), [rows]);
  const [drillKind, setDrillKind] = useState<CashflowKpiUiKind | null>(null);

  if (rows.length === 0) return null;

  return (
    <>
      <div className="cfc-week-summary-kpis" aria-label="סיכום תקבולים לפי אמצעי">
        {KPI_CARDS.map((card) => (
          <button
            key={card.kind}
            type="button"
            className="cfc-week-summary-kpis__card"
            onClick={() => setDrillKind(card.kind)}
            title="לחץ לפירוט תקבולים"
          >
            <span>{card.label}</span>
            <strong dir="ltr">{money(card.currency, totals[card.field])}</strong>
          </button>
        ))}

        <button
          type="button"
          className="cfc-week-summary-kpis__card cfc-week-summary-kpis__card--turkey"
          onClick={() => setDrillKind("turkeyReceipts")}
          title="לחץ לפירוט כל התקבולים לטורקיה"
        >
          <span>סה&quot;כ לטורקיה</span>
          <div className="cfc-week-summary-kpis__dual" dir="ltr">
            <strong>{money("ILS", turkeyTotals.totalIls)}</strong>
            <strong>{money("USD", turkeyTotals.totalUsd)}</strong>
          </div>
        </button>
      </div>

      <CashflowKpiDrillModal
        open={drillKind != null}
        kind={drillKind}
        weekCodes={weekCodes}
        weekRows={rows}
        onClose={() => setDrillKind(null)}
      />
    </>
  );
}

export default CashflowWeekSummaryKpiStrip;
