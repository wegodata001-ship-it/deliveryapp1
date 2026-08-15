"use client";

import { formatIlsDisplay, formatUsdDisplay } from "@/lib/money-format";
import type { CustomerWorkspaceComputedStats } from "@/lib/customer-workspace-stats";
import {
  BadgeDollarSign,
  CreditCard,
  DollarSign,
  Package,
  Scale,
  Truck,
  Users,
} from "lucide-react";

type Props = {
  stats: CustomerWorkspaceComputedStats;
  selectedCustomerName?: string | null;
  rowLimitSuffix?: (n: number) => string;
};

export function CustomerWorkspaceKpiStrip({ stats, selectedCustomerName, rowLimitSuffix }: Props) {
  void rowLimitSuffix;

  const items = selectedCustomerName
    ? [
        {
          Icon: DollarSign,
          label: "הזמנות",
          value: stats.ordersCount.toLocaleString("he-IL"),
        },
        {
          Icon: Truck,
          label: "משלוחים",
          value: stats.shipmentsCount.toLocaleString("he-IL"),
        },
        {
          Icon: Package,
          label: "דמי משלוח",
          value: formatIlsDisplay(stats.deliveryFeesTotalIls),
        },
        {
          Icon: Scale,
          label: "יתרת משלוחים",
          value: formatIlsDisplay(stats.remainingFeesTotalIls),
        },
        {
          Icon: CreditCard,
          label: "תשלומים",
          value: formatUsdDisplay(stats.paymentsTotalUsd),
        },
      ]
    : [
        {
          Icon: Users,
          label: 'סה"כ לקוחות',
          value: stats.customersCount.toLocaleString("he-IL"),
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
          Icon: Truck,
          label: 'סה"כ משלוחים',
          value: stats.shipmentsCount.toLocaleString("he-IL"),
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
