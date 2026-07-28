/**
 * SSOT חישובי בקרת קופה – דמי משלוח.
 * התאמה: נקלט מהמשלוחים מול נספר בפועל, הוצאות לפי אמצעי תשלום.
 */
import { CASH_CONTROL_METHODS } from "@/app/admin/shipments/types";
import type {
  CashVarianceStatus,
  ShipmentCashControlKpis,
  ShipmentCashControlRow,
  ShipmentCashDaySummary,
  ShipmentCashMethodLine,
} from "@/app/admin/shipments/cash-control/types";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** יתרה לשורה — תמיד fee - paid (מקור אמת יחיד) */
export function computeRowRemaining(feeIls: number, paidIls: number): number {
  return Math.max(0, round2(feeIls) - round2(paidIls));
}

export function deriveFeePaymentStatus(
  feeIls: number,
  paidIls: number,
): "UNPAID" | "PARTIAL" | "PAID" {
  if (feeIls <= 0 || paidIls <= 0) return "UNPAID";
  if (paidIls >= feeIls - 0.001) return "PAID";
  return "PARTIAL";
}

/**
 * סיווג הפרש:
 * תקין ≈ 0 · הפרש קטן עד ₪50 · מעבר לכך הפרש גדול
 */
export function classifyCashVariance(
  differenceIls: number,
  countedIls: number | null,
): CashVarianceStatus {
  if (countedIls == null) return "pending";
  const abs = Math.abs(differenceIls);
  if (abs < 0.5) return "ok";
  if (abs <= 50) return "small";
  return "large";
}

export function buildMethodLine(input: {
  method: string;
  label: string;
  collectedIls: number;
  countedIls: number | null;
  expensesIls: number;
  isManual: boolean;
}): ShipmentCashMethodLine {
  const collected = round2(input.collectedIls);
  const counted = input.countedIls == null ? null : round2(input.countedIls);
  const expenses = round2(input.expensesIls);
  const balanceIls = round2(collected - expenses);
  const differenceIls = counted == null ? 0 : round2(counted - collected);
  return {
    method: input.method,
    label: input.label,
    collectedIls: collected,
    countedIls: counted,
    expensesIls: expenses,
    balanceIls,
    differenceIls,
    status: classifyCashVariance(differenceIls, counted),
    isManual: input.isManual,
  };
}

export function computeCashDaySummary(
  methods: ReadonlyArray<Pick<ShipmentCashMethodLine, "collectedIls" | "countedIls" | "expensesIls">>,
  _expensesIlsLegacy?: number,
): ShipmentCashDaySummary {
  const collectedIls = round2(methods.reduce((s, m) => s + m.collectedIls, 0));
  const countedIls = round2(
    methods.reduce((s, m) => s + (m.countedIls ?? 0), 0),
  );
  const expensesIls = round2(methods.reduce((s, m) => s + m.expensesIls, 0));
  return {
    collectedIls,
    countedIls,
    expensesIls,
    balanceAfterExpensesIls: round2(collectedIls - expensesIls),
    cashDifferenceIls: round2(countedIls - collectedIls),
  };
}

/** @deprecated — נשמר לתאימות עם מודלים ישנים */
export function computeShipmentCashKpis(
  rows: ReadonlyArray<
    Pick<
      ShipmentCashControlRow,
      "deliveryFeeIls" | "paidAmountIls" | "remainingFeeIls" | "boxes"
    >
  >,
  expensesIls: number,
): ShipmentCashControlKpis {
  const totalFeeIls = rows.reduce((s, r) => s + (r.deliveryFeeIls || 0), 0);
  const collectedIls = rows.reduce((s, r) => s + (r.paidAmountIls || 0), 0);
  const remainingIls = rows.reduce((s, r) => s + (r.remainingFeeIls || 0), 0);
  const shipmentCount = rows.length;
  const packagesCount = rows.reduce((s, r) => s + (r.boxes ?? 0), 0);
  const collectionRate =
    totalFeeIls > 0 ? Math.round((collectedIls / totalFeeIls) * 1000) / 10 : 0;

  return {
    totalFeeIls: round2(totalFeeIls),
    collectedIls: round2(collectedIls),
    remainingIls: round2(remainingIls),
    shipmentCount,
    packagesCount,
    collectionRate,
    expensesIls: round2(expensesIls),
  };
}

/** מחזיר האם אמצעי תשלום הוא ידני (לא אוטומטי) */
export function isManualMethod(method: string): boolean {
  const entry = CASH_CONTROL_METHODS.find((m) => m.value === method);
  return entry ? !entry.auto : false;
}
