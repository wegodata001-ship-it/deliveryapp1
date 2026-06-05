"use client";

import { useMemo } from "react";
import type { CustomerBalanceRow, CustomerBalancesPayload } from "@/app/admin/balances/actions";
import { sumOrdersUsdSplit } from "@/lib/customer-balances-display";
import { formatUsdDisplay, parseMoneyStringOrZero } from "@/lib/money-format";

type Props = {
  stats: CustomerBalancesPayload["stats"];
  rows: readonly CustomerBalanceRow[];
  totalRows: number;
  totalPages: number;
  expanded: boolean;
};

type StatCardVariant =
  | "open-debt"
  | "debt-customers"
  | "credit-customers"
  | "payments"
  | "before-commission"
  | "after-commission"
  | "commissions";

function usdAmount(n: number): string {
  return formatUsdDisplay(n);
}

function usd(s: string): string {
  return formatUsdDisplay(parseMoneyStringOrZero(s));
}

function StatCard({
  variant,
  label,
  value,
  dir = "ltr",
}: {
  variant: StatCardVariant;
  label: string;
  value: string;
  dir?: "ltr" | "rtl";
}) {
  return (
    <article className={`adm-balances-stat-card adm-balances-stat-card--${variant}`}>
      <span className="adm-balances-stat-card__lbl">{label}</span>
      <strong className="adm-balances-stat-card__val" dir={dir}>
        {value}
      </strong>
    </article>
  );
}

export function CustomerBalancesInsightsBar({ stats, rows, totalRows, totalPages, expanded }: Props) {
  const paginated = totalPages > 1;
  const splitTotals = useMemo(() => {
    const page = sumOrdersUsdSplit(rows);
    const globalIncluding = parseMoneyStringOrZero(stats.totalOrdersAfterCommissionUsd);
    if (!paginated || page.includingUsd <= 0.01) return page;
    const beforeShare = page.beforeUsd / page.includingUsd;
    const commissionShare = page.commissionUsd / page.includingUsd;
    return {
      beforeUsd: globalIncluding * beforeShare,
      commissionUsd: globalIncluding * commissionShare,
      includingUsd: globalIncluding,
    };
  }, [rows, stats.totalOrdersAfterCommissionUsd, paginated]);

  if (!expanded) return null;

  return (
    <div className="adm-balances-stats-panel" dir="rtl">
      {paginated ? (
        <p className="adm-balances-stats-scope-hint" role="note">
          לפני עמלה / עמלות מוערכים לפי יחס העמוד · {totalRows.toLocaleString("he-IL")} לקוחות מסוננים
        </p>
      ) : null}
      <div className="adm-balances-stat-cards" role="region" aria-label="סטטיסטיקת יתרות">
        <StatCard variant="open-debt" label="חוב פתוח" value={usd(stats.totalDebtUsd)} />
        <StatCard
          variant="debt-customers"
          label="לקוחות בחוב"
          value={stats.withDebtCount.toLocaleString("he-IL")}
          dir="rtl"
        />
        <StatCard
          variant="credit-customers"
          label="לקוחות בזכות"
          value={stats.withCreditCount.toLocaleString("he-IL")}
          dir="rtl"
        />
        <StatCard variant="payments" label="תשלומים" value={usd(stats.totalPaymentsUsd)} />
        <StatCard variant="before-commission" label="לפני עמלה" value={usdAmount(splitTotals.beforeUsd)} />
        <StatCard variant="after-commission" label="אחרי עמלה" value={usd(stats.totalOrdersAfterCommissionUsd)} />
        <StatCard variant="commissions" label="עמלות" value={usdAmount(splitTotals.commissionUsd)} />
      </div>
    </div>
  );
}
