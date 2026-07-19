/**
 * בקרת קופה יומית — אגרגציה לפי יום (ירושלים) וערוץ (אמצעי + מטבע).
 * מקור אמת: קליטות התשלום. הספירה (drawer) מוזנת ידנית ומושווית מול «התקבל».
 */

import { CASH_CONTROL_EPS, calculateCashControlVariance } from "@/lib/cash-control-calculation";
import {
  CASH_CONTROL_CHANNELS,
  CASH_DAILY_METHODS,
  allCashControlChannels,
  channelCurrency,
  emptyChannelTotals,
  formatChannelLabel,
  resolveChannelFromPaymentBucket,
  type CashControlChannel,
  type CashControlChannelMeta,
  type CashControlCurrency,
} from "@/lib/cash-control-channel";
import {
  paymentMethodBucketKey,
  type PaymentBucketKey,
} from "@/lib/payment-breakdown-shared";
import type { ReconciliationPaymentInput } from "@/lib/cash-control-reconciliation";
import { formatYmdJerusalem, getJerusalemDayOfWeek, isValidYmd } from "@/lib/weeks/ah-week";

export type {
  CashControlChannel,
  CashControlChannelMeta,
  CashControlCurrency,
  CashExpensePaymentMethod,
} from "@/lib/cash-control-channel";
export {
  CASH_CONTROL_CHANNELS,
  CASH_DAILY_METHODS,
  allCashControlChannels,
  channelCurrency,
  formatChannelLabel,
  resolveCashControlChannel,
  resolveChannelFromPaymentBucket,
} from "@/lib/cash-control-channel";

/** ערוץ בקרת קופה — מטבע + אמצעי תשלום */
export type CashDailyMethodId = CashControlChannel;

export type CashDailyIntakeColumnId = CashDailyMethodId;
export type CashDailyDrawerColumnId = CashDailyMethodId;

export type CashDailyStatusKind = "ok" | "warn" | "critical" | "pending";

export type CashDailyIntakeTotals = Record<CashDailyMethodId, number>;
export type CashDailyDrawerValues = Partial<Record<CashDailyMethodId, number | null>>;

export type CashDailyMethodMeta = CashControlChannelMeta;

/** תאימות לאחור */
export const CASH_DAILY_INTAKE_COLUMNS = CASH_DAILY_METHODS;
export const CASH_DAILY_DRAWER_COLUMNS = CASH_DAILY_METHODS;

/** ספים לקביעת צבע הסטטוס */
export const CASH_DAILY_DIFF_THRESHOLD = { ILS: 50, USD: 5 } as const;

const HEB_DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export type CashDailyReconLine = {
  method: CashDailyMethodId;
  label: string;
  currency: CashControlCurrency;
  grossReceived: number;
  expense: number;
  received: number;
  counted: number | null;
  diff: number | null;
  status: CashDailyStatusKind;
};

export type CashDailyExpenseTotals = CashDailyIntakeTotals;

export function emptyDailyExpenses(): CashDailyExpenseTotals {
  return emptyDailyIntake();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(v: { toString(): string } | null | undefined): number {
  const n = Number(v?.toString() ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function emptyDailyIntake(): CashDailyIntakeTotals {
  return emptyChannelTotals();
}

function bucketToMethod(bucket: PaymentBucketKey, side: CashControlCurrency): CashDailyMethodId | null {
  return resolveChannelFromPaymentBucket(bucket, side);
}

export function dayNameHe(ymd: string): string {
  if (!isValidYmd(ymd)) return "";
  return HEB_DAY_NAMES[getJerusalemDayOfWeek(ymd)] ?? "";
}

export function formatDailyDateDisplay(ymd: string): string {
  if (!isValidYmd(ymd)) return ymd;
  const [, m, d] = ymd.split("-");
  return `${d}/${m}`;
}

export function paymentDayKeyJerusalem(p: { paymentDate: Date | string | null; createdAt: Date | string }): string {
  const raw = p.paymentDate ?? p.createdAt;
  return formatYmdJerusalem(new Date(raw));
}

export type DailyPaymentSplitInput = {
  amountIls: { toString(): string } | null;
  amountUsd: { toString(): string } | null;
  paymentMethod: string | null;
  usdPaymentMethod: string | null;
  ilsPaymentMethod: string | null;
  exchangeRate?: { toString(): string } | null;
  methodAllocations?: Array<{
    method: string;
    currency: string;
    sourceAmount: { toString(): string };
  }>;
};

function contributionsFromStructuredMethods(
  p: DailyPaymentSplitInput,
): Array<{ column: CashDailyMethodId; amount: number }> | null {
  const parts = p.methodAllocations ?? [];
  if (parts.length === 0) return null;

  const out: Array<{ column: CashDailyMethodId; amount: number }> = [];
  for (const part of parts) {
    const side = part.currency === "USD" ? "USD" : "ILS";
    const col = bucketToMethod(paymentMethodBucketKey(part.method), side);
    if (!col) continue;
    out.push({ column: col, amount: num(part.sourceAmount) });
  }
  return out.length > 0 ? out : null;
}

export function getDailyPaymentContributions(
  p: DailyPaymentSplitInput,
): Array<{ column: CashDailyMethodId; amount: number }> {
  const structured = contributionsFromStructuredMethods(p);
  if (structured) return structured;

  const out: Array<{ column: CashDailyMethodId; amount: number }> = [];
  const ilsAmt = num(p.amountIls);
  const usdAmt = num(p.amountUsd);

  if (ilsAmt > CASH_CONTROL_EPS) {
    const method = (p.ilsPaymentMethod ?? p.paymentMethod ?? "").trim();
    if (method) {
      const col = bucketToMethod(paymentMethodBucketKey(method), "ILS");
      if (col) out.push({ column: col, amount: ilsAmt });
    }
  }

  if (usdAmt > CASH_CONTROL_EPS) {
    const method = (p.usdPaymentMethod || p.paymentMethod || "").trim();
    if (method) {
      const col = bucketToMethod(paymentMethodBucketKey(method), "USD");
      if (col) out.push({ column: col, amount: usdAmt });
    }
  }

  return out;
}

export function paymentAmountForDailyColumn(p: ReconciliationPaymentInput, column: CashDailyMethodId): number {
  return getDailyPaymentContributions(p)
    .filter((c) => c.column === column)
    .reduce((s, c) => s + c.amount, 0);
}

export function paymentMatchesDailyColumn(p: ReconciliationPaymentInput, column: CashDailyMethodId): boolean {
  return paymentAmountForDailyColumn(p, column) > CASH_CONTROL_EPS;
}

export function aggregateDailyIntakes(
  payments: Array<ReconciliationPaymentInput & { paymentDate: Date | string | null; createdAt: Date | string }>,
): Map<string, CashDailyIntakeTotals> {
  const map = new Map<string, CashDailyIntakeTotals>();
  for (const p of payments) {
    const day = paymentDayKeyJerusalem(p);
    let totals = map.get(day);
    if (!totals) {
      totals = emptyDailyIntake();
      map.set(day, totals);
    }
    for (const c of getDailyPaymentContributions(p)) {
      totals[c.column] = round2(totals[c.column] + c.amount);
    }
  }
  return map;
}

export function diffStatusKind(
  variance: number | null,
  currency: CashControlCurrency,
): CashDailyStatusKind {
  if (variance == null) return "pending";
  const abs = Math.abs(variance);
  if (abs <= CASH_CONTROL_EPS) return "ok";
  if (abs <= CASH_DAILY_DIFF_THRESHOLD[currency]) return "warn";
  return "critical";
}

export function buildDailyReconciliation(
  intake: CashDailyIntakeTotals,
  drawer: CashDailyDrawerValues,
  expenses: CashDailyExpenseTotals = emptyDailyExpenses(),
): CashDailyReconLine[] {
  return CASH_DAILY_METHODS.map((m) => {
    const grossReceived = round2(intake[m.id] ?? 0);
    const expense = round2(expenses[m.id] ?? 0);
    const countedRaw = drawer[m.id];
    const counted = countedRaw === null || countedRaw === undefined ? null : round2(countedRaw);
    const calc = calculateCashControlVariance({
      receivedAmount: grossReceived,
      existingExpensesAmount: expense,
      countedAmount: counted,
    });
    const diff = calc.varianceAmount;
    return {
      method: m.id,
      label: formatChannelLabel(m.id),
      currency: m.currency,
      grossReceived,
      expense,
      received: calc.expectedNetAmount,
      counted,
      diff,
      status: diffStatusKind(diff, m.currency),
    };
  });
}

export function computeDailyStatus(
  intake: CashDailyIntakeTotals,
  drawer: CashDailyDrawerValues,
  expenses: CashDailyExpenseTotals = emptyDailyExpenses(),
): {
  kind: CashDailyStatusKind;
  worstDiff: number | null;
  worstCurrency: CashControlCurrency;
  worstMethod: CashDailyMethodId | null;
} {
  const lines = buildDailyReconciliation(intake, drawer, expenses);
  const countedLines = lines.filter((l) => l.counted != null);
  if (countedLines.length === 0) {
    return { kind: "pending", worstDiff: null, worstCurrency: "ILS", worstMethod: null };
  }
  let worst: CashDailyReconLine | null = null;
  for (const l of countedLines) {
    if (l.diff == null) continue;
    if (!worst || Math.abs(l.diff) > Math.abs(worst.diff ?? 0)) worst = l;
  }
  if (!worst || worst.diff == null || Math.abs(worst.diff) <= CASH_CONTROL_EPS) {
    return { kind: "ok", worstDiff: 0, worstCurrency: "ILS", worstMethod: null };
  }
  return {
    kind: worst.status,
    worstDiff: worst.diff,
    worstCurrency: worst.currency,
    worstMethod: worst.method,
  };
}

export function fmtDailyMoney(currency: CashControlCurrency, amount: number): string {
  const abs = Math.abs(amount);
  const body =
    currency === "ILS"
      ? `₪${abs.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
      : `$${abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  return amount < 0 ? `-${body}` : body;
}

/** סכום ערוצי ₪ (לסיכומי שבוע בבקרת תזרים) */
export function sumIlsChannelIntake(intake: CashDailyIntakeTotals): number {
  return round2(
    allCashControlChannels()
      .filter((id) => channelCurrency(id) === "ILS")
      .reduce((s, id) => s + (intake[id] ?? 0), 0),
  );
}
