import {
  paymentMethodBucketKey,
  PAYMENT_BUCKET_LABELS,
  type OrderBreakdownLineInput,
} from "@/lib/payment-breakdown-shared";
import { roundMoney2, type OrderBreakdownMethodRow, type PaymentIntakeOrderRow } from "@/lib/payment-intake";
import { buildAdjustedBreakdownForOrder } from "@/lib/payment-method-auto-adjustment";
import type { PaymentBalanceCurrency } from "@/lib/payment-method-captured-balances";
import type { PaymentMethodKpiKey } from "@/lib/payment-intake-customer-kpi";
import { PAYMENT_METHOD_KPI_META } from "@/lib/payment-intake-customer-kpi";

const EPS = 0.02;

export type PaymentIntentLine = {
  method: string;
  currency: PaymentBalanceCurrency;
  amountNative: number;
};

export type PaymentIntentMove = {
  fromMethod: string;
  toMethod: string;
  fromLabel: string;
  toLabel: string;
  currency: PaymentBalanceCurrency;
  amountNative: number;
  amountUsd: number;
  exchangeRate: number | null;
};

export type PaymentIntentOrderChange = {
  orderId: string;
  orderNumber: string;
  dateYmd: string;
  fromMethod: string;
  fromLabel: string;
  toMethod: string;
  toLabel: string;
  moveUsd: number;
  availableUsd: number;
  partial: boolean;
  beforeBreakdown: OrderBreakdownLineInput[];
  afterBreakdown: OrderBreakdownLineInput[];
};

export type PaymentIntentPlan =
  | {
      ok: true;
      intents: Array<PaymentIntentLine & { amountUsd: number }>;
      totalPayUsd: number;
      openDebtUsd: number;
      moves: PaymentIntentMove[];
      orderChanges: PaymentIntentOrderChange[];
    }
  | { ok: false; error: string };

function methodLabel(method: string): string {
  return PAYMENT_BUCKET_LABELS[paymentMethodBucketKey(method)];
}

function kpiOrderIndex(method: string): number {
  const key = paymentMethodBucketKey(method) as PaymentMethodKpiKey;
  const idx = PAYMENT_METHOD_KPI_META.findIndex((row) => row.key === key);
  return idx >= 0 ? idx : 999;
}

function byOldestFirst(a: PaymentIntakeOrderRow, b: PaymentIntakeOrderRow): number {
  const byDate = (a.dateYmd || "").localeCompare(b.dateYmd || "");
  if (byDate !== 0) return byDate;
  return (a.orderNumber || "").localeCompare(b.orderNumber || "", undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function intentToUsd(
  amountNative: number,
  currency: PaymentBalanceCurrency,
  rate: number | null,
): { ok: true; amountUsd: number } | { ok: false; error: string } {
  if (!(amountNative > EPS)) return { ok: true, amountUsd: 0 };
  if (currency === "USD") return { ok: true, amountUsd: roundMoney2(amountNative) };
  if (!rate || !(rate > 0)) {
    return { ok: false, error: "נדרש שער דולר להזנת סכום בשקלים" };
  }
  return { ok: true, amountUsd: roundMoney2(amountNative / rate) };
}

function toEditableBreakdownLines(rows: OrderBreakdownMethodRow[]): OrderBreakdownLineInput[] {
  return rows.map((row) => ({
    paymentMethod: row.method,
    amount: (typeof row.planned === "number" ? row.planned : row.plannedUsd).toFixed(2),
    currency: row.currency === "ILS" ? "ILS" : "USD",
  }));
}

function breakdownLinesToOrderRows(lines: OrderBreakdownLineInput[]): OrderBreakdownMethodRow[] {
  return lines.map((line) => {
    const amount = roundMoney2(Number(line.amount) || 0);
    return {
      method: line.paymentMethod,
      label: methodLabel(line.paymentMethod),
      currency: line.currency === "ILS" ? "ILS" : "USD",
      planned: amount,
      plannedUsd: amount,
      paid: 0,
      paidUsd: 0,
      remaining: amount,
      remainingUsd: amount,
    };
  });
}

function orderRemainingUsd(order: PaymentIntakeOrderRow): number {
  return roundMoney2(order.breakdown.reduce((sum, row) => sum + Math.max(0, row.remainingUsd), 0));
}

/**
 * מתשלום שהלקוח רוצה לבצע עכשיו → העברות אמצעי מתוכנן בהזמנות (FIFO).
 * לא סוגר חוב ולא יוצר תשלום — רק מתכנן שינוי שיוך אמצעי.
 */
export function planPaymentIntentAdjustments(params: {
  orders: PaymentIntakeOrderRow[];
  intents: PaymentIntentLine[];
  exchangeRate?: number | null;
}): PaymentIntentPlan {
  const rate = params.exchangeRate && params.exchangeRate > 0 ? params.exchangeRate : null;
  const sortedOrders = [...params.orders]
    .map((order) => ({
      ...order,
      breakdown: order.breakdown.map((row) => ({ ...row })),
    }))
    .sort(byOldestFirst);

  const openDebtUsd = roundMoney2(sortedOrders.reduce((sum, order) => sum + orderRemainingUsd(order), 0));

  const normalized: Array<PaymentIntentLine & { amountUsd: number }> = [];
  for (const intent of params.intents) {
    const amountNative = roundMoney2(Math.max(0, Number(intent.amountNative) || 0));
    if (!(amountNative > EPS)) continue;
    const method = intent.method.trim();
    if (!method) return { ok: false, error: "יש לבחור אמצעי תשלום לכל סכום" };
    const usd = intentToUsd(amountNative, intent.currency, rate);
    if (!usd.ok) return usd;
    if (!(usd.amountUsd > EPS)) continue;
    normalized.push({
      method,
      currency: intent.currency,
      amountNative,
      amountUsd: usd.amountUsd,
    });
  }

  if (normalized.length === 0) {
    return { ok: false, error: "יש להזין לפחות סכום תשלום אחד שהלקוח רוצה לשלם עכשיו" };
  }

  const totalPayUsd = roundMoney2(normalized.reduce((sum, row) => sum + row.amountUsd, 0));
  if (totalPayUsd > openDebtUsd + EPS) {
    return {
      ok: false,
      error: `סכום התשלום ($${totalPayUsd.toFixed(2)}) גבוה מהחוב הפתוח ($${openDebtUsd.toFixed(2)}). ההתאמה מתאימה רק אמצעי מתוכנן — לא יוצרת תשלום/חוב חדש.`,
    };
  }

  const needByTo = new Map<string, number>();
  for (const row of normalized) {
    const key = paymentMethodBucketKey(row.method);
    needByTo.set(key, roundMoney2((needByTo.get(key) ?? 0) + row.amountUsd));
  }

  const plannedByMethod = new Map<string, number>();
  for (const order of sortedOrders) {
    for (const row of order.breakdown) {
      const rem = roundMoney2(Math.max(0, row.remainingUsd));
      if (!(rem > EPS)) continue;
      const key = paymentMethodBucketKey(row.method);
      plannedByMethod.set(key, roundMoney2((plannedByMethod.get(key) ?? 0) + rem));
    }
  }

  const convertNeedByTo = new Map<string, number>();
  for (const [toKey, need] of needByTo) {
    const already = plannedByMethod.get(toKey) ?? 0;
    const convert = roundMoney2(Math.max(0, need - already));
    if (convert > EPS) convertNeedByTo.set(toKey, convert);
  }

  if (convertNeedByTo.size === 0) {
    return {
      ok: false,
      error:
        "אמצעי התשלום המתוכננים בהזמנות כבר תואמים לתשלום שהוזן — אין צורך בהתאמה. אפשר להמשיך לקליטת התשלום.",
    };
  }

  const moveAgg = new Map<string, PaymentIntentMove>();
  const orderChangeMap = new Map<string, PaymentIntentOrderChange>();

  const toKeys = [...convertNeedByTo.keys()].sort((a, b) => kpiOrderIndex(a) - kpiOrderIndex(b));

  for (const toKey of toKeys) {
    let left = convertNeedByTo.get(toKey) ?? 0;

    for (const order of sortedOrders) {
      if (left <= EPS) break;
      const beforeBreakdown = toEditableBreakdownLines(order.breakdown);
      const availableBefore = orderRemainingUsd(order);

      // כמה אפשר לקחת מהזמנה זו מאמצעים שאינם היעד
      let orderTake = 0;
      let primaryFrom: string | null = null;

      for (const row of order.breakdown) {
        if (left <= EPS) break;
        const fromKey = paymentMethodBucketKey(row.method);
        if (fromKey === toKey) continue;
        const rem = roundMoney2(Math.max(0, row.remainingUsd));
        if (!(rem > EPS)) continue;

        // אל תיקח מיתרה שצריכה להישאר עבור תשלום לאותו אמצעי מקור
        const reservedForFrom = needByTo.get(fromKey) ?? 0;
        const plannedFrom = plannedByMethod.get(fromKey) ?? 0;
        const alreadyTakenFrom = [...moveAgg.values()]
          .filter((m) => paymentMethodBucketKey(m.fromMethod) === fromKey)
          .reduce((s, m) => s + m.amountUsd, 0);
        const surplusLeft = roundMoney2(plannedFrom - reservedForFrom - alreadyTakenFrom);
        if (!(surplusLeft > EPS)) continue;

        const take = roundMoney2(Math.min(left, rem, surplusLeft));
        if (!(take > EPS)) continue;

        primaryFrom = primaryFrom ?? fromKey;
        try {
          const after = buildAdjustedBreakdownForOrder({
            order,
            fromMethod: fromKey,
            toMethod: toKey,
            moveUsd: take,
            sourceCurrency: "USD",
            moveNative: take,
          });
          order.breakdown = breakdownLinesToOrderRows(after);
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : "חישוב התאמה נכשל" };
        }

        const aggKey = `${fromKey}=>${toKey}::USD`;
        const prev = moveAgg.get(aggKey);
        if (prev) {
          prev.amountUsd = roundMoney2(prev.amountUsd + take);
          prev.amountNative = prev.amountUsd;
        } else {
          moveAgg.set(aggKey, {
            fromMethod: fromKey,
            toMethod: toKey,
            fromLabel: methodLabel(fromKey),
            toLabel: methodLabel(toKey),
            currency: "USD",
            amountNative: take,
            amountUsd: take,
            exchangeRate: null,
          });
        }

        orderTake = roundMoney2(orderTake + take);
        left = roundMoney2(left - take);
      }

      if (orderTake > EPS && primaryFrom) {
        const existing = orderChangeMap.get(order.id);
        const afterBreakdown = toEditableBreakdownLines(order.breakdown);
        if (existing) {
          existing.moveUsd = roundMoney2(existing.moveUsd + orderTake);
          existing.afterBreakdown = afterBreakdown;
          existing.partial = availableBefore - existing.moveUsd > EPS;
          existing.toMethod = toKey;
          existing.toLabel = methodLabel(toKey);
        } else {
          orderChangeMap.set(order.id, {
            orderId: order.id,
            orderNumber: order.orderNumber?.trim() || "—",
            dateYmd: order.dateYmd,
            fromMethod: primaryFrom,
            fromLabel: methodLabel(primaryFrom),
            toMethod: toKey,
            toLabel: methodLabel(toKey),
            moveUsd: orderTake,
            availableUsd: availableBefore,
            partial: availableBefore - orderTake > EPS,
            beforeBreakdown,
            afterBreakdown,
          });
        }
      }
    }

    if (left > EPS) {
      return {
        ok: false,
        error: `אין מספיק יתרה מתוכננת באמצעים אחרים כדי להתאים ${methodLabel(toKey)} בסכום $${left.toFixed(2)}`,
      };
    }
  }

  const moves = [...moveAgg.values()];
  if (moves.length === 0) {
    return { ok: false, error: "לא זוהתה התאמה נדרשת" };
  }

  const orderChanges = [...orderChangeMap.values()].sort(
    (a, b) => a.dateYmd.localeCompare(b.dateYmd) || a.orderNumber.localeCompare(b.orderNumber),
  );

  return {
    ok: true,
    intents: normalized,
    totalPayUsd,
    openDebtUsd,
    moves,
    orderChanges,
  };
}

/** מאגד שורות טיוטת תשלום מטופס הקליטה ל-intents */
export function intentsFromDraftPaymentLines(
  lines: Array<{
    usdAmount?: number | "" | null;
    ilsAmount?: number | "" | null;
    usdPaymentMethod?: string | null;
    ilsPaymentMethod?: string | null;
    paymentMethod?: string | null;
  }>,
): PaymentIntentLine[] {
  const map = new Map<string, PaymentIntentLine>();
  const add = (method: string | null | undefined, currency: PaymentBalanceCurrency, amount: number) => {
    const m = (method ?? "").trim();
    if (!m || !(amount > EPS)) return;
    const key = `${paymentMethodBucketKey(m)}::${currency}`;
    const prev = map.get(key);
    if (prev) {
      prev.amountNative = roundMoney2(prev.amountNative + amount);
      return;
    }
    map.set(key, { method: paymentMethodBucketKey(m), currency, amountNative: roundMoney2(amount) });
  };

  for (const line of lines) {
    const usd = typeof line.usdAmount === "number" ? line.usdAmount : Number(line.usdAmount);
    const ils = typeof line.ilsAmount === "number" ? line.ilsAmount : Number(line.ilsAmount);
    add(line.usdPaymentMethod ?? line.paymentMethod, "USD", Number.isFinite(usd) ? usd : 0);
    add(line.ilsPaymentMethod ?? line.paymentMethod, "ILS", Number.isFinite(ils) ? ils : 0);
  }
  return [...map.values()];
}
