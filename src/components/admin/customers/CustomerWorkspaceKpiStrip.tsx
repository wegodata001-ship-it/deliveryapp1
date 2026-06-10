"use client";

import { formatUsdDisplay } from "@/lib/money-format";
import type { CustomerWorkspaceComputedStats } from "@/lib/customer-workspace-stats";
import { BadgeDollarSign, CircleDot, CreditCard, DollarSign, Package, Scale } from "lucide-react";

type Props = {
  stats: CustomerWorkspaceComputedStats;
  rowLimitSuffix?: (n: number) => string;
};

export function CustomerWorkspaceKpiStrip({ stats, rowLimitSuffix }: Props) {
  const suffix = rowLimitSuffix?.(stats.ordersCount) ?? "";

  const items = [
    {
      Icon: Package,
      label: 'סה"כ הזמנות',
      value: `${stats.ordersCount.toLocaleString("he-IL")}${suffix}`,
    },
    {
      Icon: DollarSign,
      label: 'סה"כ הזמנות לפני עמלה',
      value: formatUsdDisplay(stats.ordersBeforeCommissionUsd),
    },
    {
      Icon: BadgeDollarSign,
      label: 'סה"כ הזמנות אחרי עמלה',
      value: formatUsdDisplay(stats.ordersAfterCommissionUsd),
    },
    {
      Icon: CreditCard,
      label: 'סה"כ תשלומים',
      value: formatUsdDisplay(stats.paymentsTotalUsd),
    },
    {
      Icon: Scale,
      label: 'סה"כ יתרות',
      value: formatUsdDisplay(stats.balancesTotalUsd),
    },
    {
      Icon: CircleDot,
      label: "לקוחות בזכות",
      value: stats.customersCreditCount.toLocaleString("he-IL"),
    },
    {
      Icon: CircleDot,
      label: "לקוחות בחוב",
      value: stats.customersDebtCount.toLocaleString("he-IL"),
    },
  ];

  return (
    <div className="adm-cust-workspace__kpi-strip" dir="rtl" role="region" aria-label="סיכום מהיר">
      {items.map((item) => (
        <span key={item.label} className="adm-cust-workspace__kpi-strip-item">
          <span className="adm-cust-workspace__kpi-strip-emoji" aria-hidden>
            <item.Icon size={16} strokeWidth={1.75} />
          </span>
          <span className="adm-cust-workspace__kpi-strip-label">{item.label}:</span>
          <strong className="adm-cust-workspace__kpi-strip-val" dir="ltr">
            {item.value}
          </strong>
        </span>
      ))}
    </div>
  );
}
