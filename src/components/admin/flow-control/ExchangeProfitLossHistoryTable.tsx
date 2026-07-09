"use client";

import type { FxProfitLossHistoryRow } from "@/app/admin/cash-flow/flow-types";
import { fmtDailyMoney } from "@/lib/cash-control-daily";

export function ExchangeProfitLossHistoryTable({ rows }: { rows: FxProfitLossHistoryRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="fc-fx-pl-history">
      <h4>היסטוריית רווח / הפסד שערים</h4>
      <div className="fc-table-wrap">
        <table className="fc-table fc-table--compact">
          <thead>
            <tr>
              <th>תאריך</th>
              <th>שעה</th>
              <th className="fc-num">שער רכישה</th>
              <th className="fc-num">שער ממוצע</th>
              <th className="fc-num">שער מכירה</th>
              <th className="fc-num">רווח</th>
              <th className="fc-num">הפסד</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.purchaseId}>
                <td dir="ltr">{r.dateLabel}</td>
                <td dir="ltr">{r.timeLabel}</td>
                <td dir="ltr" className="fc-num">
                  {r.purchaseRate.toFixed(4)}
                </td>
                <td dir="ltr" className="fc-num">
                  {r.avgRateBefore.toFixed(4)}
                </td>
                <td dir="ltr" className="fc-num">
                  {r.saleRate != null ? r.saleRate.toFixed(4) : "—"}
                </td>
                <td dir="ltr" className="fc-num fc-num--profit">
                  {r.profitIls > 0 ? fmtDailyMoney("ILS", r.profitIls) : "—"}
                </td>
                <td dir="ltr" className="fc-num fc-num--loss">
                  {r.lossIls > 0 ? fmtDailyMoney("ILS", r.lossIls) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ExchangeProfitLossHistoryTable;
