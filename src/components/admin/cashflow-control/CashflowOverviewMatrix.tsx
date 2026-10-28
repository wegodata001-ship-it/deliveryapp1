"use client";

import type { FlowWeekDrillPayload, FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import { money } from "@/components/admin/cashflow-control/cashflow-control-helpers";
import { fmtOpening } from "@/components/admin/cashflow-control/cashflow-cashbox-display";
import { summarizeWeekFxTracks } from "@/lib/flow-control/services/fx-week-summary.shared";

type MatrixRow = {
  label: string;
  ps: string;
  il: string;
  total: string;
};

function cellMoney(currency: "ILS" | "USD", v: string | null | undefined): string {
  if (v == null || v === "") return "—";
  return money(currency, v);
}

export function CashflowOverviewMatrix({
  row,
  drill,
}: {
  row: FlowWeekOverviewRow;
  drill: FlowWeekDrillPayload | null;
}) {
  const flow = drill?.flow;
  const fx = summarizeWeekFxTracks(flow?.fxPurchases);
  const usd = flow?.cashboxes.usd;
  const ils = flow?.cashboxes.ils;

  const rows: MatrixRow[] = [
    {
      label: "יתרת פתיחה",
      ps: usd ? fmtOpening(usd, "USD", flow?.cashboxes.openingMessageHe ?? "") : "—",
      il: ils ? fmtOpening(ils, "ILS", flow?.cashboxes.openingMessageHe ?? "") : "—",
      total: "—",
    },
    {
      label: "תקבולים (קליטה)",
      ps: `${cellMoney("USD", row.intakePsUsd ?? row.receivedCashUsd)} · ${cellMoney("ILS", row.intakePsIls ?? row.receivedCashIls)}`,
      il: `${cellMoney("USD", row.intakeIlUsd)} · ${cellMoney("ILS", row.intakeIlIls ?? row.receivedBankTransferIls)}`,
      total: `${cellMoney("USD", row.receivedCashUsd)} + ${cellMoney("ILS", row.paymentIntakeIls)} (נפרד)`,
    },
    {
      label: "רכישת מט״ח",
      ps: `${money("ILS", fx.ps.ils)} → ${money("USD", fx.ps.usd)}`,
      il: `${money("ILS", fx.il.ils)} → ${money("USD", fx.il.usd)}`,
      total: "—",
    },
    {
      label: "העברות",
      ps: cellMoney("USD", row.turkeyTransferredUsd),
      il: cellMoney("ILS", row.turkeyTransferIls),
      total: "—",
    },
    {
      label: "עמלות",
      ps: cellMoney("USD", row.commissionUsd),
      il: cellMoney("ILS", row.commissionIls),
      total: "—",
    },
    {
      label: "יתרת סגירה",
      ps: cellMoney("USD", row.drawerRemainingUsd),
      il: cellMoney("ILS", row.drawerRemainingIls ?? row.bankBalanceIls),
      total: "—",
    },
  ];

  return (
    <div className="cfc-table-scroll cfc-table-scroll--tight">
      <table className="cfc-table cfc-compact-table cfc-matrix-table">
        <thead>
          <tr>
            <th>נתון</th>
            <th>PS</th>
            <th>IL</th>
            <th>סה״כ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td dir="ltr">{r.ps}</td>
              <td dir="ltr">{r.il}</td>
              <td dir="ltr">{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="cfc-matrix-note">סה״כ — רק ערכים באותה יחידה; אין חיבור ₪ ו-$ ללא שער מתועד.</p>
    </div>
  );
}
