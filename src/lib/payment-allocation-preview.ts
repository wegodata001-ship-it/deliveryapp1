import {
  buildPaymentAllocationClosureQueue,
  computeEffectiveRowCommissionUsd,
  roundMoney2,
  type PaymentIntakeMatchResult,
  type PaymentIntakeOrderBase,
} from "@/lib/payment-intake";

const ALLOC_EPS = 0.02;

export type PaymentAllocationPreviewOrderRow = {
  orderId: string;
  orderNumber: string;
  beforeUsd: number;
  allocatedUsd: number;
  afterUsd: number;
  sourceUsd: number;
  commissionPercent: number;
  commissionUsd: number;
  afterCommissionUsd: number;
};

export type PaymentAllocationPreviewResult = {
  orders: PaymentAllocationPreviewOrderRow[];
  totalAllocatedUsd: number;
  unallocatedUsd: number;
  paymentTotalUsd: number;
  /** להצגה — יש סכום תשלום בטופס */
  show: boolean;
  hasAllocations: boolean;
};

function previewRowFromMatch(
  r: PaymentIntakeMatchResult,
  commissionPercent: number,
): PaymentAllocationPreviewOrderRow {
  const beforeUsd = roundMoney2(Math.max(0, r.totalAmountUsd - r.dbPaidUsd));
  const commissionUsd = computeEffectiveRowCommissionUsd(r.amountUsd, r.commissionUsd, commissionPercent);
  return {
    orderId: r.id,
    orderNumber: r.orderNumber?.trim() || r.paymentCode?.trim() || "—",
    beforeUsd,
    allocatedUsd: roundMoney2(r.allocationUsd),
    afterUsd: roundMoney2(r.remainingAmount),
    sourceUsd: roundMoney2(r.amountUsd),
    commissionPercent,
    commissionUsd,
    afterCommissionUsd: roundMoney2(r.totalAmountUsd),
  };
}

/**
 * תצוגת הקצאה חיה (Preview Allocation) — לפני שמירה, לפי סדר סגירת החובות.
 * ללא עדכון DB.
 */
export function buildPaymentAllocationPreview(
  matched: PaymentIntakeMatchResult[],
  paymentTotalUsd: number,
  commissionPercent: number,
  ordersOldestFirst: PaymentIntakeOrderBase[],
  prioritizedOrderIds: Set<string> | null,
): PaymentAllocationPreviewResult {
  const paymentTotal = roundMoney2(Number.isFinite(paymentTotalUsd) ? paymentTotalUsd : 0);
  const pct = Number.isFinite(commissionPercent) ? commissionPercent : 0;
  const byId = new Map(matched.map((m) => [m.id, m]));

  const closureQueue = buildPaymentAllocationClosureQueue(ordersOldestFirst, prioritizedOrderIds);
  const seen = new Set<string>();
  const orders: PaymentAllocationPreviewOrderRow[] = [];

  for (const base of closureQueue) {
    const r = byId.get(base.id);
    if (!r) continue;
    seen.add(r.id);
    orders.push(previewRowFromMatch(r, pct));
  }

  for (const r of matched) {
    if (seen.has(r.id)) continue;
    const beforeUsd = roundMoney2(Math.max(0, r.totalAmountUsd - r.dbPaidUsd));
    if (beforeUsd <= ALLOC_EPS && r.allocationUsd <= ALLOC_EPS) continue;
    orders.push(previewRowFromMatch(r, pct));
  }

  const withDebt = orders.filter((o) => o.beforeUsd > ALLOC_EPS || o.allocatedUsd > ALLOC_EPS);
  const displayOrders = paymentTotal > ALLOC_EPS ? withDebt : [];

  const totalAllocatedUsd = roundMoney2(
    displayOrders.reduce((s, o) => s + o.allocatedUsd, 0),
  );
  const unallocatedUsd = roundMoney2(Math.max(0, paymentTotal - totalAllocatedUsd));

  return {
    orders: displayOrders,
    totalAllocatedUsd,
    unallocatedUsd,
    paymentTotalUsd: paymentTotal,
    show: paymentTotal > ALLOC_EPS,
    hasAllocations: displayOrders.some((o) => o.allocatedUsd > ALLOC_EPS),
  };
}

/** יתרה לפני הקצאת התשלום הנוכחי (מ-DB) */
export function orderBalanceBeforeAllocation(row: PaymentIntakeMatchResult): number {
  return roundMoney2(Math.max(0, row.totalAmountUsd - row.dbPaidUsd));
}
