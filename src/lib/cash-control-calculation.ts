/**
 * מקור אמת יחיד לחישובי בקרת קופה / בקרת תשלומים.
 * כל המסכים, הדוחות והייצוא חייבים להשתמש רק בפונקציות מכאן.
 *
 * יתרה פתוחה = סכום הזמנה (totalUsd או amount+commission) − תשלומים פעילים − זיכויים.
 * אין להשתמש בסכום הזמנה המקורי כ"אמור להתקבל" כשקיימת יתרה פתוחה קטנה יותר.
 */

import { Prisma } from "@prisma/client";
import { orderUsdTotal } from "@/lib/customer-balance";

export const CASH_CONTROL_EPS = 0.02;

export function roundCashUsd(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n * 100) / 100;
  return r;
}

export function fixCashUsd(n: number): string {
  return roundCashUsd(Math.max(0, n)).toFixed(2);
}

export function fixCashUsdSigned(n: number): string {
  return roundCashUsd(n).toFixed(2);
}

export type CashControlOrderBalanceInput = {
  totalUsd: Prisma.Decimal | null;
  amountUsd: Prisma.Decimal | null;
  commissionUsd: Prisma.Decimal | null;
};

export type CashControlOrderBalance = {
  /** סכום הזמנה מלא (לעיון / ביקורת בלבד) */
  orderTotalUsd: number;
  /** סכום ששולם בפועל על ההזמנה */
  paidUsd: number;
  /** זיכויים שהופחתו מהחוב (אם סופקו) */
  creditUsd: number;
  /** יתרה פתוחה אמיתית — מה שעדיין חייב להיכנס */
  openBalanceUsd: number;
  /** עודף גבייה — שולם מעל סכום ההזמנה */
  surplusUsd: number;
};

/**
 * חישוב יתרה פתוחה להזמנה בודדת.
 * creditUsd — זיכוי נוסף שמופחת מהחוב (ברירת מחדל 0; איפוס יתרה משתקף ב-totalUsd המעודכן).
 */
export function computeCashControlOrderBalance(
  order: CashControlOrderBalanceInput,
  paidUsd: number,
  creditUsd = 0,
): CashControlOrderBalance {
  const orderTotalUsd = Number(orderUsdTotal(order).toString()) || 0;
  const paid = roundCashUsd(paidUsd);
  const credit = roundCashUsd(creditUsd);
  const net = roundCashUsd(orderTotalUsd - paid - credit);
  return {
    orderTotalUsd: roundCashUsd(orderTotalUsd),
    paidUsd: paid,
    creditUsd: credit,
    openBalanceUsd: Math.max(0, net),
    surplusUsd: Math.max(0, -net),
  };
}

export type CashControlAmountDeviationKind = "shortfall" | "surplus";

export type CashControlAmountDeviation = {
  kind: CashControlAmountDeviationKind;
  openBalanceUsd: number;
  paidUsd: number;
  weekReceivedUsd: number;
  deviationUsd: number;
  severity: "small" | "severe";
};

export function amountDeviationSeverity(amountUsd: number): "ok" | "small" | "severe" {
  const a = Math.abs(amountUsd);
  if (a <= CASH_CONTROL_EPS) return "ok";
  if (a <= 10) return "small";
  return "severe";
}

/**
 * חריגת סכום — מבוססת יתרה פתוחה / עודף בלבד, לא על סכום ההזמנה המקורי.
 */
export function computeCashControlAmountDeviation(params: {
  balance: CashControlOrderBalance;
  weekReceivedUsd: number;
  hasMethodDeviation: boolean;
}): CashControlAmountDeviation | null {
  if (params.hasMethodDeviation) return null;
  const { balance, weekReceivedUsd } = params;

  if (balance.surplusUsd > CASH_CONTROL_EPS) {
    const sev = amountDeviationSeverity(balance.surplusUsd);
    if (sev === "ok") return null;
    return {
      kind: "surplus",
      openBalanceUsd: balance.openBalanceUsd,
      paidUsd: balance.paidUsd,
      weekReceivedUsd,
      deviationUsd: balance.surplusUsd,
      severity: sev,
    };
  }

  if (balance.openBalanceUsd > CASH_CONTROL_EPS) {
    const sev = amountDeviationSeverity(balance.openBalanceUsd);
    if (sev === "ok") return null;
    return {
      kind: "shortfall",
      openBalanceUsd: balance.openBalanceUsd,
      paidUsd: balance.paidUsd,
      weekReceivedUsd,
      deviationUsd: balance.openBalanceUsd,
      severity: sev,
    };
  }

  return null;
}

export type CashControlOrderComputed = {
  orderTotalUsd: string;
  openBalanceUsd: string;
  paidUsd: string;
  weekReceivedUsd: string;
  surplusUsd: string;
  /** תאימות לאחור — שווה ל-openBalanceUsd */
  requiredUsd: string;
  /** תאימות לאחור — שווה ל-paidUsd */
  receivedUsd: string;
  /** תאימות לאחור — שווה ל-openBalanceUsd (חסר לגבייה) */
  missingUsd: string;
};

export function toCashControlOrderComputed(
  balance: CashControlOrderBalance,
  weekReceivedUsd: number,
): CashControlOrderComputed {
  const open = fixCashUsd(balance.openBalanceUsd);
  const paid = fixCashUsd(balance.paidUsd);
  const week = fixCashUsd(weekReceivedUsd);
  const total = fixCashUsd(balance.orderTotalUsd);
  const surplus = fixCashUsd(balance.surplusUsd);
  return {
    orderTotalUsd: total,
    openBalanceUsd: open,
    paidUsd: paid,
    weekReceivedUsd: week,
    surplusUsd: surplus,
    requiredUsd: open,
    receivedUsd: paid,
    missingUsd: open,
  };
}

/** קלט לחישוב הפרש בקרת קופה — ערוץ יחיד (אמצעי תשלום + מטבע) */
export type CashControlInput = {
  receivedAmount: number;
  existingExpensesAmount: number;
  newExpenseAmount?: number;
  countedAmount: number | null;
};

export type CashControlVarianceStatus = "MATCHED" | "SHORTAGE" | "SURPLUS" | "WAITING_FOR_COUNT";

export type CashControlResult = {
  expectedNetAmount: number;
  varianceAmount: number | null;
  status: CashControlVarianceStatus;
  totalExpensesAmount: number;
};

/**
 * מקור אמת יחיד — הפרש בקרת קופה לערוץ בודד.
 * צפוי נטו = התקבל − הוצאות (קיימות + חדשה)
 * הפרש = נספר − צפוי נטו
 */
export function calculateCashControlVariance(input: CashControlInput): CashControlResult {
  const received = roundCashUsd(input.receivedAmount);
  const existing = roundCashUsd(input.existingExpensesAmount);
  const newExpense = roundCashUsd(input.newExpenseAmount ?? 0);
  const totalExpenses = roundCashUsd(existing + newExpense);
  const expectedNet = roundCashUsd(received - totalExpenses);

  if (input.countedAmount == null || !Number.isFinite(input.countedAmount)) {
    return {
      expectedNetAmount: expectedNet,
      varianceAmount: null,
      status: "WAITING_FOR_COUNT",
      totalExpensesAmount: totalExpenses,
    };
  }

  const counted = roundCashUsd(input.countedAmount);
  const variance = roundCashUsd(counted - expectedNet);

  let status: CashControlVarianceStatus;
  if (Math.abs(variance) <= CASH_CONTROL_EPS) {
    status = "MATCHED";
  } else if (variance < 0) {
    status = "SHORTAGE";
  } else {
    status = "SURPLUS";
  }

  return {
    expectedNetAmount: expectedNet,
    varianceAmount: variance,
    status,
    totalExpensesAmount: totalExpenses,
  };
}
