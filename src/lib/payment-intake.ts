/** קליטת תשלום — חישובי תצוגה ומנוע התאמה (ללא Prisma) */

export type PaymentIntakeOrderStatus = "unpaid" | "partial" | "paid";

export type PaymentIntakeOrderBase = {
  id: string;
  orderNumber: string | null;
  paymentCode: string | null;
  dateYmd: string;
  week: string | null;
  rate: number;
  amountUsd: number;
  commissionUsd: number;
  totalIls: number;
  /** סה״כ חוב בהזמנה ב-USD (עסקה + עמלה) */
  totalAmountUsd: number;
  /** שולם עד כה (DB) ב-USD */
  dbPaidUsd: number;
};

export type PaymentIntakeMatchResult = PaymentIntakeOrderBase & {
  paidAmount: number;
  remainingAmount: number;
  status: PaymentIntakeOrderStatus;
  /** סכום מהקליטה הנוכחית שיוקצה להזמנה זו */
  allocationUsd: number;
  /** תוצאת הקצאה מהתשלום הנוכחי — לתצוגת היילייט */
  allocationOutcome: "none" | "partial" | "paid";
};

const EPS = 1e-6;

export function debtStatus(dbPaid: number, total: number): PaymentIntakeOrderStatus {
  const rem = total - dbPaid;
  if (rem <= EPS) return "paid";
  if (dbPaid <= EPS) return "unpaid";
  return "partial";
}

/** Part 6 — המרה ל-USD לפי שער */
export function computeIntakeTotalUsd(params: {
  usdPaid: number;
  ilsPaid: number;
  transferPaid: number;
  dollarRate: number;
}): number {
  const r = params.dollarRate;
  if (!Number.isFinite(r) || r <= 0) return 0;
  const u = Number.isFinite(params.usdPaid) ? params.usdPaid : 0;
  const i = Number.isFinite(params.ilsPaid) ? params.ilsPaid : 0;
  const t = Number.isFinite(params.transferPaid) ? params.transferPaid : 0;
  const fromIls = i / r;
  const fromTr = t / r;
  return u + fromIls + fromTr;
}

export function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function orderRemainingUsd(o: PaymentIntakeOrderBase): number {
  return roundMoney2(Math.max(0, o.totalAmountUsd - o.dbPaidUsd));
}

/**
 * מנוע הקצאה מרכזי לקליטת תשלום רגילה + מעודכנת.
 * rules:
 * - ללא סימון ידני: סגירה מהסכום הקטן לגדול
 * - עם סימון ידני: קודם מסומנות, ואז קטנות לגדול מהשאר
 */
export function allocatePaymentAcrossOrders(
  ordersOldestFirst: PaymentIntakeOrderBase[],
  totalUsd: number,
  prioritizedOrderIds: Set<string> | null,
): { byOrderId: Map<string, number>; unallocatedUsd: number } {
  let remainingPayment = roundMoney2(Number.isFinite(totalUsd) ? totalUsd : 0);
  if (remainingPayment < 0) remainingPayment = 0;

  const debtRows = ordersOldestFirst
    .map((o, idx) => ({ o, idx, remaining: orderRemainingUsd(o) }))
    .filter((x) => x.remaining > EPS);

  const hasPriority = prioritizedOrderIds != null && prioritizedOrderIds.size > 0;
  const priorityRows = hasPriority
    ? debtRows.filter((x) => prioritizedOrderIds!.has(x.o.id))
    : [];
  const restRows = hasPriority
    ? debtRows.filter((x) => !prioritizedOrderIds!.has(x.o.id))
    : debtRows;

  const bySmallestThenInput = (a: { remaining: number; idx: number }, b: { remaining: number; idx: number }) =>
    a.remaining - b.remaining || a.idx - b.idx;

  priorityRows.sort(bySmallestThenInput);
  restRows.sort(bySmallestThenInput);

  const queue = [...priorityRows, ...restRows];
  const byOrderId = new Map<string, number>();

  for (const row of queue) {
    if (remainingPayment <= EPS) break;
    const alloc = roundMoney2(Math.min(remainingPayment, row.remaining));
    if (alloc <= EPS) continue;
    byOrderId.set(row.o.id, alloc);
    remainingPayment = roundMoney2(remainingPayment - alloc);
  }

  return { byOrderId, unallocatedUsd: remainingPayment };
}

export function matchPaymentToOrders(
  ordersOldestFirst: PaymentIntakeOrderBase[],
  totalUsd: number,
  prioritizedOrderIds: Set<string> | null,
): PaymentIntakeMatchResult[] {
  const allocated = allocatePaymentAcrossOrders(ordersOldestFirst, totalUsd, prioritizedOrderIds);
  return ordersOldestFirst.map((o) => {
    const dbRem = orderRemainingUsd(o);
    const allocationUsd = roundMoney2(allocated.byOrderId.get(o.id) ?? 0);
    const previewPaid = roundMoney2(o.dbPaidUsd + allocationUsd);
    const previewRem = roundMoney2(Math.max(0, dbRem - allocationUsd));
    const previewStatus = previewRem <= EPS ? "paid" : previewPaid <= EPS ? "unpaid" : "partial";
    const allocationOutcome: "none" | "partial" | "paid" =
      allocationUsd <= EPS ? "none" : previewRem <= EPS ? "paid" : "partial";
    return {
      ...o,
      paidAmount: previewPaid,
      remainingAmount: previewRem,
      status: previewStatus,
      allocationUsd,
      allocationOutcome,
    };
  });
}

/** שורה מה-API (רשימת הזמנות ללקוח) */
export type PaymentIntakeOrderRow = {
  id: string;
  orderNumber: string | null;
  paymentCode: string | null;
  dateYmd: string;
  week: string | null;
  rate: string;
  amountUsd: string;
  commissionUsd: string;
  totalIls: string;
  totalAmountUsd: string;
  dbPaidUsd: string;
  dbRemainingUsd: string;
  status: PaymentIntakeOrderStatus;
  /** מדינת מקור מהזמנה (תצוגה בלבד) */
  sourceCountry: string | null;
};

export function toPaymentIntakeBases(rows: PaymentIntakeOrderRow[]): PaymentIntakeOrderBase[] {
  return rows.map((r) => {
    const rateNum = Number((r.rate || "").replace(",", "."));
    return {
      id: r.id,
      orderNumber: r.orderNumber,
      paymentCode: r.paymentCode,
      dateYmd: r.dateYmd,
      week: r.week,
      rate: Number.isFinite(rateNum) ? rateNum : 0,
      amountUsd: Number(r.amountUsd),
      commissionUsd: Number(r.commissionUsd),
      totalIls: Number(r.totalIls),
      totalAmountUsd: Number(r.totalAmountUsd),
      dbPaidUsd: Number(r.dbPaidUsd),
    };
  });
}

const ALLOC_EPS = 0.02;

export function buildAllocationsFromMatch(
  bases: PaymentIntakeOrderBase[],
  totalUsd: number,
  prioritized: Set<string> | null,
): { orderId: string; amountUsd: string }[] {
  const m = matchPaymentToOrders(bases, totalUsd, prioritized);
  return m
    .filter((x) => x.allocationUsd > ALLOC_EPS)
    .map((x) => ({ orderId: x.id, amountUsd: roundMoney2(x.allocationUsd).toFixed(2) }));
}

export function verifyTotalUsdAgainstInputs(form: {
  usdPaid: number;
  ilsPaid: number;
  transferPaid: number;
  dollarRate: number;
  totalUsdReported: number;
}): boolean {
  const calc = roundMoney2(
    computeIntakeTotalUsd({
      usdPaid: form.usdPaid,
      ilsPaid: form.ilsPaid,
      transferPaid: form.transferPaid,
      dollarRate: form.dollarRate,
    }),
  );
  return Math.abs(calc - roundMoney2(form.totalUsdReported)) <= ALLOC_EPS;
}
