"use client";

import { useMemo } from "react";
import type { FlowWeekDrillPayload, FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import {
  amountToneClass,
  money,
  signedMoney,
} from "@/components/admin/cashflow-control/cashflow-control-helpers";
import { cashboxKpiDisplay } from "@/components/admin/cashflow-control/cashflow-cashbox-display";
import { fcNum } from "@/components/admin/flow-control/shared";
import { buildFlowBusinessReconciliation } from "@/lib/flow-control/flow-week-business-reconciliation";

export function CashflowPrimaryKpiStrip({
  row,
  drill,
  loading,
  onOpenAnomalies,
}: {
  row: FlowWeekOverviewRow | null;
  drill: FlowWeekDrillPayload | null;
  loading?: boolean;
  onOpenAnomalies: () => void;
}) {
  const recon = useMemo(() => {
    if (!row) return null;
    return buildFlowBusinessReconciliation({
      drill,
      overview: row,
      week: row.week,
    });
  }, [drill, row]);

  if (!row) return null;

  const verified = recon?.verifiedExceptionCount ?? 0;
  const usdBox = cashboxKpiDisplay(drill?.flow, "USD");
  const ilsBox = cashboxKpiDisplay(drill?.flow, "ILS");
  const turkeyClosing = fcNum(row.turkeyClosingUsd);

  const cards = [
    {
      key: "orders",
      label: "הזמנות לגבייה",
      value: (row.ordersDueCount ?? 0).toLocaleString("he-IL"),
      sub:
        row.ordersDueSourceWeek != null
          ? `מ-${row.ordersDueSourceWeek} · ${money("USD", row.ordersDueUsd)} · נוצרו השבוע ${row.totalOrders}`
          : money("USD", row.ordersDueUsd ?? row.totalOrdersUsd),
      tone: "",
    },
    {
      key: "intake",
      label: "תקבולים בפועל",
      value: money("ILS", row.paymentIntakeIls),
      sub: `${row.paymentsReceivedInWeek ?? 0} תשלומים`,
      tone: amountToneClass(fcNum(row.paymentIntakeIls)),
    },
    {
      key: "usd",
      label: "קופת דולר",
      value: usdBox.value,
      sub: usdBox.sub,
      tone: usdBox.tone,
    },
    {
      key: "ils",
      label: "קופת שקל",
      value: ilsBox.value,
      sub: ilsBox.sub,
      tone: ilsBox.tone,
    },
    {
      key: "turkey",
      label: "יתרה לטורקיה",
      value: signedMoney("USD", turkeyClosing),
      sub: `הועבר ${money("USD", row.turkeyTransferredUsd)}`,
      tone: amountToneClass(turkeyClosing),
    },
    {
      key: "variance",
      label: "פערים מאומתים",
      value: verified > 0 ? `${verified}` : "0",
      sub: verified > 0 ? "לחץ לפירוט" : "אין פער כספי מאומת",
      tone: verified > 0 ? "cfc-amt--debt" : "",
      action: onOpenAnomalies,
    },
  ];

  return (
    <section className="cfc-primary-kpis cfc-primary-kpis--compact" aria-label="מדדים מרכזיים">
      {cards.map((c) => {
        const inner = (
          <>
            <span className="cfc-primary-kpis__label">{c.label}</span>
            <strong dir="ltr" className={["cfc-primary-kpis__value", c.tone].filter(Boolean).join(" ")}>
              {loading && c.key !== "orders" ? "…" : c.value}
            </strong>
            {c.sub ? (
              <small dir="ltr" className="cfc-primary-kpis__sub">
                {c.sub}
              </small>
            ) : null}
          </>
        );
        if (c.action) {
          return (
            <button
              key={c.key}
              type="button"
              className="cfc-primary-kpis__card cfc-primary-kpis__card--btn"
              onClick={c.action}
            >
              {inner}
            </button>
          );
        }
        return (
          <div key={c.key} className="cfc-primary-kpis__card">
            {inner}
          </div>
        );
      })}
    </section>
  );
}
