import { isLegacyOrderStatusSlug, OS } from "@/lib/order-status-slugs";
import type { OrdersStatusSummary } from "@/components/admin/OrdersListShell";

export type OrdersStatusKpiGroup = {
  status: string;
  isCompleted: boolean;
  _count: { _all: number };
  _sum: { totalUsd: unknown };
};

function fmtCount(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString("he-IL");
}

function fmtUsd(n: number): string {
  return Math.max(0, n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function emptyAcc() {
  return {
    open: { count: 0, totalUsd: 0 },
    inProgress: { count: 0, totalUsd: 0 },
    completed: { count: 0, totalUsd: 0 },
    cancelled: { count: 0, totalUsd: 0 },
    debtWithdrawal: { count: 0, totalUsd: 0 },
    operationalCompleted: { count: 0, totalUsd: 0 },
  };
}

/**
 * מוני סטטוס מאותו universe של groupBy(status, isCompleted).
 * הזמנה נספרת פעם אחת: הושלם = isCompleted; בוצע = COMPLETED בלי isCompleted.
 * «הכל» = סכום כל הקבוצות (לא סינון KPI של הטבלה).
 */
export function buildOrdersStatusSummaryFromGroups(
  groups: OrdersStatusKpiGroup[],
): OrdersStatusSummary {
  const acc = emptyAcc();
  let allCount = 0;
  let allTotalUsd = 0;

  for (const g of groups) {
    const count = g._count?._all ?? 0;
    const totalUsd = Number(g._sum?.totalUsd ?? 0);
    allCount += count;
    allTotalUsd += Number.isFinite(totalUsd) ? totalUsd : 0;

    if (g.isCompleted) {
      acc.operationalCompleted.count += count;
      acc.operationalCompleted.totalUsd += Number.isFinite(totalUsd) ? totalUsd : 0;
      continue;
    }

    switch (g.status) {
      case OS.OPEN:
        acc.open.count += count;
        acc.open.totalUsd += Number.isFinite(totalUsd) ? totalUsd : 0;
        break;
      case OS.COMPLETED:
        acc.completed.count += count;
        acc.completed.totalUsd += Number.isFinite(totalUsd) ? totalUsd : 0;
        break;
      case OS.CANCELLED:
        acc.cancelled.count += count;
        acc.cancelled.totalUsd += Number.isFinite(totalUsd) ? totalUsd : 0;
        break;
      case OS.DEBT_WITHDRAWAL:
        acc.debtWithdrawal.count += count;
        acc.debtWithdrawal.totalUsd += Number.isFinite(totalUsd) ? totalUsd : 0;
        break;
      case OS.WAITING_FOR_EXECUTION:
      case OS.WITHDRAWAL_FROM_SUPPLIER:
      case OS.SENT:
      case OS.WAITING_FOR_CHINA_EXECUTION:
        acc.inProgress.count += count;
        acc.inProgress.totalUsd += Number.isFinite(totalUsd) ? totalUsd : 0;
        break;
      default:
        if (!isLegacyOrderStatusSlug(g.status)) {
          acc.inProgress.count += count;
          acc.inProgress.totalUsd += Number.isFinite(totalUsd) ? totalUsd : 0;
        }
        break;
    }
  }

  return {
    all: { count: fmtCount(allCount), totalUsd: fmtUsd(allTotalUsd) },
    open: { count: fmtCount(acc.open.count), totalUsd: fmtUsd(acc.open.totalUsd) },
    inProgress: { count: fmtCount(acc.inProgress.count), totalUsd: fmtUsd(acc.inProgress.totalUsd) },
    completed: { count: fmtCount(acc.completed.count), totalUsd: fmtUsd(acc.completed.totalUsd) },
    cancelled: { count: fmtCount(acc.cancelled.count), totalUsd: fmtUsd(acc.cancelled.totalUsd) },
    debtWithdrawal: { count: fmtCount(acc.debtWithdrawal.count), totalUsd: fmtUsd(acc.debtWithdrawal.totalUsd) },
    operationalCompleted: {
      count: fmtCount(acc.operationalCompleted.count),
      totalUsd: fmtUsd(acc.operationalCompleted.totalUsd),
    },
  };
}
