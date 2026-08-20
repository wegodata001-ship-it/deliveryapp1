import { COMPOSITE_PM, paymentMethodBucketKey, PAYMENT_BUCKET_LABELS, type OrderBreakdownLineInput, type PaymentBucketKey } from "@/lib/payment-breakdown-shared";
import { roundMoney2, type OrderBreakdownMethodRow, type PaymentIntakeOrderRow } from "@/lib/payment-intake";

const EPS = 0.02;

export type PaymentMethodAdjustmentReasonCode =
  | "CUSTOMER_REQUEST"
  | "ORDER_ENTRY_ERROR"
  | "PAYMENT_METHOD_RECORD_ERROR"
  | "PAYMENT_TERMS_CHANGED"
  | "MANAGER_INSTRUCTION"
  | "ACCOUNTING_ADJUSTMENT"
  | "OTHER";

export const PAYMENT_METHOD_ADJUSTMENT_REASON_OPTIONS: Array<{
  code: PaymentMethodAdjustmentReasonCode;
  label: string;
}> = [
  { code: "CUSTOMER_REQUEST", label: "בקשת לקוח / שינוי אמצעי תשלום" },
  { code: "ORDER_ENTRY_ERROR", label: "טעות בהזנת ההזמנה" },
  { code: "PAYMENT_METHOD_RECORD_ERROR", label: "טעות ברישום אמצעי התשלום" },
  { code: "PAYMENT_TERMS_CHANGED", label: "שינוי תנאי תשלום" },
  { code: "MANAGER_INSTRUCTION", label: "הנחיית מנהל" },
  { code: "ACCOUNTING_ADJUSTMENT", label: "התאמה חשבונאית" },
  { code: "OTHER", label: "אחר" },
] as const;

export type PaymentMethodAdjustmentOrderPreview = {
  orderId: string;
  orderNumber: string;
  dateYmd: string;
  availableUsd: number;
  moveUsd: number;
  sourceRemainingAfterUsd: number;
  currentMethodLabel: string;
  newMethodLabel: string;
  beforeBreakdown: OrderBreakdownLineInput[];
  afterBreakdown: OrderBreakdownLineInput[];
};

export type PaymentMethodAdjustmentPreview = {
  fromMethod: string;
  toMethod: string;
  fromLabel: string;
  toLabel: string;
  requestedAmountUsd: number;
  customerOpenDebtUsd: number;
  currentFromOpenUsd: number;
  currentToOpenUsd: number;
  afterFromOpenUsd: number;
  afterToOpenUsd: number;
  affectedOrdersCount: number;
  affectedOrders: PaymentMethodAdjustmentOrderPreview[];
};

function methodLabel(method: string): string {
  return PAYMENT_BUCKET_LABELS[paymentMethodBucketKey(method)];
}

function normalizedOrderNumber(value: string | null | undefined): string {
  return value?.trim() || "—";
}

function byOldestFirst(a: PaymentIntakeOrderRow, b: PaymentIntakeOrderRow): number {
  const byDate = (a.dateYmd || "").localeCompare(b.dateYmd || "");
  if (byDate !== 0) return byDate;
  return normalizedOrderNumber(a.orderNumber).localeCompare(normalizedOrderNumber(b.orderNumber), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function nativeRemaining(row: OrderBreakdownMethodRow): number {
  if (typeof row.remaining === "number" && Number.isFinite(row.remaining)) return roundMoney2(Math.max(0, row.remaining));
  return roundMoney2(Math.max(0, row.remainingUsd));
}

function nativePlanned(row: OrderBreakdownMethodRow): number {
  if (typeof row.planned === "number" && Number.isFinite(row.planned)) return roundMoney2(Math.max(0, row.planned));
  return roundMoney2(Math.max(0, row.plannedUsd));
}

function nativePaid(row: OrderBreakdownMethodRow): number {
  if (typeof row.paid === "number" && Number.isFinite(row.paid)) return roundMoney2(Math.max(0, row.paid));
  return roundMoney2(Math.max(0, row.paidUsd));
}

function usdRemainingForMethod(row: OrderBreakdownMethodRow, bucket: PaymentBucketKey): number {
  if (paymentMethodBucketKey(row.method) !== bucket) return 0;
  return roundMoney2(Math.max(0, row.remainingUsd));
}

function toEditableBreakdownLines(rows: OrderBreakdownMethodRow[]): OrderBreakdownLineInput[] {
  return rows.map((row) => ({
    paymentMethod: row.method,
    amount: nativePlanned(row).toFixed(2),
    currency: row.currency === "ILS" ? "ILS" : "USD",
  }));
}

function computeMethodOpenUsd(rows: PaymentIntakeOrderRow[], bucket: PaymentBucketKey): number {
  return roundMoney2(
    rows.reduce(
      (sum, order) =>
        sum +
        order.breakdown.reduce((rowSum, row) => rowSum + usdRemainingForMethod(row, bucket), 0),
      0,
    ),
  );
}

function buildAdjustedBreakdownForOrder(params: {
  order: PaymentIntakeOrderRow;
  fromMethod: string;
  toMethod: string;
  moveUsd: number;
}): OrderBreakdownLineInput[] {
  const fromBucket = paymentMethodBucketKey(params.fromMethod);
  const rateN = Number((params.order.rate || "").replace(",", "."));
  const rows = params.order.breakdown.map((row) => ({
    paymentMethod: row.method,
    currency: row.currency === "ILS" ? "ILS" as const : "USD" as const,
    plannedNative: nativePlanned(row),
    paidNative: nativePaid(row),
    remainingNative: nativeRemaining(row),
    remainingUsd: roundMoney2(Math.max(0, row.remainingUsd)),
  }));

  let leftUsd = roundMoney2(params.moveUsd);
  const additions = new Map<"USD" | "ILS", number>();
  for (const row of rows) {
    if (leftUsd <= EPS) break;
    if (paymentMethodBucketKey(row.paymentMethod) !== fromBucket) continue;
    if (row.remainingUsd <= EPS || row.remainingNative <= EPS) continue;
    const takeUsd = Math.min(leftUsd, row.remainingUsd);
    const ratio = row.remainingUsd > EPS
      ? row.remainingNative / row.remainingUsd
      : row.currency === "ILS" && rateN > EPS
        ? rateN
        : 1;
    let takeNative = roundMoney2(takeUsd * ratio);
    if (Math.abs(takeUsd - row.remainingUsd) <= EPS) takeNative = row.remainingNative;
    takeNative = Math.min(takeNative, row.remainingNative);
    row.plannedNative = roundMoney2(row.plannedNative - takeNative);
    row.remainingNative = roundMoney2(row.remainingNative - takeNative);
    row.remainingUsd = roundMoney2(row.remainingUsd - takeUsd);
    additions.set(row.currency, roundMoney2((additions.get(row.currency) ?? 0) + takeNative));
    leftUsd = roundMoney2(leftUsd - takeUsd);
  }

  if (leftUsd > EPS) {
    throw new Error("לא נמצאה יתרה מספקת להעברה באותו אמצעי תשלום");
  }

  for (const [currency, addNative] of additions) {
    if (addNative <= EPS) continue;
    const existingTarget = rows.find((row) => row.paymentMethod === params.toMethod && row.currency === currency);
    if (existingTarget) {
      existingTarget.plannedNative = roundMoney2(existingTarget.plannedNative + addNative);
      existingTarget.remainingNative = roundMoney2(existingTarget.remainingNative + addNative);
      continue;
    }
    rows.push({
      paymentMethod: params.toMethod,
      currency,
      plannedNative: addNative,
      paidNative: 0,
      remainingNative: addNative,
      remainingUsd: currency === "ILS" && rateN > EPS ? roundMoney2(addNative / rateN) : addNative,
    });
  }

  return rows
    .filter((row) => row.plannedNative > EPS)
    .map((row) => ({
      paymentMethod: row.paymentMethod,
      amount: row.plannedNative.toFixed(2),
      currency: row.currency,
    }));
}

export function paymentMethodForBreakdown(lines: OrderBreakdownLineInput[]): string {
  if (lines.length === 0) return "";
  return lines.length === 1 ? lines[0]!.paymentMethod : COMPOSITE_PM;
}

export function buildPaymentMethodAutoAdjustmentPreview(params: {
  orders: PaymentIntakeOrderRow[];
  fromMethod: string;
  toMethod: string;
  amountUsd: number;
}): { ok: true; preview: PaymentMethodAdjustmentPreview } | { ok: false; error: string } {
  const fromMethod = params.fromMethod.trim();
  const toMethod = params.toMethod.trim();
  const amountUsd = roundMoney2(params.amountUsd);
  if (!fromMethod || !toMethod) return { ok: false, error: "יש לבחור אמצעי מקור ויעד" };
  if (paymentMethodBucketKey(fromMethod) === paymentMethodBucketKey(toMethod)) {
    return { ok: false, error: "יש לבחור שני אמצעי תשלום שונים" };
  }
  if (!(amountUsd > EPS)) return { ok: false, error: "יש להזין סכום התאמה חיובי" };

  const fromBucket = paymentMethodBucketKey(fromMethod);
  const toBucket = paymentMethodBucketKey(toMethod);
  const sortedOrders = [...params.orders].sort(byOldestFirst);
  const customerOpenDebtUsd = roundMoney2(sortedOrders.reduce((sum, order) => sum + Math.max(0, Number(order.dbRemainingUsd) || 0), 0));
  const currentFromOpenUsd = computeMethodOpenUsd(sortedOrders, fromBucket);
  const currentToOpenUsd = computeMethodOpenUsd(sortedOrders, toBucket);
  if (amountUsd > currentFromOpenUsd + EPS) {
    return {
      ok: false,
      error: `אין מספיק יתרה פתוחה ב${methodLabel(fromMethod)}. זמין להעברה: $${currentFromOpenUsd.toFixed(2)}`,
    };
  }

  const candidates = sortedOrders
    .map((order) => ({
      order,
      availableUsd: roundMoney2(
        order.breakdown.reduce((sum, row) => sum + usdRemainingForMethod(row, fromBucket), 0),
      ),
    }))
    .filter((entry) => entry.availableUsd > EPS);

  let leftUsd = amountUsd;
  const affectedOrders: PaymentMethodAdjustmentOrderPreview[] = [];
  for (const entry of candidates) {
    if (leftUsd <= EPS) break;
    const moveUsd = roundMoney2(Math.min(leftUsd, entry.availableUsd));
    if (moveUsd <= EPS) continue;
    affectedOrders.push({
      orderId: entry.order.id,
      orderNumber: normalizedOrderNumber(entry.order.orderNumber),
      dateYmd: entry.order.dateYmd,
      availableUsd: entry.availableUsd,
      moveUsd,
      sourceRemainingAfterUsd: roundMoney2(entry.availableUsd - moveUsd),
      currentMethodLabel: methodLabel(fromMethod),
      newMethodLabel: methodLabel(toMethod),
      beforeBreakdown: toEditableBreakdownLines(entry.order.breakdown),
      afterBreakdown: buildAdjustedBreakdownForOrder({
        order: entry.order,
        fromMethod,
        toMethod,
        moveUsd,
      }),
    });
    leftUsd = roundMoney2(leftUsd - moveUsd);
  }

  if (leftUsd > EPS) {
    return { ok: false, error: "לא ניתן להגיע לסכום ההתאמה המבוקש מתוך היתרה הפתוחה" };
  }

  return {
    ok: true,
    preview: {
      fromMethod,
      toMethod,
      fromLabel: methodLabel(fromMethod),
      toLabel: methodLabel(toMethod),
      requestedAmountUsd: amountUsd,
      customerOpenDebtUsd,
      currentFromOpenUsd,
      currentToOpenUsd,
      afterFromOpenUsd: roundMoney2(currentFromOpenUsd - amountUsd),
      afterToOpenUsd: roundMoney2(currentToOpenUsd + amountUsd),
      affectedOrdersCount: affectedOrders.length,
      affectedOrders,
    },
  };
}
