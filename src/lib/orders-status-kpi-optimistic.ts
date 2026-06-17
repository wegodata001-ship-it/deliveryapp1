import type { OrdersStatusBucket, OrdersStatusSummary } from "@/components/admin/OrdersListShell";
import { orderStatusBelongsToKpiBucket, type OrderStatusKpiKey } from "@/lib/orders-status-kpi-filter";
import { isLegacyOrderStatusSlug } from "@/lib/order-status-slugs";

function parseBucketCount(raw: string): number {
  const n = Number(String(raw).replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseBucketUsd(raw: string): number {
  const n = Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function fmtCount(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString("he-IL");
}

function fmtUsd(n: number): string {
  return Math.max(0, n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function bumpBucket(bucket: OrdersStatusBucket, deltaCount: number, deltaUsd: number): OrdersStatusBucket {
  return {
    count: fmtCount(parseBucketCount(bucket.count) + deltaCount),
    totalUsd: fmtUsd(parseBucketUsd(bucket.totalUsd) + deltaUsd),
  };
}

export function orderStatusToKpiBucketKey(orderStatus: string): OrderStatusKpiKey | null {
  const keys: OrderStatusKpiKey[] = ["open", "inProgress", "completed", "cancelled", "debtWithdrawal"];
  for (const key of keys) {
    if (orderStatusBelongsToKpiBucket(orderStatus, key)) return key;
  }
  if (!isLegacyOrderStatusSlug(orderStatus)) return "inProgress";
  return null;
}

const KPI_KEY_TO_SUMMARY: Record<OrderStatusKpiKey, keyof OrdersStatusSummary> = {
  open: "open",
  inProgress: "inProgress",
  completed: "completed",
  cancelled: "cancelled",
  debtWithdrawal: "debtWithdrawal",
};

/** עדכון KPI מקומי אחרי שינוי סטטוס בשורה — ללא refetch */
export function adjustStatusSummaryForStatusChange(
  summary: OrdersStatusSummary,
  prevStatus: string,
  nextStatus: string,
  orderTotalUsd: number,
): OrdersStatusSummary {
  const prevKey = orderStatusToKpiBucketKey(prevStatus);
  const nextKey = orderStatusToKpiBucketKey(nextStatus);
  if (prevKey === nextKey) return summary;
  const usd = Number.isFinite(orderTotalUsd) ? orderTotalUsd : 0;
  let next = { ...summary };
  if (prevKey) {
    const field = KPI_KEY_TO_SUMMARY[prevKey];
    next = { ...next, [field]: bumpBucket(next[field], -1, -usd) };
  }
  if (nextKey) {
    const field = KPI_KEY_TO_SUMMARY[nextKey];
    next = { ...next, [field]: bumpBucket(next[field], 1, usd) };
  }
  return next;
}
