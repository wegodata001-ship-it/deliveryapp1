/**
 * חישוב חריגות בקרת קופה — מקור אמת יחיד.
 *
 * נוסחה:
 *   צפוי נטו = התקבל/שולם − הוצאות קופה (רלוונטיות למזומן ₪/$)
 *   חריגה (variance) = צפוי נטו − נספר בפועל
 *
 * חריגה חיובית = חסר בקופה (נספר פחות מהצפוי).
 */

import { CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";
import {
  buildDailyReconciliation,
  type CashDailyDrawerValues,
  type CashDailyExpenseTotals,
  type CashDailyIntakeTotals,
  type CashDailyMethodId,
  type CashDailyReconLine,
  type CashDailyStatusKind,
  emptyDailyExpenses,
} from "@/lib/cash-control-daily";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type CashVarianceLineDto = {
  method: CashDailyMethodId;
  label: string;
  currency: "ILS" | "USD";
  /** התקבל / שולם (ברוטו) */
  expectedAmount: number;
  /** הוצאות קופה שנרשמו לאותו יום ומטבע */
  expensesAmount: number;
  /** צפוי נטו = expected − expenses */
  expectedNet: number;
  countedAmount: number | null;
  /** חריגה = expectedNet − counted */
  variance: number | null;
  status: CashDailyStatusKind;
};

export type CashVarianceDaySummary = {
  lines: CashVarianceLineDto[];
  status: CashDailyStatusKind;
  worstVariance: number | null;
  worstCurrency: "ILS" | "USD";
  worstMethod: CashDailyMethodId | null;
  matchPercent: number;
};

export type ExpenseVariancePreview = {
  currency: "ILS" | "USD";
  method: CashDailyMethodId;
  currentExpectedAmount: number;
  currentExpensesAmount: number;
  currentExpectedNet: number;
  currentCounted: number | null;
  currentVariance: number | null;
  proposedExpenseAmount: number;
  afterExpensesAmount: number;
  afterExpectedNet: number;
  afterVariance: number | null;
  messageKind: "closes" | "reduces" | "still_open" | "no_count" | "no_cash_line" | "invalid_amount";
  message: string;
};

export function computeCashVarianceLine(
  method: CashDailyMethodId,
  meta: { label: string; currency: "ILS" | "USD" },
  grossReceived: number,
  expenses: CashDailyExpenseTotals,
  counted: number | null | undefined,
): CashVarianceLineDto {
  const line = buildDailyReconciliation(
    { CASH_ILS: 0, CASH_USD: 0, CREDIT: 0, CHECK: 0, BANK_TRANSFER: 0, OTHER: 0, [method]: grossReceived },
    { [method]: counted ?? null },
    expenses,
  ).find((l) => l.method === method)!;

  return {
    method: line.method,
    label: line.label,
    currency: line.currency,
    expectedAmount: line.grossReceived,
    expensesAmount: line.expense,
    expectedNet: line.received,
    countedAmount: line.counted,
    variance: line.diff,
    status: line.status,
  };
}

export function computeCashVarianceDay(
  intake: CashDailyIntakeTotals,
  drawer: CashDailyDrawerValues,
  expenses: CashDailyExpenseTotals = emptyDailyExpenses(),
): CashVarianceDaySummary {
  const lines = buildDailyReconciliation(intake, drawer, expenses).map((line) => ({
    method: line.method,
    label: line.label,
    currency: line.currency,
    expectedAmount: line.grossReceived,
    expensesAmount: line.expense,
    expectedNet: line.received,
    countedAmount: line.counted,
    variance: line.diff,
    status: line.status,
  }));

  const countedLines = lines.filter((l) => l.countedAmount != null);
  if (countedLines.length === 0) {
    return {
      lines,
      status: "pending",
      worstVariance: null,
      worstCurrency: "ILS",
      worstMethod: null,
      matchPercent: 0,
    };
  }

  let worst: CashVarianceLineDto | null = null;
  for (const l of countedLines) {
    if (l.variance == null) continue;
    if (!worst || Math.abs(l.variance) > Math.abs(worst.variance ?? 0)) worst = l;
  }

  const okCount = countedLines.filter((l) => l.status === "ok").length;
  const matchPercent = Math.round((okCount / countedLines.length) * 100);

  if (!worst || worst.variance == null || Math.abs(worst.variance) <= CASH_CONTROL_EPS) {
    return {
      lines,
      status: "ok",
      worstVariance: 0,
      worstCurrency: worst?.currency ?? "ILS",
      worstMethod: worst?.method ?? null,
      matchPercent,
    };
  }

  return {
    lines,
    status: worst.status,
    worstVariance: worst.variance,
    worstCurrency: worst.currency,
    worstMethod: worst.method,
    matchPercent,
  };
}

/** המרה ל-CashDailyReconLine לתאימות לאחור */
export function varianceLineToRecon(line: CashVarianceLineDto): CashDailyReconLine {
  return {
    method: line.method,
    label: line.label,
    currency: line.currency,
    grossReceived: line.expectedAmount,
    expense: line.expensesAmount,
    received: line.expectedNet,
    counted: line.countedAmount,
    diff: line.variance,
    status: line.status,
  };
}

export function computeCashVarianceReconciliation(
  intake: CashDailyIntakeTotals,
  drawer: CashDailyDrawerValues,
  expenses: CashDailyExpenseTotals = emptyDailyExpenses(),
): CashDailyReconLine[] {
  return buildDailyReconciliation(intake, drawer, expenses);
}

export function previewExpenseVarianceImpact(
  lines: CashVarianceLineDto[],
  currency: "ILS" | "USD",
  proposedExpenseAmount: number,
  dailyMethod?: CashDailyMethodId,
): ExpenseVariancePreview {
  const method: CashDailyMethodId =
    dailyMethod ?? (currency === "USD" ? "CASH_USD" : "CASH_ILS");
  const line = lines.find((l) => l.method === method);

  if (!line) {
    return {
      currency,
      method,
      currentExpectedAmount: 0,
      currentExpensesAmount: 0,
      currentExpectedNet: 0,
      currentCounted: null,
      currentVariance: null,
      proposedExpenseAmount: 0,
      afterExpensesAmount: 0,
      afterExpectedNet: 0,
      afterVariance: null,
      messageKind: "no_cash_line",
      message: "אין נתוני התאמה לערוץ זה ביום הנבחר",
    };
  }

  const amt = round2(proposedExpenseAmount);
  if (amt <= 0) {
    return {
      currency,
      method,
      currentExpectedAmount: line.expectedAmount,
      currentExpensesAmount: line.expensesAmount,
      currentExpectedNet: line.expectedNet,
      currentCounted: line.countedAmount,
      currentVariance: line.variance,
      proposedExpenseAmount: 0,
      afterExpensesAmount: line.expensesAmount,
      afterExpectedNet: line.expectedNet,
      afterVariance: line.variance,
      messageKind: "invalid_amount",
      message: "הזן סכום הוצאה לתצוגת השפעה",
    };
  }

  if (line.countedAmount == null) {
    return {
      currency,
      method,
      currentExpectedAmount: line.expectedAmount,
      currentExpensesAmount: line.expensesAmount,
      currentExpectedNet: line.expectedNet,
      currentCounted: null,
      currentVariance: null,
      proposedExpenseAmount: amt,
      afterExpensesAmount: round2(line.expensesAmount + amt),
      afterExpectedNet: round2(line.expectedNet - amt),
      afterVariance: null,
      messageKind: "no_count",
      message: "ההשפעה תחושב לאחר הזנת ספירת מנהל.",
    };
  }

  const afterExpenses = round2(line.expensesAmount + amt);
  const afterExpectedNet = round2(line.expectedAmount - afterExpenses);
  const afterVariance = round2(afterExpectedNet - line.countedAmount);
  const curVar = line.variance ?? 0;

  let messageKind: ExpenseVariancePreview["messageKind"] = "still_open";
  let message = `לאחר רישום ההוצאה עדיין תישאר חריגה של ${formatVarianceShort(currency, afterVariance)}.`;

  if (Math.abs(afterVariance) <= CASH_CONTROL_EPS) {
    messageKind = "closes";
    message = "ההוצאה צפויה לסגור את החריגה.";
  } else if (Math.abs(afterVariance) < Math.abs(curVar) - CASH_CONTROL_EPS) {
    messageKind = "reduces";
    message = "ההוצאה תקטין את החריגה אך לא תסגור אותה.";
  }

  return {
    currency,
    method,
    currentExpectedAmount: line.expectedAmount,
    currentExpensesAmount: line.expensesAmount,
    currentExpectedNet: line.expectedNet,
    currentCounted: line.countedAmount,
    currentVariance: line.variance,
    proposedExpenseAmount: amt,
    afterExpensesAmount: afterExpenses,
    afterExpectedNet,
    afterVariance,
    messageKind,
    message,
  };
}

export function formatVarianceShort(currency: "ILS" | "USD", variance: number | null): string {
  if (variance == null) return "—";
  const abs = Math.abs(variance);
  const body =
    currency === "ILS"
      ? `₪${abs.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
      : `$${abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  if (Math.abs(variance) <= CASH_CONTROL_EPS) return body;
  return variance > 0 ? `${body}-` : `+${body}`;
}

export function varianceStatusLabel(status: CashDailyStatusKind): string {
  switch (status) {
    case "ok":
      return "תקין";
    case "warn":
      return "הפרש קטן";
    case "critical":
      return "חריג";
    default:
      return "ממתין";
  }
}

export function varianceProblemSummary(line: CashVarianceLineDto): string | null {
  if (line.countedAmount == null) return null;
  if (line.variance == null || Math.abs(line.variance) <= CASH_CONTROL_EPS) {
    return `לא נמצאה חריגה ב${line.label}\nצפוי נטו: ${formatVarianceShort(line.currency, line.expectedNet).replace("-", "").replace("+", "")}\nנספר בפועל: ${formatVarianceShort(line.currency, line.countedAmount).replace("-", "").replace("+", "")}`;
  }
  const shortfall = line.variance > 0;
  return [
    `נמצאה חריגה ב${line.label}`,
    `צפוי נטו: ${formatMoneyPlain(line.currency, line.expectedNet)}`,
    `נספר בפועל: ${formatMoneyPlain(line.currency, line.countedAmount)}`,
    shortfall ? `חסר: ${formatVarianceShort(line.currency, line.variance)}` : `עודף: ${formatVarianceShort(line.currency, -line.variance)}`,
    line.expensesAmount > 0
      ? "החריגה מחושבת לאחר קיזוז הוצאות קופה שנרשמו."
      : "ייתכן שחסר רישום הוצאת קופה — בדוק אם יצא כסף מהקופה.",
  ].join("\n");
}

function formatMoneyPlain(currency: "ILS" | "USD", amount: number): string {
  return formatVarianceShort(currency, amount).replace("-", "").replace("+", "");
}

export function reconLinesToVariance(lines: Array<{
  method: CashDailyMethodId;
  label: string;
  currency: "ILS" | "USD";
  grossReceived: string | number;
  expense: string | number;
  received: string | number;
  counted: string | null;
  diff: string | null;
  status: CashDailyStatusKind;
}>): CashVarianceLineDto[] {
  return lines.map((r) => ({
    method: r.method,
    label: r.label,
    currency: r.currency,
    expectedAmount: Number(r.grossReceived) || 0,
    expensesAmount: Number(r.expense) || 0,
    expectedNet: Number(r.received) || 0,
    countedAmount: r.counted != null && r.counted !== "" ? Number(r.counted) : null,
    variance: r.diff != null && r.diff !== "" ? Number(r.diff) : null,
    status: r.status,
  }));
}
