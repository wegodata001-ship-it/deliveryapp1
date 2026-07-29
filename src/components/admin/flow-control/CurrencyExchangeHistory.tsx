"use client";

import { useMemo } from "react";
import type { FxPurchaseRecord } from "@/app/admin/cash-flow/flow-types";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { computeFxProfitLossHistory } from "@/lib/flow-control/flow-calculation-service";

export function CurrencyExchangeHistory({ purchases }: { purchases: FxPurchaseRecord[] }) {
  const { rows, kpis } = useMemo(() => {
    const history = computeFxProfitLossHistory(purchases);
    const historyById = new Map(history.map((row) => [row.purchaseId, row]));
    const sortedPurchases = [...purchases].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const totalProfitIls = history.reduce((sum, row) => sum + row.profitIls, 0);
    const totalLossIls = history.reduce((sum, row) => sum + row.lossIls, 0);

    return {
      rows: sortedPurchases.map((purchase) => ({
        purchase,
        pl: historyById.get(purchase.id),
      })),
      kpis: {
        totalProfitIls,
        totalLossIls,
        netIls: totalProfitIls - totalLossIls,
        count: purchases.length,
        totalUsd: purchases.reduce((sum, purchase) => sum + purchase.usdReceived, 0),
      },
    };
  }, [purchases]);

  if (purchases.length === 0) return null;

  return (
    <div className="fc-fx-history">
      <h4>היסטוריית רכישות מט&quot;ח</h4>
      <section className="fc-kpi-grid fc-fx-history__kpis" aria-label='סיכום רכישות מט"ח'>
        <article className="fc-kpi fc-kpi--profit">
          <span className="fc-kpi__label">סה&quot;כ רווח מט&quot;ח</span>
          <strong dir="ltr" className="fc-kpi__value">
            {fmtDailyMoney("ILS", kpis.totalProfitIls)}
          </strong>
        </article>
        <article className="fc-kpi fc-kpi--loss">
          <span className="fc-kpi__label">סה&quot;כ הפסד מט&quot;ח</span>
          <strong dir="ltr" className="fc-kpi__value">
            {fmtDailyMoney("ILS", kpis.totalLossIls)}
          </strong>
        </article>
        <article className="fc-kpi">
          <span className="fc-kpi__label">רווח נטו</span>
          <strong
            dir="ltr"
            className={`fc-kpi__value${
              kpis.netIls > 0.005 ? " fc-num--profit" : kpis.netIls < -0.005 ? " fc-num--loss" : ""
            }`}
          >
            {fmtDailyMoney("ILS", kpis.netIls)}
          </strong>
        </article>
        <article className="fc-kpi">
          <span className="fc-kpi__label">מספר רכישות</span>
          <strong dir="ltr" className="fc-kpi__value">
            {kpis.count.toLocaleString("he-IL")}
          </strong>
        </article>
        <article className="fc-kpi fc-kpi--fx">
          <span className="fc-kpi__label">סך דולר שנרכש</span>
          <strong dir="ltr" className="fc-kpi__value">
            {fmtDailyMoney("USD", kpis.totalUsd)}
          </strong>
        </article>
      </section>
      <div className="fc-table-wrap">
        <table className="fc-table fc-table--compact">
          <thead>
            <tr>
              <th>תאריך</th>
              <th>מסלול</th>
              <th className="fc-num">סכום רכישה</th>
              <th className="fc-num">רווח מט&quot;ח</th>
              <th className="fc-num">הפסד מט&quot;ח</th>
              <th className="fc-num">שער רכישה</th>
              <th className="fc-num">דולר שנרכש</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ purchase, pl }) => {
              const dt = new Date(purchase.createdAt);
              const track = purchase.track === "IL" ? "IL" : "PS";
              const profitIls = pl?.profitIls ?? 0;
              const lossIls = pl?.lossIls ?? 0;
              const matchedUsd = pl?.usdReceived ?? 0;

              return (
                <tr key={purchase.id}>
                  <td dir="ltr">{dt.toLocaleDateString("he-IL")}</td>
                  <td>
                    <strong>{track}</strong>
                  </td>
                  <td dir="ltr" className="fc-num">
                    {fmtDailyMoney("ILS", purchase.ilsAmount)}
                  </td>
                  <td dir="ltr" className="fc-num fc-num--profit">
                    {profitIls > 0.005 ? fmtDailyMoney("ILS", profitIls) : "—"}
                  </td>
                  <td dir="ltr" className="fc-num fc-num--loss">
                    {lossIls > 0.005 ? fmtDailyMoney("ILS", lossIls) : "—"}
                  </td>
                  <td dir="ltr" className="fc-num">
                    {purchase.rate.toFixed(4)}
                  </td>
                  <td dir="ltr" className="fc-num">
                    {matchedUsd > 0.005 ? fmtDailyMoney("USD", matchedUsd) : "—"}
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

export default CurrencyExchangeHistory;
