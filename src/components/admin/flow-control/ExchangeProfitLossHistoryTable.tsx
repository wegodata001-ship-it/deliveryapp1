"use client";

import type { FxProfitLossHistoryRow } from "@/app/admin/cash-flow/flow-types";
import { fmtDailyMoney } from "@/lib/cash-control-daily";

export function ExchangeProfitLossHistoryTable({ rows }: { rows: FxProfitLossHistoryRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="fc-fx-pl-history">
        <h4>פירוט רכישות מט״ח</h4>
        <p className="fc-fx-pl-history__empty">אין רכישות מט״ח בשבוע זה.</p>
      </div>
    );
  }

  return (
    <div className="fc-fx-pl-history">
      <h4>פירוט רכישות מט״ח — שער קליטה מול שער רכישה</h4>
      <div className="fc-table-wrap">
        <table className="fc-table fc-table--compact">
          <thead>
            <tr>
              <th>#</th>
              <th>תאריך</th>
              <th className="fc-num">סכום $</th>
              <th className="fc-num">סכום ₪</th>
              <th className="fc-num">שער קליטה</th>
              <th className="fc-num">שער רכישה</th>
              <th className="fc-num">הפרש שער</th>
              <th className="fc-num">רווח / הפסד</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const net = r.netIls ?? r.profitIls - r.lossIls;
              return (
                <tr key={r.purchaseId}>
                  <td dir="ltr">{r.operationNumber ?? "—"}</td>
                  <td dir="ltr">
                    {r.dateLabel}
                    {r.timeLabel ? ` · ${r.timeLabel}` : ""}
                  </td>
                  <td dir="ltr" className="fc-num">
                    {fmtDailyMoney("USD", r.usdReceived ?? 0)}
                  </td>
                  <td dir="ltr" className="fc-num">
                    {fmtDailyMoney("ILS", r.ilsAmount ?? 0)}
                  </td>
                  <td dir="ltr" className="fc-num">
                    {r.intakeRate != null ? r.intakeRate.toFixed(4) : "—"}
                  </td>
                  <td dir="ltr" className="fc-num">
                    {r.purchaseRate.toFixed(4)}
                  </td>
                  <td dir="ltr" className="fc-num">
                    {r.rateDiff != null ? (r.rateDiff > 0 ? "+" : "") + r.rateDiff.toFixed(4) : "—"}
                  </td>
                  <td
                    dir="ltr"
                    className={`fc-num${net > 0.005 ? " fc-num--profit" : net < -0.005 ? " fc-num--loss" : ""}`}
                  >
                    {Math.abs(net) > 0.005 ? fmtDailyMoney("ILS", net) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ExchangeProfitLossHistoryTable;
