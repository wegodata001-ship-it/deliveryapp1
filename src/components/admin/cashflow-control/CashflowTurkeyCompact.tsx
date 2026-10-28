"use client";

import { useState } from "react";
import type { FlowWeekDrillPayload, FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import { money, signedMoney } from "@/components/admin/cashflow-control/cashflow-control-helpers";
import { fcNum } from "@/components/admin/flow-control/shared";
import { TurkeyMovementsTable } from "@/components/admin/flow-control/TurkeyMovementsTable";

export function CashflowTurkeyCompact({
  week,
  row,
  drill,
}: {
  week: string;
  row: FlowWeekOverviewRow;
  drill: FlowWeekDrillPayload | null;
}) {
  const [open, setOpen] = useState(false);
  const flow = drill?.flow;
  const t = flow?.turkeyBalance?.usd;
  if (!t) {
    return <p className="cfc-empty cfc-empty--inline">נתוני טורקיה אינם זמינים לשבוע זה</p>;
  }

  const committed = fcNum(row.turkeyAddedUsd) + fcNum(row.turkeyOpeningUsd);
  const transferred = fcNum(row.turkeyTransferredUsd);
  const closing = fcNum(row.turkeyClosingUsd);
  const inDrawer = row.drawerRemainingUsd != null ? fcNum(row.drawerRemainingUsd) : null;
  const fundingGap =
    inDrawer != null && closing > 0.02 ? Math.max(0, closing - inDrawer) : null;

  const items = [
    { label: "התחייבות / נדרש להעברה", value: money("USD", committed || closing) },
    { label: "הועבר בפועל", value: money("USD", transferred) },
    { label: "יתרה להעברה", value: signedMoney("USD", closing) },
    {
      label: "בקופה (מיועד להעברה)",
      value: inDrawer != null ? money("USD", inDrawer) : "לא זמין — טרם ספירה",
    },
    {
      label: "פער מימון",
      value:
        fundingGap != null
          ? money("USD", fundingGap)
          : inDrawer == null
            ? "— (נדרשת ספירה)"
            : money("USD", 0),
    },
  ];

  return (
    <div className="cfc-turkey-compact">
      <dl className="cfc-turkey-compact__grid">
        {items.map((it) => (
          <div key={it.label}>
            <dt>{it.label}</dt>
            <dd dir="ltr">{it.value}</dd>
          </div>
        ))}
      </dl>
      <p className="cfc-muted cfc-turkey-compact__hint">
        יתרת closing = תנועות מצטברות לשבוע (TurkeyTransferMovement), לא תקבול לקוח · סטטוס:{" "}
        {row.turkeyBalanceStatus}
      </p>
      <button type="button" className="cfc-btn cfc-btn--ghost cfc-btn--sm" onClick={() => setOpen((v) => !v)}>
        {open ? "הסתר פירוט העברות" : "פירוט העברות"}
      </button>
      {open && flow ? (
        <TurkeyMovementsTable
          movements={flow.turkeyBalance.movements}
          weekCode={week}
          closingUsd={flow.turkeyBalanceClosingUsd ?? "0"}
        />
      ) : null}
    </div>
  );
}
