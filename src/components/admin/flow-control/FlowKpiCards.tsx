"use client";

import {
  Banknote,
  Building2,
  Plane,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { FlowWeekKpiCards } from "@/app/admin/cash-flow/flow-types";
import { fmtWeekFlowAmount } from "@/lib/cash-control-week-flow";
import { fcNum } from "@/components/admin/flow-control/shared";

const KPI_CONFIG: Array<{
  key: keyof FlowWeekKpiCards;
  label: string;
  currency: "ILS" | "USD";
  icon: typeof Wallet;
  tone?: string;
  fxClickable?: boolean;
}> = [
  { key: "totalReceivedIls", label: 'סה"כ התקבל השבוע', currency: "ILS", icon: Wallet },
  { key: "totalFxConvertedIls", label: 'סה"כ הומר למט"ח', currency: "ILS", icon: TrendingUp, tone: "fx" },
  { key: "turkeyTransferredUsd", label: "סה\"כ הועבר לטורקיה", currency: "USD", icon: Plane, tone: "turkey" },
  { key: "cashRemainingIls", label: "יתרה בקופה ₪", currency: "ILS", icon: Banknote },
  { key: "cashRemainingUsd", label: "יתרה בקופה $", currency: "USD", icon: Banknote },
  { key: "bankBalanceIls", label: "יתרה בבנק", currency: "ILS", icon: Building2 },
  { key: "fxProfitIls", label: "רווח מט״ח", currency: "ILS", icon: TrendingUp, tone: "profit", fxClickable: true },
  { key: "fxLossIls", label: "הפסד מט״ח", currency: "ILS", icon: TrendingDown, tone: "loss", fxClickable: true },
];

export type FlowKpiCardsProps = {
  kpis: FlowWeekKpiCards | null;
  onFxProfitClick?: () => void;
};

export function FlowKpiCards({ kpis, onFxProfitClick }: FlowKpiCardsProps) {
  if (!kpis) return null;
  return (
    <section className="fc-kpi-grid" aria-label="סיכום שבוע">
      {KPI_CONFIG.map(({ key, label, currency, icon: Icon, tone, fxClickable }) => {
        const clickable = !!(fxClickable && onFxProfitClick);
        const className = `fc-kpi${tone ? ` fc-kpi--${tone}` : ""}${clickable ? " fc-kpi--clickable" : ""}`;
        const body = (
          <>
            <Icon size={18} aria-hidden />
            <span className="fc-kpi__label">{label}</span>
            <strong dir="ltr" className="fc-kpi__value">
              {fmtWeekFlowAmount(currency, fcNum(kpis[key]))}
            </strong>
            {clickable ? <span className="fc-kpi__hint">פירוט ←</span> : null}
          </>
        );
        if (clickable) {
          return (
            <button
              key={key}
              type="button"
              className={className}
              onClick={onFxProfitClick}
              title="לחץ לפירוט רווח/הפסד מט״ח"
            >
              {body}
            </button>
          );
        }
        return (
          <article key={key} className={className}>
            {body}
          </article>
        );
      })}
    </section>
  );
}

export default FlowKpiCards;
