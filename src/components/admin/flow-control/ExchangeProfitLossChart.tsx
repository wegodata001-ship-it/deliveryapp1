"use client";

import { useMemo, useState } from "react";
import type { FxProfitLossHistoryRow, FxProfitLossSummary } from "@/app/admin/cash-flow/flow-types";
import type { ExchangeProfitPeriodFilter } from "@/app/admin/cash-flow/exchange-profit-types";
import { exchangeProfitPeriodKey } from "@/lib/flow-control/exchange-profit-period";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { TrendingDown, TrendingUp } from "lucide-react";

type Period = "day" | "week" | "month";

type Bucket = {
  key: string;
  label: string;
  profit: number;
  loss: number;
  net: number;
  avgRate: number;
  count: number;
};

function buildBuckets(rows: FxProfitLossHistoryRow[], period: Period): Bucket[] {
  const map = new Map<string, Bucket & { rateSum: number; rateN: number }>();
  for (const r of rows) {
    const { key, label } = exchangeProfitPeriodKey(r.dateYmd || "", period);
    let b = map.get(key);
    if (!b) {
      b = { key, label, profit: 0, loss: 0, net: 0, avgRate: 0, count: 0, rateSum: 0, rateN: 0 };
      map.set(key, b);
    }
    b.profit += r.profitIls || 0;
    b.loss += r.lossIls || 0;
    b.net += r.netIls ?? r.profitIls - r.lossIls;
    b.count += 1;
    if (r.purchaseRate > 0) {
      b.rateSum += r.purchaseRate;
      b.rateN += 1;
    }
  }
  return [...map.values()]
    .map((b) => ({
      key: b.key,
      label: b.label,
      profit: Math.round(b.profit * 100) / 100,
      loss: Math.round(b.loss * 100) / 100,
      net: Math.round(b.net * 100) / 100,
      avgRate: b.rateN > 0 ? Math.round((b.rateSum / b.rateN) * 10000) / 10000 : 0,
      count: b.count,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function ExchangeProfitLossChart({
  summary,
  history = [],
  onOpenProfitDetail,
  onOpenPeriod,
}: {
  summary: FxProfitLossSummary;
  history?: FxProfitLossHistoryRow[];
  /** לחיצה על סכום רווח / כותרת — פותח את כל הזמנות השבוע */
  onOpenProfitDetail?: () => void;
  /** לחיצה על נקודה בגרף — פותח הזמנות של אותו יום/שבוע/חודש */
  onOpenPeriod?: (filter: ExchangeProfitPeriodFilter) => void;
}) {
  const [period, setPeriod] = useState<Period>("day");
  const rows = history.length > 0 ? history : [];
  const buckets = useMemo(() => buildBuckets(rows, period), [rows, period]);
  const maxAbs = Math.max(...buckets.map((b) => Math.abs(b.net)), 1);
  const cumulativeNet = summary.totalProfitIls - summary.totalLossIls;
  const interactive = Boolean(onOpenProfitDetail || onOpenPeriod);

  if (summary.purchases.length === 0 && rows.length === 0) return null;

  return (
    <div className="fc-fx-pl">
      <div className="fc-fx-pl__head">
        <h4>
          גרף רווחי מט״ח
          {interactive ? (
            <span className="fc-fx-pl__hint"> · לחצו על רווח או על עמודה לפירוט הזמנות</span>
          ) : null}
        </h4>
        <div className="fc-fx-pl__period" role="group" aria-label="תקופת גרף">
          {(
            [
              ["day", "יומי"],
              ["week", "שבועי"],
              ["month", "חודשי"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`fc-fx-pl__period-btn${period === id ? " is-active" : ""}`}
              onClick={() => setPeriod(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="fc-fx-pl__kpis">
        <button
          type="button"
          className={`fc-fx-pl__kpi fc-fx-pl__kpi--profit${onOpenProfitDetail ? " is-clickable" : ""}`}
          onClick={onOpenProfitDetail}
          disabled={!onOpenProfitDetail}
        >
          <TrendingUp size={16} />
          <span>רווח</span>
          <strong dir="ltr">{fmtDailyMoney("ILS", summary.totalProfitIls)}</strong>
        </button>
        <button
          type="button"
          className={`fc-fx-pl__kpi fc-fx-pl__kpi--loss${onOpenProfitDetail ? " is-clickable" : ""}`}
          onClick={onOpenProfitDetail}
          disabled={!onOpenProfitDetail}
        >
          <TrendingDown size={16} />
          <span>הפסד</span>
          <strong dir="ltr">{fmtDailyMoney("ILS", summary.totalLossIls)}</strong>
        </button>
        <div className="fc-fx-pl__kpi">
          <span>ממוצע שער</span>
          <strong dir="ltr">{summary.avgRate > 0 ? summary.avgRate.toFixed(4) : "—"}</strong>
        </div>
        <button
          type="button"
          className={`fc-fx-pl__kpi${cumulativeNet >= 0 ? " fc-fx-pl__kpi--profit" : " fc-fx-pl__kpi--loss"}${
            onOpenProfitDetail ? " is-clickable" : ""
          }`}
          onClick={onOpenProfitDetail}
          disabled={!onOpenProfitDetail}
        >
          <span>רווח מצטבר</span>
          <strong dir="ltr">{fmtDailyMoney("ILS", cumulativeNet)}</strong>
        </button>
      </div>

      {buckets.length > 0 ? (
        <div className="fc-fx-pl__bars" aria-label="רווח והפסד לפי תקופה">
          {buckets.map((b) => {
            const pct = Math.min(100, (Math.abs(b.net) / maxAbs) * 100);
            const positive = b.net >= 0;
            const clickable = Boolean(onOpenPeriod);
            const openBucket = () =>
              onOpenPeriod?.({ period, key: b.key, label: b.label });
            return (
              <button
                key={b.key}
                type="button"
                className={`fc-fx-pl__bar-row${clickable ? " is-clickable" : ""}`}
                onClick={clickable ? openBucket : undefined}
                disabled={!clickable}
                title={
                  clickable
                    ? `לחצו לפירוט הזמנות · רווח ${b.profit} · הפסד ${b.loss}`
                    : `רווח ${b.profit} · הפסד ${b.loss} · ממוצע שער ${b.avgRate}`
                }
              >
                <span className="fc-fx-pl__bar-label" dir="ltr">
                  {b.label}
                </span>
                <div className="fc-fx-pl__bar-track">
                  <div
                    className={`fc-fx-pl__bar-fill${positive ? "" : " is-loss"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="fc-fx-pl__bar-val" dir="ltr">
                  {fmtDailyMoney("ILS", b.net)}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
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
      )}
    </div>
  );
}

export default ExchangeProfitLossChart;
