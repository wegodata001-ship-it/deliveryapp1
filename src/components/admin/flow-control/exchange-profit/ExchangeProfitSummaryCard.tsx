"use client";

import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { fcNum } from "@/components/admin/flow-control/shared";

function fmtIls(v: string | null | undefined): string {
  const n = fcNum(v ?? "0");
  if (Math.abs(n) < 0.005) return "—";
  return fmtDailyMoney("ILS", n);
}

export type ExchangeProfitSummaryCardProps = {
  week: string;
  weekLabel?: string | null;
  /** רווח נטו להצגה */
  netIls: string;
  profitIls?: string;
  lossIls?: string;
  onClick: () => void;
};

/** כרטיס סיכום לחיץ — מסך ראשי / KPI */
export function ExchangeProfitSummaryCard({
  week,
  weekLabel,
  netIls,
  profitIls,
  lossIls,
  onClick,
}: ExchangeProfitSummaryCardProps) {
  const net = fcNum(netIls);
  const profit = fcNum(profitIls ?? "0");
  const loss = fcNum(lossIls ?? "0");
  const tone = net > 0.005 ? "profit" : net < -0.005 ? "loss" : "flat";

  return (
    <button
      type="button"
      className={`xp-summary-card xp-summary-card--${tone}`}
      onClick={onClick}
      title="לחץ לפירוט רווח/הפסד מט״ח"
    >
      <span className="xp-summary-card__label">רווח מט״ח</span>
      <strong dir="ltr" className="xp-summary-card__value">
        {fmtIls(netIls)}
      </strong>
      <span className="xp-summary-card__meta" dir="ltr">
        {week}
        {weekLabel ? ` · ${weekLabel}` : ""}
      </span>
      {(profit > 0 || loss > 0) && (
        <span className="xp-summary-card__split">
          {profit > 0 ? <span className="is-profit">רווח {fmtIls(String(profit))}</span> : null}
          {loss > 0 ? <span className="is-loss">הפסד {fmtIls(String(loss))}</span> : null}
        </span>
      )}
      <span className="xp-summary-card__hint">לחץ לפירוט ←</span>
    </button>
  );
}

export default ExchangeProfitSummaryCard;
