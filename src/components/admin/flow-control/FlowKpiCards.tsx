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
}> = [
  { key: "totalReceivedIls", label: 'סה"כ התקבל השבוע', currency: "ILS", icon: Wallet },
  { key: "totalFxConvertedIls", label: 'סה"כ הומר למט"ח', currency: "ILS", icon: TrendingUp, tone: "fx" },
  { key: "turkeyTransferredUsd", label: "סה\"כ הועבר לטורקיה", currency: "USD", icon: Plane, tone: "turkey" },
  { key: "cashRemainingIls", label: "יתרה בקופה ₪", currency: "ILS", icon: Banknote },
  { key: "cashRemainingUsd", label: "יתרה בקופה $", currency: "USD", icon: Banknote },
  { key: "bankBalanceIls", label: "יתרה בבנק", currency: "ILS", icon: Building2 },
  { key: "fxProfitIls", label: "רווח שערים", currency: "ILS", icon: TrendingUp, tone: "profit" },
  { key: "fxLossIls", label: "הפסד שערים", currency: "ILS", icon: TrendingDown, tone: "loss" },
];

export function FlowKpiCards({ kpis }: { kpis: FlowWeekKpiCards | null }) {
  if (!kpis) return null;
  return (
    <section className="fc-kpi-grid" aria-label="סיכום שבוע">
      {KPI_CONFIG.map(({ key, label, currency, icon: Icon, tone }) => (
        <article key={key} className={`fc-kpi${tone ? ` fc-kpi--${tone}` : ""}`}>
          <Icon size={18} aria-hidden />
          <span className="fc-kpi__label">{label}</span>
          <strong dir="ltr" className="fc-kpi__value">
            {fmtWeekFlowAmount(currency, fcNum(kpis[key]))}
          </strong>
        </article>
      ))}
    </section>
  );
}

export default FlowKpiCards;
