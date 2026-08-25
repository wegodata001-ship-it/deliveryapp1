/**
 * SSOT — סיכום כספי למשלוח/קונטיינר בבקרת משלוחים.
 * מקור יחיד לטבלת הסיכום (ולא חישובים כפולים ב-UI).
 */
import { normalizePaymentMethodId } from "@/lib/payment-method-slugs";

export type ShipmentControlPaymentLine = {
  method: string;
  amountIls: number;
};

export type ShipmentControlAggRecord = {
  batchId: string;
  deliveryFeeIls?: number | null;
  deliveryFeeAmount?: number | null;
  expensesTotalIls?: number | null;
  payments: ShipmentControlPaymentLine[];
};

export type ShipmentDeliveryFeeRecord = {
  deliveryFeeIls?: number | null;
  deliveryFeeAmount?: number | null;
};

export type ShipmentControlAggExpense = {
  batchId: string;
  amount: number;
  currency: "ILS" | "USD" | string;
};

export type ShipmentFinancialAggregation = {
  shipmentTotalDeliveryFees: number;
  shipmentCashReceived: number;
  shipmentTransferReceived: number;
  shipmentCheckReceived: number;
  /** מזומן + העברה + צ'ק */
  shipmentReceived: number;
  shipmentExpenses: number;
  /** דמי משלוח − התקבל */
  shipmentOutstandingDeliveryFees: number;
  /** התקבל − הוצאות */
  shipmentBalance: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * דמי משלוח נחשבים תקינים אם קיים סכום חיובי בשדה הש״ח או בשדה המקורי.
 * אין כיום במודל ShipmentRecord סימון עסקי ל״חינם״, ולכן אפס נחשב חסר.
 */
export function hasValidShipmentDeliveryFee(record: ShipmentDeliveryFeeRecord): boolean {
  const ils = Number(record.deliveryFeeIls);
  const original = Number(record.deliveryFeeAmount);
  return (
    (Number.isFinite(ils) && ils > 0) ||
    (Number.isFinite(original) && original > 0)
  );
}

export function countMissingShipmentDeliveryFees(
  records: ShipmentDeliveryFeeRecord[],
): number {
  return records.reduce(
    (count, record) => count + (hasValidShipmentDeliveryFee(record) ? 0 : 1),
    0,
  );
}

function sumByMethod(
  payments: ShipmentControlPaymentLine[],
  methodId: "CASH" | "BANK_TRANSFER" | "CHECK",
): number {
  let sum = 0;
  for (const p of payments) {
    if (normalizePaymentMethodId(p.method) !== methodId) continue;
    const amount = Number(p.amountIls);
    if (Number.isFinite(amount)) sum += amount;
  }
  return round2(sum);
}

/** סיכום כספי לרשומות לקוח של משלוח אחד + הוצאות האצווה */
export function aggregateShipmentFinancials(
  records: ShipmentControlAggRecord[],
  expenses: ShipmentControlAggExpense[] = [],
): ShipmentFinancialAggregation {
  let fees = 0;
  const payments: ShipmentControlPaymentLine[] = [];
  for (const r of records) {
    fees += r.deliveryFeeIls ?? 0;
    for (const p of r.payments) payments.push(p);
  }

  const cash = sumByMethod(payments, "CASH");
  const transfer = sumByMethod(payments, "BANK_TRANSFER");
  const check = sumByMethod(payments, "CHECK");
  const received = round2(cash + transfer + check);

  let expensesIls = records.reduce((sum, record) => {
    const amount = Number(record.expensesTotalIls);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  for (const e of expenses) {
    if (e.currency === "USD") continue; // יתרה מחושבת בש״ח; USD מוצג בנפרד במודל
    const amount = Number(e.amount);
    if (Number.isFinite(amount)) expensesIls += amount;
  }
  expensesIls = round2(expensesIls);

  return {
    shipmentTotalDeliveryFees: round2(fees),
    shipmentCashReceived: cash,
    shipmentTransferReceived: transfer,
    shipmentCheckReceived: check,
    shipmentReceived: received,
    shipmentExpenses: expensesIls,
    shipmentOutstandingDeliveryFees: round2(fees - received),
    shipmentBalance: round2(received - expensesIls),
  };
}

export function aggregateShipmentsByBatch(
  records: ShipmentControlAggRecord[],
  expenses: ShipmentControlAggExpense[],
): Map<string, ShipmentFinancialAggregation> {
  const recordsByBatch = new Map<string, ShipmentControlAggRecord[]>();
  for (const r of records) {
    const list = recordsByBatch.get(r.batchId) ?? [];
    list.push(r);
    recordsByBatch.set(r.batchId, list);
  }
  const expensesByBatch = new Map<string, ShipmentControlAggExpense[]>();
  for (const e of expenses) {
    const list = expensesByBatch.get(e.batchId) ?? [];
    list.push(e);
    expensesByBatch.set(e.batchId, list);
  }

  const out = new Map<string, ShipmentFinancialAggregation>();
  for (const [batchId, recs] of recordsByBatch) {
    out.set(batchId, aggregateShipmentFinancials(recs, expensesByBatch.get(batchId) ?? []));
  }
  return out;
}

/** סה״כ יתרה = SUM(balance) על כל המשלוחים המסוננים — אותו SSOT כמו עמודת «יתרה» */
export function sumShipmentBalances(
  records: ShipmentControlAggRecord[],
  expenses: ShipmentControlAggExpense[],
): number {
  const byBatch = aggregateShipmentsByBatch(records, expenses);
  let sum = 0;
  for (const agg of byBatch.values()) sum += agg.shipmentBalance;
  return round2(sum);
}
