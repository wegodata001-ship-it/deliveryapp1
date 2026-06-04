"use client";

import { formatUsdDisplay } from "@/lib/money-format";
import type { CustomerWorkspaceComputedStats } from "@/lib/customer-workspace-stats";

type Props = {
  stats: CustomerWorkspaceComputedStats;
  rowLimitSuffix?: (n: number) => string;
};

export function CustomerWorkspaceKpiStrip({ stats, rowLimitSuffix }: Props) {
  const suffix = rowLimitSuffix?.(stats.ordersCount) ?? "";

  const items: { emoji: string; label: string; value: string }[] = [
    {
      emoji: "📦",
      label: 'סה"כ הזמנות',
      value: `${stats.ordersCount.toLocaleString("he-IL")}${suffix}`,
    },
    {
      emoji: "💵",
      label: 'סה"כ הזמנות לפני עמלה',
      value: formatUsdDisplay(stats.ordersBeforeCommissionUsd),
    },
    {
      emoji: "💰",
      label: 'סה"כ הזמנות אחרי עמלה',
      value: formatUsdDisplay(stats.ordersAfterCommissionUsd),
    },
    {
      emoji: "💳",
      label: 'סה"כ תשלומים',
      value: formatUsdDisplay(stats.paymentsTotalUsd),
    },
    {
      emoji: "⚖️",
      label: 'סה"כ יתרות',
      value: formatUsdDisplay(stats.balancesTotalUsd),
    },
    {
      emoji: "🟢",
      label: "לקוחות בזכות",
      value: stats.customersCreditCount.toLocaleString("he-IL"),
    },
    {
      emoji: "🔴",
      label: "לקוחות בחוב",
      value: stats.customersDebtCount.toLocaleString("he-IL"),
    },
  ];

  return (
    <div className="adm-cust-workspace__kpi-strip" dir="rtl" role="region" aria-label="סיכום מהיר">
      {items.map((item) => (
        <span key={item.label} className="adm-cust-workspace__kpi-strip-item">
          <span className="adm-cust-workspace__kpi-strip-emoji" aria-hidden>
            {item.emoji}
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
