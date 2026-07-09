"use client";

import type { FxPurchaseRecord } from "@/app/admin/cash-flow/flow-types";
import { fmtDailyMoney } from "@/lib/cash-control-daily";

export function CurrencyExchangeHistory({ purchases }: { purchases: FxPurchaseRecord[] }) {
  if (purchases.length === 0) return null;
  return (
    <div className="fc-fx-history">
      <h4>היסטוריית רכישות מט&quot;ח</h4>
      <div className="fc-table-wrap">
        <table className="fc-table fc-table--compact">
          <thead>
            <tr>
              <th>תאריך</th>
              <th>שעה</th>
              <th>משתמש</th>
              <th className="fc-num">סכום ₪</th>
              <th className="fc-num">שער</th>
              <th className="fc-num">דולר</th>
              <th className="fc-num">עמלה $</th>
              <th className="fc-num">נשאר בקופה</th>
              <th className="fc-num">הועבר לבנק</th>
              <th>הערה</th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((p) => {
              const dt = new Date(p.createdAt);
              return (
                <tr key={p.id}>
                  <td dir="ltr">{dt.toLocaleDateString("he-IL")}</td>
                  <td dir="ltr">
                    {dt.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false })}
                  </td>
                  <td>{p.createdByName ?? "—"}</td>
                  <td dir="ltr" className="fc-num">
                    {fmtDailyMoney("ILS", p.ilsAmount)}
                  </td>
                  <td dir="ltr" className="fc-num">
                    {p.rate.toFixed(4)}
                  </td>
                  <td dir="ltr" className="fc-num">
                    {fmtDailyMoney("USD", p.usdReceived)}
                  </td>
                  <td dir="ltr" className="fc-num">
                    {(p.commissionUsd ?? 0) > 0 ? fmtDailyMoney("USD", p.commissionUsd!) : "—"}
                  </td>
                  <td dir="ltr" className="fc-num">
                    {fmtDailyMoney("ILS", p.remainderCashIls)}
                  </td>
                <td dir="ltr" className="fc-num">
                  {fmtDailyMoney("ILS", p.remainderBankIls)}
                </td>
                <td>{p.note?.trim() || "—"}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default CurrencyExchangeHistory;
