"use client";

import type { FxProfitLossSummary } from "@/app/admin/cash-flow/flow-types";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { TrendingDown, TrendingUp } from "lucide-react";

export function ExchangeProfitLossChart({ summary }: { summary: FxProfitLossSummary }) {
  if (summary.purchases.length === 0) return null;

  return (
    <div className="fc-fx-pl">
      <h4>רווח / הפסד שערים</h4>
      <div className="fc-fx-pl__kpis">
        <div className="fc-fx-pl__kpi fc-fx-pl__kpi--profit">
          <TrendingUp size={16} />
          <span>רווח מצטבר</span>
          <strong dir="ltr">{fmtDailyMoney("ILS", summary.totalProfitIls)}</strong>
        </div>
        <div className="fc-fx-pl__kpi fc-fx-pl__kpi--loss">
          <TrendingDown size={16} />
          <span>הפסד מצטבר</span>
          <strong dir="ltr">{fmtDailyMoney("ILS", summary.totalLossIls)}</strong>
        </div>
        <div className="fc-fx-pl__kpi">
          <span>ממוצע שער</span>
          <strong dir="ltr">{summary.avgRate > 0 ? summary.avgRate.toFixed(4) : "—"}</strong>
        </div>
      </div>
      <div className="fc-fx-pl__bars">
        {summary.purchases.map((p) => (
          <div key={p.id} className="fc-fx-pl__bar-row">
            <span className="fc-fx-pl__bar-label" dir="ltr">
              {p.rate.toFixed(2)}
            </span>
            <div className="fc-fx-pl__bar-track">
              <div
                className="fc-fx-pl__bar-fill"
                style={{ width: `${Math.min(100, (p.ilsAmount / summary.maxBarAmount) * 100)}%` }}
              />
            </div>
            <span className="fc-fx-pl__bar-val" dir="ltr">
              {fmtDailyMoney("ILS", p.ilsAmount)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ExchangeProfitLossChart;
