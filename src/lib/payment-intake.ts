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
  lastPaymentDateYmd: string | null;
};

export type PaymentIntakeMatchResult = PaymentIntakeOrderBase & {
  paidAmount: number;
  remainingAmount: number;
  status: PaymentIntakeOrderStatus;
  /** סכום מהקליטה הנוכחית שיוקצה להזמנה זו */
  allocationUsd: number;
  /** תוצאת הקצאה מהתשלום הנוכחי */
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

/** יתרת הזמנה ב-USD (חתום: שלילי = זכות לקוח / תשלום עודף) */
export function orderLedgerBalanceUsd(
  o: Pick<PaymentIntakeOrderBase, "totalAmountUsd" | "dbPaidUsd">,
): number {
  return roundMoney2(o.totalAmountUsd - o.dbPaidUsd);
}

export type PaymentLedgerStatus = "paid" | "open" | "credit";

export function paymentLedgerStatus(balanceUsd: number): PaymentLedgerStatus {
  if (balanceUsd > 0.02) return "open";
  if (balanceUsd < -0.02) return "credit";
  return "paid";
}

export function paymentLedgerStatusLabel(status: PaymentLedgerStatus): string {
  if (status === "open") return "יתרה פתוחה";
  if (status === "credit") return "זכות לקוח";
  return "שולם";
}

/** עמלה לשורה: מהזמנה, או משוערת מאחוז העמלה בקליטה אם אין עמלה שמורה */
export function computeEffectiveRowCommissionUsd(
  amountUsd: number,
  commissionUsd: number,
  commissionPercent = 0,
): number {
  const dbCom = Number(commissionUsd);
  if (Number.isFinite(dbCom) && dbCom > 0) return dbCom;
  const amt = Number(amountUsd);
  const pct = Number(commissionPercent);
  if (!Number.isFinite(amt) || amt <= 0 || !Number.isFinite(pct) || pct <= 0) return 0;
  return roundMoney2((amt * pct) / 100);
}

/** סכום עמלות זמינות ויתרה פתוחה לפי שורות טבלת הקליטה (לא סיכום גלובלי שגוי). */
export function computeCustomerResetBalanceMetrics(
  rows: Pick<PaymentIntakeOrderBase, "commissionUsd" | "amountUsd" | "totalAmountUsd" | "dbPaidUsd">[],
  commissionPercent = 0,
): { availableCommission: number; remainingAmount: number } {
  let availableCommission = 0;
  let remainingAmount = 0;
  for (const row of rows) {
    availableCommission += computeEffectiveRowCommissionUsd(
      row.amountUsd,
      row.commissionUsd,
      commissionPercent,
    );
    const total = Number(row.totalAmountUsd);
    const paid = Number(row.dbPaidUsd);
    if (Number.isFinite(total) && Number.isFinite(paid)) {
      remainingAmount += Math.max(0, total - paid);
    }
  }
  return {
    availableCommission: roundMoney2(availableCommission),
    remainingAmount: roundMoney2(remainingAmount),
  };
}

function orderRemainingUsd(o: PaymentIntakeOrderBase): number {
  return roundMoney2(Math.max(0, o.totalAmountUsd - o.dbPaidUsd));
}

type ClosureDebtRow = { o: PaymentIntakeOrderBase; idx: number; remaining: number };

/** תור סגירת חובות — עדיפות מסומנת ואז כרונולוגי (ישן → חדש) */
export function buildPaymentAllocationClosureQueue(
  ordersOldestFirst: PaymentIntakeOrderBase[],
  prioritizedOrderIds: Set<string> | null,
): PaymentIntakeOrderBase[] {
  const debtRows: ClosureDebtRow[] = ordersOldestFirst
    .map((o, idx) => ({ o, idx, remaining: orderRemainingUsd(o) }))
    .filter((x) => x.remaining > EPS);

  const hasPriority = prioritizedOrderIds != null && prioritizedOrderIds.size > 0;
  const priorityRows = hasPriority
    ? debtRows.filter((x) => prioritizedOrderIds!.has(x.o.id))
    : [];
  const restRows = hasPriority
    ? debtRows.filter((x) => !prioritizedOrderIds!.has(x.o.id))
    : debtRows;

  const byOldestFirst = (a: ClosureDebtRow, b: ClosureDebtRow) => a.idx - b.idx;
  priorityRows.sort(byOldestFirst);
  restRows.sort(byOldestFirst);

  return [...priorityRows, ...restRows].map((x) => x.o);
}

/**
 * מנוע הקצאה מרכזי לקליטת תשלום רגילה + מעודכנת.
 * rules:
 * - המערך `ordersOldestFirst` חייב להיות ממוין מהישן לחדש (למשל orderDate asc).
 * - ללא סימון ידני: סגירת חובות לפי סדר כרונולוגי — קודם ההזמנה הישנה ביותר עם יתרה.
 * - עם סימון ידני: קודם כל ההזמנות המסומנות (בתוכן — מהישן לחדש), ואז שאר החובות (מהישן לחדש).
 */
export function allocatePaymentAcrossOrders(
  ordersOldestFirst: PaymentIntakeOrderBase[],
  totalUsd: number,
  prioritizedOrderIds: Set<string> | null,
): { byOrderId: Map<string, number>; unallocatedUsd: number } {
  let remainingPayment = roundMoney2(Number.isFinite(totalUsd) ? totalUsd : 0);
  if (remainingPayment < 0) remainingPayment = 0;

  const queue = buildPaymentAllocationClosureQueue(ordersOldestFirst, prioritizedOrderIds);
  const byOrderId = new Map<string, number>();

  for (const o of queue) {
    if (remainingPayment <= EPS) break;
    const debtRem = orderRemainingUsd(o);
    const alloc = roundMoney2(Math.min(remainingPayment, debtRem));
    if (alloc <= EPS) continue;
    byOrderId.set(o.id, alloc);
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
  /** תאריך תשלום אחרון (אם קיים) */
  lastPaymentDateYmd: string | null;
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
      lastPaymentDateYmd: r.lastPaymentDateYmd,
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
