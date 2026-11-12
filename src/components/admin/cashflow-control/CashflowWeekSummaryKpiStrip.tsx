"use client";

import { useMemo, useState } from "react";
import type { FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import {
  aggregateWeekReceiptSummaryTotals,
  money,
  moneyManagerCount,
} from "@/components/admin/cashflow-control/cashflow-control-helpers";
import {
  CashflowKpiDrillModal,
  type CashflowKpiUiKind,
} from "@/components/admin/cashflow-control/CashflowKpiDrillModal";
import type { CashflowKpiKind } from "@/lib/flow-control/services/cashflow-kpi-drill-service";
import {
  WEEK_FIFO_COLLECTIBLE_DETAIL,
  WEEK_FIFO_COLLECTIBLE_LABEL,
  WEEK_ORDER_DEBT_DETAIL,
  WEEK_ORDER_DEBT_LABEL,
} from "@/lib/flow-control/week-debt-metrics";

type ClickableKpiKind = Extract<
  CashflowKpiKind,
  | "managerCashIls"
  | "managerCashUsd"
  | "managerTransferIls"
  | "managerCreditIls"
  | "managerChecksIls"
  | "remainingToPay"
>;

type KpiCard =
  | {
      kind: "static";
      label: string;
      renderValue: (totals: ReturnType<typeof aggregateWeekReceiptSummaryTotals>) => string;
    }
  | {
      kind: ClickableKpiKind;
      label: string;
      renderValue: (totals: ReturnType<typeof aggregateWeekReceiptSummaryTotals>) => string;
      clickable: true;
    };

const KPI_CARD_META: Record<
  string,
  { tone: string; kind?: ClickableKpiKind | "static" }
> = {
  'סה"כ הזמנות': { tone: "cfc-week-summary-kpis__card--orders" },
  'סה"כ דוח': { tone: "cfc-week-summary-kpis__card--report" },
  "נקלט מקליטת תשלום": { tone: "cfc-week-summary-kpis__card--intake" },
  "ספירת מנהל · מזומן ₪": { tone: "cfc-week-summary-kpis__card--cash-ils", kind: "managerCashIls" },
  "ספירת מנהל · מזומן $": { tone: "cfc-week-summary-kpis__card--cash-usd", kind: "managerCashUsd" },
  "ספירת מנהל · העברה ₪": { tone: "cfc-week-summary-kpis__card--transfer", kind: "managerTransferIls" },
  "ספירת מנהל · אשראי ₪": { tone: "cfc-week-summary-kpis__card--credit", kind: "managerCreditIls" },
  "ספירת מנהל · צ'קים ₪": { tone: "cfc-week-summary-kpis__card--checks", kind: "managerChecksIls" },
  [WEEK_ORDER_DEBT_LABEL]: { tone: "cfc-week-summary-kpis__card--debt", kind: "remainingToPay" },
  [WEEK_FIFO_COLLECTIBLE_LABEL]: { tone: "cfc-week-summary-kpis__card--debt" },
};

const KPI_CARDS: KpiCard[] = [
  {
    kind: "static",
    label: 'סה"כ הזמנות',
    renderValue: (t) => t.totalOrders.toLocaleString("he-IL"),
  },
  {
    kind: "static",
    label: 'סה"כ דוח',
    renderValue: (t) => money("USD", t.totalOrdersUsd),
  },
  {
    kind: "static",
    label: "נקלט מקליטת תשלום ₪",
    renderValue: (t) => money("ILS", t.paymentIntakeIls),
  },
  {
    kind: "remainingToPay",
    label: WEEK_ORDER_DEBT_LABEL,
    renderValue: (t) => money("USD", t.remainingToPayUsd),
    clickable: true,
  },
  {
    kind: "static",
    label: WEEK_FIFO_COLLECTIBLE_LABEL,
    renderValue: (t) => money("USD", t.collectibleAfterFifoUsd),
  },
  {
    kind: "static",
    label: "יתרות זכות",
    renderValue: (t) => money("USD", t.customerCreditUsd),
  },
  {
    kind: "static",
    label: "הפרש ספרים",
    renderValue: (t) => money("USD", t.booksNetUsd),
  },
  {
    kind: "static",
    label: "התקבל · העברה $",
    renderValue: (t) => money("USD", t.receivedBankUsd),
  },
  {
    kind: "static",
    label: "התקבל · אשראי $",
    renderValue: (t) => money("USD", t.receivedCreditUsd),
  },
  {
    kind: "static",
    label: "התקבל · צ'קים $",
    renderValue: (t) => money("USD", t.receivedCheckUsd),
  },
  {
    kind: "managerCashIls",
    label: "ספירת מנהל · מזומן ₪",
    renderValue: (t) => moneyManagerCount("ILS", t.managerCashIls != null ? String(t.managerCashIls) : null),
    clickable: true,
  },
  {
    kind: "managerCashUsd",
    label: "ספירת מנהל · מזומן $",
    renderValue: (t) => moneyManagerCount("USD", t.managerCashUsd != null ? String(t.managerCashUsd) : null),
    clickable: true,
  },
  {
    kind: "managerTransferIls",
    label: "ספירת מנהל · העברה ₪",
    renderValue: (t) => moneyManagerCount("ILS", t.managerTransferIls != null ? String(t.managerTransferIls) : null),
    clickable: true,
  },
  {
    kind: "managerCreditIls",
    label: "ספירת מנהל · אשראי ₪",
    renderValue: (t) => moneyManagerCount("ILS", t.managerCreditIls != null ? String(t.managerCreditIls) : null),
    clickable: true,
  },
  {
    kind: "managerChecksIls",
    label: "ספירת מנהל · צ'קים ₪",
    renderValue: (t) => moneyManagerCount("ILS", t.managerChecksIls != null ? String(t.managerChecksIls) : null),
    clickable: true,
  },
];

export type CashflowWeekSummaryKpiStripProps = {
  rows: FlowWeekOverviewRow[];
};

export function CashflowWeekSummaryKpiStrip({ rows }: CashflowWeekSummaryKpiStripProps) {
  const totals = useMemo(() => aggregateWeekReceiptSummaryTotals(rows), [rows]);
  const weekCodes = useMemo(() => rows.map((r) => r.week), [rows]);
  const [drillKind, setDrillKind] = useState<CashflowKpiUiKind | null>(null);

  if (rows.length === 0) return null;

  return (
    <>
      <div className="cfc-week-summary-kpis" aria-label="סיכום שבועי לפי אמצעי תקבול">
        {KPI_CARDS.map((card) => {
          const value = card.renderValue(totals);
          if (card.kind === "static") {
            return (
              <div
                key={card.label}
                className={[
                  "cfc-week-summary-kpis__card",
                  "cfc-week-summary-kpis__card--static",
                  KPI_CARD_META[card.label]?.tone ?? "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                title={
                  card.label === "הפרש ספרים"
                    ? "סכום החובות הפתוחים פחות סכום יתרות הזכות. אינו סכום לגבייה ואינו קיזוז בין לקוחות."
                    : card.label === WEEK_FIFO_COLLECTIBLE_LABEL
                      ? WEEK_FIFO_COLLECTIBLE_DETAIL
                      : undefined
                }
              >
                <span>{card.label}</span>
                <strong dir="ltr">{value}</strong>
              </div>
            );
          }
          return (
            <button
              key={card.kind}
              type="button"
              className={[
                "cfc-week-summary-kpis__card",
                KPI_CARD_META[card.label]?.tone ?? "",
                card.kind === "remainingToPay" ? "cfc-week-summary-kpis__card--debt" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setDrillKind(card.kind)}
              title={card.kind === "remainingToPay" ? WEEK_ORDER_DEBT_DETAIL : "לחץ לפירוט"}
            >
              <span>{card.label}</span>
              <strong dir="ltr">{value}</strong>
            </button>
          );
        })}
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
