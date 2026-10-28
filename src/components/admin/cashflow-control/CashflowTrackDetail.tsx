"use client";

import type { FlowWeekDrillPayload, FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import { money } from "@/components/admin/cashflow-control/cashflow-control-helpers";
import { summarizeFxTrack, type FxTrackKind } from "@/lib/flow-control/services/fx-week-summary.shared";

export function CashflowTrackDetail({
  track,
  row,
  drill,
}: {
  track: FxTrackKind;
  row: FlowWeekOverviewRow;
  drill: FlowWeekDrillPayload | null;
}) {
  const flow = drill?.flow;
  const summary = summarizeFxTrack(flow?.fxPurchases, track);
  const isPs = track === "PS";

  const lines = isPs
    ? [
        { label: "מזומן $", value: money("USD", row.receivedCashUsd) },
        { label: "מזומן ₪ (PS)", value: money("ILS", row.receivedCashIls) },
        { label: "רכישת מט״ח", value: `${money("ILS", row.fxPurchaseIls)} → ${money("USD", row.fxPurchaseUsd)}` },
        { label: "עמלה $", value: money("USD", row.commissionUsd) },
        { label: "העברה לטורקיה", value: money("USD", row.turkeyTransferUsd) },
        { label: "הועבר בפועל", value: money("USD", row.turkeyTransferredUsd) },
        { label: "יתרה לטורקיה", value: money("USD", row.turkeyClosingUsd) },
        { label: "קופת $", value: row.drawerRemainingUsd ?? "—" },
      ]
    : [
        { label: "רכישת מט״ח IL", value: `${money("ILS", row.ilFxPurchaseIls)} → ${money("USD", row.ilFxPurchaseUsd)}` },
        { label: "שער אחרון", value: row.fxIlRate ?? "—" },
        { label: "עמלה ₪", value: money("ILS", row.commissionIls) },
        { label: "העברה לטורקיה ₪", value: money("ILS", row.turkeyTransferIls) },
        { label: "יתרת בנק", value: row.bankBalanceIls ?? "—" },
        { label: "קופת ₪", value: row.drawerRemainingIls ?? "—" },
      ];

  return (
    <div className="cfc-track-detail">
      <div className="cfc-track-detail__summary">
        <span>רכישות בשבוע: {summary.purchaseCount}</span>
        {summary.lastRate != null ? (
          <span dir="ltr">שער {summary.lastRate.toFixed(4)}</span>
        ) : null}
      </div>
      <div className="cfc-table-scroll cfc-table-scroll--tight">
        <table className="cfc-table cfc-compact-table">
          <tbody>
            {lines.map((l) => (
              <tr key={l.label}>
                <th scope="row">{l.label}</th>
                <td dir="ltr">{l.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(flow?.fxPurchases ?? []).filter((p) => (p.track ?? "PS") === track).length > 0 ? (
        <div className="cfc-table-scroll cfc-table-scroll--tight">
          <table className="cfc-table cfc-compact-table">
            <thead>
              <tr>
                <th>תאריך</th>
                <th>₪</th>
                <th>שער</th>
                <th>$</th>
                <th>עמלה</th>
              </tr>
            </thead>
            <tbody>
              {(flow?.fxPurchases ?? [])
                .filter((p) => (p.track ?? "PS") === track)
                .map((p) => (
                  <tr key={p.id}>
                    <td>{p.createdAt?.slice(0, 10) ?? "—"}</td>
                    <td dir="ltr">{money("ILS", p.ilsAmount)}</td>
                    <td dir="ltr">{p.rate?.toFixed(4) ?? "—"}</td>
                    <td dir="ltr">{money("USD", p.usdReceived)}</td>
                    <td dir="ltr">
                      {p.commissionIls != null ? money("ILS", p.commissionIls) : "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="cfc-empty cfc-empty--inline">אין רכישות {track} בשבוע</p>
      )}
    </div>
  );
}
