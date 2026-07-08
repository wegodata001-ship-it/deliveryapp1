/**
 * בקרת קופה שבועית — זרימת כספים מקליטות → ספירה → מט"ח → טורקיה → בנק → יתרה בקופה.
 */

import { CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";
import type { CashReconciliationLineId } from "@/lib/cash-control-reconciliation";

export type CashWeekFlowLineId = CashReconciliationLineId;

export type CashWeekFlowLineMeta = {
  id: CashWeekFlowLineId;
  label: string;
  currency: "ILS" | "USD";
};

/** שורות «כספים שהתקבלו» / «ספירת קופה» — לפי האפיון */
export const CASH_WEEK_FLOW_LINES: CashWeekFlowLineMeta[] = [
  { id: "CASH_ILS", label: "₪ מזומן", currency: "ILS" },
  { id: "CASH_USD", label: "$ מזומן", currency: "USD" },
  { id: "CREDIT", label: "אשראי", currency: "ILS" },
  { id: "CHECK", label: "צ'קים", currency: "ILS" },
  { id: "BANK_TRANSFER", label: "העברות", currency: "ILS" },
];

export type CashWeekFlowCountedValues = Partial<Record<CashWeekFlowLineId, number | null>>;

export type CashWeekFlowManualValues = {
  counted: CashWeekFlowCountedValues;
  fxPurchaseIls: number | null;
  fxPurchaseUsd: number | null;
  turkeyTransferUsd: number | null;
  bankBalanceIls: number | null;
  bankBalanceUsd: number | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function fmtWeekFlowAmount(currency: "ILS" | "USD", amount: number): string {
  if (Math.abs(amount) <= CASH_CONTROL_EPS) return currency === "ILS" ? "₪0" : "$0";
  const abs = Math.abs(amount);
  const body =
    currency === "ILS"
      ? abs.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
      : abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const prefix = currency === "ILS" ? "₪" : "$";
  return amount < 0 ? `-${prefix}${body}` : `${prefix}${body}`;
}

export function computeDrawerRemaining(input: {
  countedCashIls: number;
  countedCashUsd: number;
  expensesIls: number;
  expensesUsd: number;
  fxPurchaseIls: number;
  fxPurchaseUsd: number;
  turkeyTransferUsd: number;
}): { ils: number; usd: number } {
  return {
    ils: round2(input.countedCashIls - input.expensesIls - input.fxPurchaseIls),
    usd: round2(input.countedCashUsd + input.fxPurchaseUsd - input.turkeyTransferUsd - input.expensesUsd),
  };
}

export function countLineDiff(received: number, counted: number | null): number | null {
  if (counted == null || !Number.isFinite(counted)) return null;
  return round2(counted - received);
}
