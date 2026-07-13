"use client";

import type { FlowWeekDrillPayload } from "@/app/admin/cash-flow/flow-types";
import { fmtWeekFlowAmount } from "@/lib/cash-control-week-flow";
import {
  deriveFxNetIls,
  deriveTotalDrawerIls,
  deriveWeekDiffIls,
  deriveWeekStatus,
  fmtHeroIls,
  fmtHeroUsd,
} from "@/components/admin/flow-control/dashboard/flow-dashboard-derive";
import { fcNum } from "@/components/admin/flow-control/shared";

const KPI_ITEMS: {
  label: string;
  getValue: (d: FlowWeekDrillPayload) => string;
}[] = [
  { label: 'סה"כ התקבל', getValue: (d) => fmtHeroIls(fcNum(d.flow.kpis.totalReceivedIls)) },
  { label: 'סה"כ נספר', getValue: (d) => fmtHeroIls(deriveTotalDrawerIls(d)) },
  {
    label: "הפרש",
    getValue: (d) => {
      const diff = deriveWeekDiffIls(d);
      if (Math.abs(diff) < 0.005) return "—";
      const prefix = diff > 0 ? "+" : "";
      return `${prefix}${fmtHeroIls(diff)}`;
    },
  },
  {
    label: 'רווח מט"ח',
    getValue: (d) => {
      const net = deriveFxNetIls(d);
      if (Math.abs(net) < 0.005) return "—";
      return fmtWeekFlowAmount("ILS", net);
    },
  },
  {
    label: "חוב לטורקיה",
    getValue: (d) => fmtHeroUsd(fcNum(d.flow.turkeyDebtUsd)),
  },
  {
    label: "יתרה בקופה",
    getValue: (d) => fmtHeroIls(fcNum(d.flow.kpis.cashRemainingIls)),
  },
];

export function FlowDashboardKpiStrip({ drill }: { drill: FlowWeekDrillPayload }) {
  const weekStatus = deriveWeekStatus(drill);

  return (
    <div className="fd-kpi-strip" aria-label="סיכום KPI">
      {KPI_ITEMS.map((item) => (
        <article key={item.label} className="fd-kpi-mini">
          <span className="fd-kpi-mini__label">{item.label}</span>
          <strong dir="ltr" className="fd-kpi-mini__value">
            {item.getValue(drill)}
          </strong>
        </article>
      ))}
      <article className={`fd-kpi-mini fd-kpi-mini--status fd-kpi-mini--status-${weekStatus.status}`}>
        <span className="fd-kpi-mini__label">סטטוס השבוע</span>
        <strong className="fd-kpi-mini__value fd-kpi-mini__value--status">
          <span aria-hidden>{weekStatus.dot}</span> {weekStatus.label}
        </strong>
      </article>
    </div>
  );
}

export default FlowDashboardKpiStrip;
