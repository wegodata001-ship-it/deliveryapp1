import {
  PAYMENT_METHOD_KPI_META,
  type PaymentIntakeCustomerPaymentRow,
  type PaymentMethodKpiKey,
} from "@/lib/payment-intake-customer-kpi";
import { paymentMethodBucketKey, PAYMENT_BUCKET_LABELS, type PaymentBucketKey } from "@/lib/payment-breakdown-shared";
import { roundMoney2, type PaymentIntakeOrderRow } from "@/lib/payment-intake";

export type PaymentBalanceCurrency = "USD" | "ILS";

export type MethodCurrencyAmount = {
  methodKey: PaymentMethodKpiKey;
  methodLabel: string;
  currency: PaymentBalanceCurrency;
  amount: number;
};

export type MethodBalanceCard = {
  methodKey: PaymentMethodKpiKey;
  methodLabel: string;
  icon: string;
  /** סכומים לפי מטבע — ללא המרה */
  byCurrency: Partial<Record<PaymentBalanceCurrency, number>>;
  /** סה״כ USD equivalent — לתצוגת השוואה בלבד */
  totalUsdEquivalent: number;
};

const METHOD_ICONS: Record<PaymentMethodKpiKey, string> = {
  CASH: "💵",
  BANK_TRANSFER: "🏦",
  CHECK: "📝",
  CREDIT: "💳",
  OTHER: "📦",
};

function n(raw: string | null | undefined): number {
  if (raw == null) return 0;
  const v = Number(String(raw).replace(",", "."));
  return Number.isFinite(v) ? v : 0;
}

function kpiKeyFromMethod(method: string | null | undefined): PaymentMethodKpiKey {
  const bucket = paymentMethodBucketKey(method ?? "");
  if (bucket === "BANK_TRANSFER") return "BANK_TRANSFER";
  if (bucket === "CASH") return "CASH";
  if (bucket === "CHECK") return "CHECK";
  if (bucket === "CREDIT") return "CREDIT";
  return "OTHER";
}

function labelForKpi(key: PaymentMethodKpiKey): string {
  return PAYMENT_METHOD_KPI_META.find((row) => row.key === key)?.label ?? key;
}

function addToMap(
  map: Map<string, number>,
  methodKey: PaymentMethodKpiKey,
  currency: PaymentBalanceCurrency,
  amount: number,
): void {
  if (!(amount > 0.0001)) return;
  const key = `${methodKey}::${currency}`;
  map.set(key, roundMoney2((map.get(key) ?? 0) + amount));
}

/** סיכום תשלומים שנקלטו בפועל — לפי אמצעי + מטבע מקורי */
export function aggregateCapturedPaymentsByMethodCurrency(
  rows: PaymentIntakeCustomerPaymentRow[],
): MethodCurrencyAmount[] {
  const map = new Map<string, number>();

  for (const row of rows) {
    const usdAmt = n(row.amountUsd);
    const ilsAmt = n(row.amountIls);
    const primary = row.paymentMethod ?? row.usdPaymentMethod ?? row.ilsPaymentMethod ?? null;

    if (usdAmt > 0.0001) {
      addToMap(map, kpiKeyFromMethod(row.usdPaymentMethod ?? primary), "USD", usdAmt);
    }
    if (ilsAmt > 0.0001) {
      addToMap(map, kpiKeyFromMethod(row.ilsPaymentMethod ?? primary), "ILS", ilsAmt);
    }
  }

  return [...map.entries()]
    .map(([key, amount]) => {
      const [methodKey, currency] = key.split("::") as [PaymentMethodKpiKey, PaymentBalanceCurrency];
      return {
        methodKey,
        methodLabel: labelForKpi(methodKey),
        currency,
        amount,
      };
    })
    .sort((a, b) => a.methodLabel.localeCompare(b.methodLabel, "he") || a.currency.localeCompare(b.currency));
}

function nativeRemaining(order: PaymentIntakeOrderRow, row: PaymentIntakeOrderRow["breakdown"][number]): number {
  if (typeof row.remaining === "number" && Number.isFinite(row.remaining)) return roundMoney2(Math.max(0, row.remaining));
  return roundMoney2(Math.max(0, row.remainingUsd));
}

/** יתרה פתוחה מתוכננת בהזמנות — לפי אמצעי + מטבע */
export function aggregateOrderPlannedOpenByMethodCurrency(
  orders: PaymentIntakeOrderRow[],
): MethodCurrencyAmount[] {
  const map = new Map<string, number>();

  for (const order of orders) {
    for (const row of order.breakdown) {
      const remaining = nativeRemaining(order, row);
      if (!(remaining > 0.0001)) continue;
      const methodKey = kpiKeyFromMethod(row.method);
      const currency: PaymentBalanceCurrency = row.currency === "ILS" ? "ILS" : "USD";
      addToMap(map, methodKey, currency, remaining);
    }
  }

  return [...map.entries()]
    .map(([key, amount]) => {
      const [methodKey, currency] = key.split("::") as [PaymentMethodKpiKey, PaymentBalanceCurrency];
      return {
        methodKey,
        methodLabel: labelForKpi(methodKey),
        currency,
        amount,
      };
    })
    .sort((a, b) => a.methodLabel.localeCompare(b.methodLabel, "he") || a.currency.localeCompare(b.currency));
}

function amountAt(
  rows: MethodCurrencyAmount[],
  methodKey: PaymentMethodKpiKey,
  currency: PaymentBalanceCurrency,
): number {
  return roundMoney2(
    rows.find((row) => row.methodKey === methodKey && row.currency === currency)?.amount ?? 0,
  );
}

export function buildMethodBalanceCards(params: {
  captured: MethodCurrencyAmount[];
  planned: MethodCurrencyAmount[];
  rate?: number | null;
}): MethodBalanceCard[] {
  const rate = params.rate && params.rate > 0 ? params.rate : null;
  const keys = new Set<PaymentMethodKpiKey>([
    ...params.captured.map((row) => row.methodKey),
    ...params.planned.map((row) => row.methodKey),
  ]);

  return PAYMENT_METHOD_KPI_META.filter((meta) => keys.has(meta.key)).map((meta) => {
    const byCurrency: Partial<Record<PaymentBalanceCurrency, number>> = {};
    for (const currency of ["USD", "ILS"] as const) {
      const captured = amountAt(params.captured, meta.key, currency);
      if (captured > 0) byCurrency[currency] = captured;
    }
    let totalUsdEquivalent = amountAt(params.captured, meta.key, "USD");
    const ils = byCurrency.ILS ?? 0;
    if (ils > 0 && rate) totalUsdEquivalent = roundMoney2(totalUsdEquivalent + ils / rate);

    return {
      methodKey: meta.key,
      methodLabel: meta.label,
      icon: METHOD_ICONS[meta.key],
      byCurrency,
      totalUsdEquivalent,
    };
  });
}

export type PaymentMethodAdjustmentSuggestion = {
  fromMethod: string;
  toMethod: string;
  fromLabel: string;
  toLabel: string;
  currency: PaymentBalanceCurrency;
  amount: number;
  amountUsd: number;
  exchangeRate: number | null;
  reason: string;
};

const EPS = 0.02;

function bucketToMethodSlug(bucket: PaymentBucketKey): string {
  return bucket;
}

/** הצעת התאמה — השוואת תשלומים שנקלטו מול יתרה מתוכננת בהזמנות */
export function suggestPaymentMethodAdjustment(params: {
  captured: MethodCurrencyAmount[];
  planned: MethodCurrencyAmount[];
  fromMethod: string;
  toMethod: string;
  currency: PaymentBalanceCurrency;
  exchangeRate?: number | null;
}): PaymentMethodAdjustmentSuggestion | null {
  const fromBucket = paymentMethodBucketKey(params.fromMethod);
  const toBucket = paymentMethodBucketKey(params.toMethod);
  if (fromBucket === toBucket) return null;

  const fromKey = kpiKeyFromMethod(params.fromMethod);
  const toKey = kpiKeyFromMethod(params.toMethod);
  const currency = params.currency;

  const capturedFrom = amountAt(params.captured, fromKey, currency);
  const capturedTo = amountAt(params.captured, toKey, currency);
  const orderFrom = amountAt(params.planned, fromKey, currency);
  const orderTo = amountAt(params.planned, toKey, currency);

  const excessCaptured = roundMoney2(Math.max(0, capturedFrom - orderFrom));
  const deficitCaptured = roundMoney2(Math.max(0, orderTo - capturedTo));
  const amount = roundMoney2(Math.min(excessCaptured, deficitCaptured, orderFrom));

  if (!(amount > EPS)) return null;

  const rate = params.exchangeRate && params.exchangeRate > 0 ? params.exchangeRate : null;
  const amountUsd =
    currency === "USD"
      ? amount
      : rate
        ? roundMoney2(amount / rate)
        : amount;

  return {
    fromMethod: bucketToMethodSlug(fromBucket),
    toMethod: bucketToMethodSlug(toBucket),
    fromLabel: PAYMENT_BUCKET_LABELS[fromBucket],
    toLabel: PAYMENT_BUCKET_LABELS[toBucket],
    currency,
    amount,
    amountUsd,
    exchangeRate: currency === "ILS" ? rate : null,
    reason: `עודף ${PAYMENT_BUCKET_LABELS[fromBucket]} ${currency} בפועל: ${excessCaptured.toFixed(2)}, חוסר ${PAYMENT_BUCKET_LABELS[toBucket]} ${currency}: ${deficitCaptured.toFixed(2)}`,
  };
}

export function sumCapturedTotalUsd(
  captured: MethodCurrencyAmount[],
  exchangeRate?: number | null,
): number {
  const rate = exchangeRate && exchangeRate > 0 ? exchangeRate : null;
  let total = 0;
  for (const row of captured) {
    if (row.currency === "USD") total += row.amount;
    else if (row.currency === "ILS" && rate) total += row.amount / rate;
  }
  return roundMoney2(total);
}
