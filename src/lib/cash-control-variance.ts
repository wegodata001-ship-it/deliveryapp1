/**
 * חישוב חריגות בקרת קופה — מקור אמת יחיד (DTO + תצוגה).
 *
 * נוסחה (calculateCashControlVariance ב-cash-control-calculation.ts):
 *   צפוי נטו = התקבל − הוצאות קופה (באותו ערוץ)
 *   הפרש = נספר בפועל − צפוי נטו
 *
 * הפרש שלילי = חסר · הפרש חיובי = עודף
 */

import {
  CASH_CONTROL_EPS,
  calculateCashControlVariance,
  type CashControlInput,
  type CashControlResult,
  type CashControlVarianceStatus,
} from "@/lib/cash-control-calculation";
import {
  buildDailyReconciliation,
  emptyDailyExpenses,
  emptyDailyIntake,
  type CashDailyDrawerValues,
  type CashDailyExpenseTotals,
  type CashDailyIntakeTotals,
  type CashDailyMethodId,
  type CashDailyReconLine,
  type CashDailyStatusKind,
} from "@/lib/cash-control-daily";

export type { CashControlInput, CashControlResult, CashControlVarianceStatus };
export { calculateCashControlVariance };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type CashVarianceLineDto = {
  method: CashDailyMethodId;
  label: string;
  currency: "ILS" | "USD";
  /** התקבל / שולם (ברוטו) */
  expectedAmount: number;
  /** הוצאות קופה שנרשמו לאותו ערוץ */
  expensesAmount: number;
  /** צפוי נטו = expected − expenses */
  expectedNet: number;
  countedAmount: number | null;
  /** הפרש = counted − expectedNet */
  variance: number | null;
  status: CashDailyStatusKind;
  cashControlStatus: CashControlVarianceStatus;
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
  channelLabel: string;
  currentExpectedAmount: number;
  currentExpensesAmount: number;
  currentExpectedNet: number;
  currentCounted: number | null;
  currentVariance: number | null;
  currentStatus: CashControlVarianceStatus;
  proposedExpenseAmount: number;
  afterExpensesAmount: number;
  afterExpectedNet: number;
  afterVariance: number | null;
  afterStatus: CashControlVarianceStatus;
  messageKind:
    | "closes"
    | "reduces"
    | "still_open"
    | "surplus"
    | "no_count"
    | "no_cash_line"
    | "invalid_amount";
  message: string;
};

function lineFromRecon(line: CashDailyReconLine): CashVarianceLineDto {
  const calc = calculateCashControlVariance({
    receivedAmount: line.grossReceived,
    existingExpensesAmount: line.expense,
    countedAmount: line.counted,
  });
  return {
    method: line.method,
    label: line.label,
    currency: line.currency,
    expectedAmount: line.grossReceived,
    expensesAmount: line.expense,
    expectedNet: calc.expectedNetAmount,
    countedAmount: line.counted,
    variance: calc.varianceAmount,
    status: line.status,
    cashControlStatus: calc.status,
  };
}

export function computeCashVarianceLine(
  method: CashDailyMethodId,
  meta: { label: string; currency: "ILS" | "USD" },
  grossReceived: number,
  expenses: CashDailyExpenseTotals,
  counted: number | null | undefined,
): CashVarianceLineDto {
  const line = buildDailyReconciliation(
    { ...emptyDailyIntake(), [method]: grossReceived },
    { [method]: counted ?? null },
    expenses,
  ).find((l) => l.method === method)!;

  return { ...lineFromRecon(line), label: meta.label, currency: meta.currency };
}

export function computeCashVarianceDay(
  intake: CashDailyIntakeTotals,
  drawer: CashDailyDrawerValues,
  expenses: CashDailyExpenseTotals = emptyDailyExpenses(),
): CashVarianceDaySummary {
  const lines = buildDailyReconciliation(intake, drawer, expenses).map(lineFromRecon);

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

  const okCount = countedLines.filter((l) => l.cashControlStatus === "MATCHED").length;
  const matchPercent = Math.round((okCount / countedLines.length) * 100);

  if (!worst || worst.variance == null || worst.cashControlStatus === "MATCHED") {
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
  const method: CashDailyMethodId = dailyMethod ?? "CASH_ILS";
  const line = lines.find((l) => l.method === method);

  const emptyPreview = (messageKind: ExpenseVariancePreview["messageKind"], message: string): ExpenseVariancePreview => ({
    currency,
    method,
    channelLabel: line?.label ?? method,
    currentExpectedAmount: line?.expectedAmount ?? 0,
    currentExpensesAmount: line?.expensesAmount ?? 0,
    currentExpectedNet: line?.expectedNet ?? 0,
    currentCounted: line?.countedAmount ?? null,
    currentVariance: line?.variance ?? null,
    currentStatus: line?.cashControlStatus ?? "WAITING_FOR_COUNT",
    proposedExpenseAmount: 0,
    afterExpensesAmount: line?.expensesAmount ?? 0,
    afterExpectedNet: line?.expectedNet ?? 0,
    afterVariance: line?.variance ?? null,
    afterStatus: line?.cashControlStatus ?? "WAITING_FOR_COUNT",
    messageKind,
    message,
  });

  if (!line) {
    return emptyPreview("no_cash_line", "אין נתוני התאמה לערוץ זה ביום הנבחר");
  }

  const amt = round2(proposedExpenseAmount);
  if (amt === 0) {
    return emptyPreview("invalid_amount", "הזן סכום הוצאה כדי לראות את ההשפעה על בקרת הקופה");
  }

  const before = calculateCashControlVariance({
    receivedAmount: line.expectedAmount,
    existingExpensesAmount: line.expensesAmount,
    countedAmount: line.countedAmount,
  });

  const after = calculateCashControlVariance({
    receivedAmount: line.expectedAmount,
    existingExpensesAmount: line.expensesAmount,
    newExpenseAmount: amt,
    countedAmount: line.countedAmount,
  });

  if (line.countedAmount == null) {
    return {
      currency,
      method,
      channelLabel: line.label,
      currentExpectedAmount: line.expectedAmount,
      currentExpensesAmount: line.expensesAmount,
      currentExpectedNet: before.expectedNetAmount,
      currentCounted: null,
      currentVariance: null,
      currentStatus: "WAITING_FOR_COUNT",
      proposedExpenseAmount: amt,
      afterExpensesAmount: after.totalExpensesAmount,
      afterExpectedNet: after.expectedNetAmount,
      afterVariance: null,
      afterStatus: "WAITING_FOR_COUNT",
      messageKind: "no_count",
      message: "עדיין לא בוצעה ספירת מנהל לערוץ זה. ההוצאה תישמר, וההשפעה תחושב לאחר ביצוע הספירה.",
    };
  }

  let messageKind: ExpenseVariancePreview["messageKind"] = "still_open";
  let message = `לאחר שמירת ההוצאה עדיין יישאר חסר של ${formatVarianceShort(currency, after.varianceAmount)}.`;

  if (after.status === "MATCHED") {
    messageKind = "closes";
    message = "הוצאה זו תסגור את החריגה.";
  } else if (after.status === "SURPLUS") {
    messageKind = "surplus";
    message = `לאחר שמירת ההוצאה יישאר עודף של ${formatVarianceShort(currency, after.varianceAmount)}.`;
  } else if (
    before.status === "SHORTAGE" &&
    after.status === "SHORTAGE" &&
    after.varianceAmount != null &&
    before.varianceAmount != null &&
    Math.abs(after.varianceAmount) < Math.abs(before.varianceAmount) - CASH_CONTROL_EPS
  ) {
    messageKind = "reduces";
    message = `ההוצאה תקטין את החריגה, אך עדיין יישאר חסר של ${formatVarianceShort(currency, after.varianceAmount)}.`;
  }

  return {
    currency,
    method,
    channelLabel: line.label,
    currentExpectedAmount: line.expectedAmount,
    currentExpensesAmount: line.expensesAmount,
    currentExpectedNet: before.expectedNetAmount,
    currentCounted: line.countedAmount,
    currentVariance: before.varianceAmount,
    currentStatus: before.status,
    proposedExpenseAmount: amt,
    afterExpensesAmount: after.totalExpensesAmount,
    afterExpectedNet: after.expectedNetAmount,
    afterVariance: after.varianceAmount,
    afterStatus: after.status,
    messageKind,
    message,
  };
}

export function cashControlStatusLabel(status: CashControlVarianceStatus): string {
  switch (status) {
    case "MATCHED":
      return "תקין";
    case "SHORTAGE":
      return "חסר";
    case "SURPLUS":
      return "עודף";
    case "WAITING_FOR_COUNT":
      return "ממתין לספירה";
    default:
      return status;
  }
}

export function formatVarianceShort(currency: "ILS" | "USD", variance: number | null): string {
  if (variance == null) return "—";
  const abs = Math.abs(variance);
  const body =
    currency === "ILS"
      ? `₪${abs.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
      : `$${abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  if (Math.abs(variance) <= CASH_CONTROL_EPS) return body;
  return variance < 0 ? `${body}-` : `+${body}`;
}

export function varianceStatusLabel(status: CashDailyStatusKind): string {
  switch (status) {
    case "ok":
      return "מאוזן";
    case "warn":
    case "critical":
      return "לא מאוזן";
    default:
      return "ממתין";
  }
}

export function varianceProblemSummary(line: CashVarianceLineDto): string | null {
  if (line.countedAmount == null) return null;
  if (line.cashControlStatus === "MATCHED") {
    return `לא נמצאה חריגה ב${line.label}\nצפוי נטו: ${formatMoneyPlain(line.currency, line.expectedNet)}\nנספר בפועל: ${formatMoneyPlain(line.currency, line.countedAmount)}`;
  }
  const shortage = (line.variance ?? 0) < -CASH_CONTROL_EPS;
  return [
    `נמצאה חריגה ב${line.label}`,
    `צפוי נטו: ${formatMoneyPlain(line.currency, line.expectedNet)}`,
    `נספר בפועל: ${formatMoneyPlain(line.currency, line.countedAmount)}`,
    shortage
      ? `חסר: ${formatVarianceShort(line.currency, line.variance)}`
      : `עודף: ${formatVarianceShort(line.currency, line.variance)}`,
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
  return lines.map((r) => {
    const expectedAmount = Number(r.grossReceived) || 0;
    const expensesAmount = Number(r.expense) || 0;
    const countedAmount = r.counted != null && r.counted !== "" ? Number(r.counted) : null;
    const calc = calculateCashControlVariance({
      receivedAmount: expectedAmount,
      existingExpensesAmount: expensesAmount,
      countedAmount,
    });
    return {
      method: r.method,
      label: r.label,
      currency: r.currency,
      expectedAmount,
      expensesAmount,
      expectedNet: calc.expectedNetAmount,
      countedAmount,
      variance: calc.varianceAmount,
      status: r.status,
      cashControlStatus: calc.status,
    };
  });
}
