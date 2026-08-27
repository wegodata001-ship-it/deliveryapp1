import { COMPOSITE_PM, paymentMethodBucketKey, PAYMENT_BUCKET_LABELS, type OrderBreakdownLineInput, type PaymentBucketKey } from "@/lib/payment-breakdown-shared";
import { roundMoney2, type OrderBreakdownMethodRow, type PaymentIntakeOrderRow } from "@/lib/payment-intake";
import type { PaymentIntakeCustomerPaymentRow } from "@/lib/payment-intake-customer-kpi";
import {
  aggregateCapturedPaymentsByMethodCurrency,
  aggregateOrderPlannedOpenByMethodCurrency,
  buildMethodBalanceCards,
  suggestPaymentMethodAdjustment,
  type MethodBalanceCard,
  type MethodCurrencyAmount,
  type PaymentBalanceCurrency,
  type PaymentMethodAdjustmentSuggestion,
} from "@/lib/payment-method-captured-balances";

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
  /** מטבע ההתאמה */
  currency: PaymentBalanceCurrency;
  /** סכום במטבע המקור */
  amountNative: number;
  /** שער — רק אם currency=ILS */
  exchangeRate: number | null;
  requestedAmountUsd: number;
  customerOpenDebtUsd: number;
  /** יתרות מתוכננות בהזמנות (לפני) */
  currentFromOpenUsd: number;
  currentToOpenUsd: number;
  currentFromOpenNative: number;
  currentToOpenNative: number;
  afterFromOpenUsd: number;
  afterToOpenUsd: number;
  afterFromOpenNative: number;
  afterToOpenNative: number;
  /** תשלומים שנקלטו בפועל */
  capturedBalances: MethodCurrencyAmount[];
  /** יתרה מתוכננת פתוחה בהזמנות */
  plannedOpenBalances: MethodCurrencyAmount[];
  /** כרטיסי קופות לתצוגה */
  capturedCards: MethodBalanceCard[];
  plannedCards: MethodBalanceCard[];
  /** סה״כ תשלומים שנקלטו — לא משתנה בהתאמה */
  capturedTotalUsd: number;
  affectedOrdersCount: number;
  affectedOrders: PaymentMethodAdjustmentOrderPreview[];
  suggestion: PaymentMethodAdjustmentSuggestion | null;
  /** לפני/אחרי — יתרות מתוכננות לפי אמצעי (USD בלבד לתצוגה) */
  beforeMethodUsd: { from: number; to: number };
  afterMethodUsd: { from: number; to: number };
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

function nativeRemainingForMethodCurrency(
  row: OrderBreakdownMethodRow,
  bucket: PaymentBucketKey,
  currency: PaymentBalanceCurrency,
): number {
  if (paymentMethodBucketKey(row.method) !== bucket) return 0;
  const rowCurrency: PaymentBalanceCurrency = row.currency === "ILS" ? "ILS" : "USD";
  if (rowCurrency !== currency) return 0;
  return nativeRemaining(row);
}

function computeMethodOpenNative(
  rows: PaymentIntakeOrderRow[],
  bucket: PaymentBucketKey,
  currency: PaymentBalanceCurrency,
): number {
  return roundMoney2(
    rows.reduce(
      (sum, order) =>
        sum +
        order.breakdown.reduce(
          (rowSum, row) => rowSum + nativeRemainingForMethodCurrency(row, bucket, currency),
          0,
        ),
      0,
    ),
  );
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
  sourceCurrency?: PaymentBalanceCurrency | null;
  moveNative?: number | null;
}): OrderBreakdownLineInput[] {
  const fromBucket = paymentMethodBucketKey(params.fromMethod);
  const sourceCurrency = params.sourceCurrency ?? "USD";
  const rateN = Number((params.order.rate || "").replace(",", "."));
  const moveNativeTarget =
    params.moveNative != null && params.moveNative > 0
      ? roundMoney2(params.moveNative)
      : sourceCurrency === "USD"
        ? roundMoney2(params.moveUsd)
        : rateN > 0
          ? roundMoney2(params.moveUsd * rateN)
          : roundMoney2(params.moveUsd);

  const rows = params.order.breakdown.map((row) => ({
    paymentMethod: row.method,
    currency: row.currency === "ILS" ? "ILS" as const : "USD" as const,
    plannedNative: nativePlanned(row),
    paidNative: nativePaid(row),
    remainingNative: nativeRemaining(row),
    remainingUsd: roundMoney2(Math.max(0, row.remainingUsd)),
  }));

  let leftNative = moveNativeTarget;
  let leftUsd = roundMoney2(params.moveUsd);
  const additions = new Map<"USD" | "ILS", number>();
  for (const row of rows) {
    if (leftNative <= EPS && leftUsd <= EPS) break;
    if (paymentMethodBucketKey(row.paymentMethod) !== fromBucket) continue;
    if (row.currency !== sourceCurrency) continue;
    if (row.remainingNative <= EPS || row.remainingUsd <= EPS) continue;

    const takeNative = roundMoney2(Math.min(leftNative, row.remainingNative));
    const ratio = row.remainingNative > EPS ? row.remainingUsd / row.remainingNative : sourceCurrency === "ILS" && rateN > 0 ? 1 / rateN : 1;
    let takeUsd = roundMoney2(takeNative * ratio);
    if (Math.abs(takeNative - row.remainingNative) <= EPS) takeUsd = row.remainingUsd;

    row.plannedNative = roundMoney2(row.plannedNative - takeNative);
    row.remainingNative = roundMoney2(row.remainingNative - takeNative);
    row.remainingUsd = roundMoney2(row.remainingUsd - takeUsd);
    additions.set(row.currency, roundMoney2((additions.get(row.currency) ?? 0) + takeNative));
    leftNative = roundMoney2(leftNative - takeNative);
    leftUsd = roundMoney2(leftUsd - takeUsd);
  }

  if (leftNative > EPS || leftUsd > EPS) {
    throw new Error("לא נמצאה יתרה מספקת להעברה באותו אמצעי תשלום ומטבע");
  }

  const targetCurrency = sourceCurrency;
  for (const [currency, addNative] of additions) {
    if (addNative <= EPS) continue;
    const existingTarget = rows.find((row) => row.paymentMethod === params.toMethod && row.currency === currency);
    if (existingTarget) {
      existingTarget.plannedNative = roundMoney2(existingTarget.plannedNative + addNative);
      existingTarget.remainingNative = roundMoney2(existingTarget.remainingNative + addNative);
      if (currency === "ILS" && rateN > 0) {
        existingTarget.remainingUsd = roundMoney2(existingTarget.remainingUsd + addNative / rateN);
      } else {
        existingTarget.remainingUsd = roundMoney2(existingTarget.remainingUsd + addNative);
      }
      continue;
    }
    rows.push({
      paymentMethod: params.toMethod,
      currency: targetCurrency,
      plannedNative: addNative,
      paidNative: 0,
      remainingNative: addNative,
      remainingUsd: currency === "ILS" && rateN > 0 ? roundMoney2(addNative / rateN) : addNative,
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
  customerPayments?: PaymentIntakeCustomerPaymentRow[];
  fromMethod: string;
  toMethod: string;
  amountUsd: number;
  currency?: PaymentBalanceCurrency | null;
  amountNative?: number | null;
  exchangeRate?: number | null;
}): { ok: true; preview: PaymentMethodAdjustmentPreview } | { ok: false; error: string } {
  const fromMethod = params.fromMethod.trim();
  const toMethod = params.toMethod.trim();
  const currency: PaymentBalanceCurrency = params.currency === "ILS" ? "ILS" : "USD";
  const rateN = params.exchangeRate && params.exchangeRate > 0 ? params.exchangeRate : null;

  let amountUsd = roundMoney2(params.amountUsd);
  let amountNative =
    params.amountNative != null && params.amountNative > 0
      ? roundMoney2(params.amountNative)
      : currency === "USD"
        ? amountUsd
        : rateN
          ? roundMoney2(amountUsd * rateN)
          : amountUsd;

  if (currency === "ILS" && rateN) {
    amountUsd = roundMoney2(amountNative / rateN);
  } else if (currency === "USD") {
    amountNative = amountUsd;
  }

  if (!fromMethod || !toMethod) return { ok: false, error: "יש לבחור אמצעי מקור ויעד" };
  if (paymentMethodBucketKey(fromMethod) === paymentMethodBucketKey(toMethod)) {
    return { ok: false, error: "יש לבחור שני אמצעי תשלום שונים" };
  }
  if (!(amountNative > EPS)) return { ok: false, error: "יש להזין סכום התאמה חיובי" };
  if (currency === "ILS" && !rateN) {
    return { ok: false, error: "נדרש שער דולר להתאמת סכום בשקלים" };
  }

  const fromBucket = paymentMethodBucketKey(fromMethod);
  const toBucket = paymentMethodBucketKey(toMethod);
  const sortedOrders = [...params.orders].sort(byOldestFirst);
  const customerOpenDebtUsd = roundMoney2(sortedOrders.reduce((sum, order) => sum + Math.max(0, Number(order.dbRemainingUsd) || 0), 0));

  const capturedBalances = aggregateCapturedPaymentsByMethodCurrency(params.customerPayments ?? []);
  const plannedOpenBalances = aggregateOrderPlannedOpenByMethodCurrency(sortedOrders);
  const capturedCards = buildMethodBalanceCards({ captured: capturedBalances, planned: plannedOpenBalances, rate: rateN });
  const plannedCards = buildMethodBalanceCards({ captured: plannedOpenBalances, planned: plannedOpenBalances, rate: rateN });

  const currentFromOpenUsd = computeMethodOpenUsd(sortedOrders, fromBucket);
  const currentToOpenUsd = computeMethodOpenUsd(sortedOrders, toBucket);
  const currentFromOpenNative = computeMethodOpenNative(sortedOrders, fromBucket, currency);
  const currentToOpenNative = computeMethodOpenNative(sortedOrders, toBucket, currency);

  if (amountNative > currentFromOpenNative + EPS) {
    return {
      ok: false,
      error: `אין מספיק יתרה פתוחה ב${methodLabel(fromMethod)} ${currency}. זמין: ${currentFromOpenNative.toFixed(2)}`,
    };
  }

  const candidates = sortedOrders
    .map((order) => ({
      order,
      availableNative: roundMoney2(
        order.breakdown.reduce(
          (sum, row) => sum + nativeRemainingForMethodCurrency(row, fromBucket, currency),
          0,
        ),
      ),
      availableUsd: roundMoney2(
        order.breakdown.reduce((sum, row) => sum + usdRemainingForMethod(row, fromBucket), 0),
      ),
    }))
    .filter((entry) => entry.availableNative > EPS);

  let leftNative = amountNative;
  let leftUsd = amountUsd;
  const affectedOrders: PaymentMethodAdjustmentOrderPreview[] = [];
  for (const entry of candidates) {
    if (leftNative <= EPS) break;
    const moveNative = roundMoney2(Math.min(leftNative, entry.availableNative));
    const moveUsd =
      currency === "USD"
        ? moveNative
        : rateN
          ? roundMoney2(moveNative / rateN)
          : roundMoney2(Math.min(leftUsd, entry.availableUsd));
    if (moveNative <= EPS) continue;
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
        sourceCurrency: currency,
        moveNative,
      }),
    });
    leftNative = roundMoney2(leftNative - moveNative);
    leftUsd = roundMoney2(leftUsd - moveUsd);
  }

  if (leftNative > EPS) {
    return { ok: false, error: "לא ניתן להגיע לסכום ההתאמה המבוקש מתוך היתרה הפתוחה" };
  }

  const suggestion = suggestPaymentMethodAdjustment({
    captured: capturedBalances,
    planned: plannedOpenBalances,
    fromMethod,
    toMethod,
    currency,
    exchangeRate: rateN,
  });

  const capturedTotalUsd = roundMoney2(
    capturedBalances.reduce((sum, row) => {
      if (row.currency === "USD") return sum + row.amount;
      if (row.currency === "ILS" && rateN) return sum + row.amount / rateN;
      return sum;
    }, 0),
  );

  return {
    ok: true,
    preview: {
      fromMethod,
      toMethod,
      fromLabel: methodLabel(fromMethod),
      toLabel: methodLabel(toMethod),
      currency,
      amountNative,
      exchangeRate: currency === "ILS" ? rateN : null,
      requestedAmountUsd: amountUsd,
      customerOpenDebtUsd,
      currentFromOpenUsd,
      currentToOpenUsd,
      currentFromOpenNative,
      currentToOpenNative,
      afterFromOpenUsd: roundMoney2(currentFromOpenUsd - amountUsd),
      afterToOpenUsd: roundMoney2(currentToOpenUsd + amountUsd),
      afterFromOpenNative: roundMoney2(currentFromOpenNative - amountNative),
      afterToOpenNative: roundMoney2(currentToOpenNative + amountNative),
      capturedBalances,
      plannedOpenBalances,
      capturedCards,
      plannedCards,
      capturedTotalUsd,
      affectedOrdersCount: affectedOrders.length,
      affectedOrders,
      suggestion,
      beforeMethodUsd: { from: currentFromOpenUsd, to: currentToOpenUsd },
      afterMethodUsd: { from: roundMoney2(currentFromOpenUsd - amountUsd), to: roundMoney2(currentToOpenUsd + amountUsd) },
    },
  };
}

/** טעינת מצב קופות בלבד — לפני חישוב התאמה */
export function buildPaymentMethodAdjustmentBootstrap(params: {
  orders: PaymentIntakeOrderRow[];
  customerPayments: PaymentIntakeCustomerPaymentRow[];
  exchangeRate?: number | null;
}): {
  capturedBalances: MethodCurrencyAmount[];
  plannedOpenBalances: MethodCurrencyAmount[];
  capturedCards: MethodBalanceCard[];
  plannedCards: MethodBalanceCard[];
  capturedTotalUsd: number;
  customerOpenDebtUsd: number;
} {
  const sortedOrders = [...params.orders].sort(byOldestFirst);
  const rateN = params.exchangeRate && params.exchangeRate > 0 ? params.exchangeRate : null;
  const capturedBalances = aggregateCapturedPaymentsByMethodCurrency(params.customerPayments);
  const plannedOpenBalances = aggregateOrderPlannedOpenByMethodCurrency(sortedOrders);
  const capturedCards = buildMethodBalanceCards({ captured: capturedBalances, planned: plannedOpenBalances, rate: rateN });
  const plannedCards = buildMethodBalanceCards({ captured: plannedOpenBalances, planned: plannedOpenBalances, rate: rateN });
  const customerOpenDebtUsd = roundMoney2(sortedOrders.reduce((sum, order) => sum + Math.max(0, Number(order.dbRemainingUsd) || 0), 0));
  const capturedTotalUsd = roundMoney2(
    capturedBalances.reduce((sum, row) => {
      if (row.currency === "USD") return sum + row.amount;
      if (row.currency === "ILS" && rateN) return sum + row.amount / rateN;
      return sum;
    }, 0),
  );
  return {
    capturedBalances,
    plannedOpenBalances,
    capturedCards,
    plannedCards,
    capturedTotalUsd,
    customerOpenDebtUsd,
  };
}
