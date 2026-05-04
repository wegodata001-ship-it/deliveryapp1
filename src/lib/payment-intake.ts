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

/**
 * Part 7 — מנוע התאמה.
 * eligibleOrderIds:
 *   - null → כל ההזמנות עם יתרה משתתפות
 *   - Set (כולל ריק) → רק מזהים ב-Set (Set ריק = אף הזמנה לא משתתפת)
 * סדר קלט: מהישן לחדש
 */
export function matchPaymentToOrders(
  ordersOldestFirst: PaymentIntakeOrderBase[],
  totalUsd: number,
  eligibleOrderIds: Set<string> | null,
): PaymentIntakeMatchResult[] {
  let remainingPayment = roundMoney2(Number.isFinite(totalUsd) ? totalUsd : 0);
  if (remainingPayment < 0) remainingPayment = 0;

  const useFilter = eligibleOrderIds !== null;

  return ordersOldestFirst.map((o) => {
    const dbRem = roundMoney2(Math.max(0, o.totalAmountUsd - o.dbPaidUsd));
    let allocationUsd = 0;
    let previewPaid = o.dbPaidUsd;
    let previewRem = dbRem;
    let previewStatus = debtStatus(o.dbPaidUsd, o.totalAmountUsd);

    const inFilter = !useFilter || (eligibleOrderIds?.has(o.id) ?? false);
    const participates = dbRem > EPS && inFilter;

    if (participates && remainingPayment > EPS) {
      if (remainingPayment + EPS >= dbRem) {
        allocationUsd = dbRem;
        previewPaid = roundMoney2(o.dbPaidUsd + dbRem);
        previewRem = 0;
        previewStatus = "paid";
        remainingPayment = roundMoney2(remainingPayment - dbRem);
      } else {
        allocationUsd = remainingPayment;
        previewPaid = roundMoney2(o.dbPaidUsd + remainingPayment);
        previewRem = roundMoney2(dbRem - remainingPayment);
        previewStatus = "partial";
        remainingPayment = 0;
      }
    }

    return {
      ...o,
      paidAmount: previewPaid,
      remainingAmount: previewRem,
      status: previewStatus,
      allocationUsd,
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
  eligible: Set<string> | null,
): { orderId: string; amountUsd: string }[] {
  const m = matchPaymentToOrders(bases, totalUsd, eligible);
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
