/**
 * בקרת קופה יומית — אגרגציה לפי יום (ירושלים) ואמצעי תשלום.
 * מקור אמת: קליטות התשלום. הספירה (drawer) מוזנת ידנית ומושווית מול «התקבל».
 */

import { CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";
import {
  parsePaymentNoteContributions,
  paymentMethodBucketKey,
  type PaymentBucketKey,
} from "@/lib/payment-breakdown-shared";
import type { ReconciliationPaymentInput } from "@/lib/cash-control-reconciliation";
import { formatYmdJerusalem, getJerusalemDayOfWeek, isValidYmd } from "@/lib/weeks/ah-week";

/** ששת אמצעי התשלום, לפי סדר העיצוב המאושר */
export type CashDailyMethodId =
  | "CASH_ILS"
  | "CASH_USD"
  | "CREDIT"
  | "CHECK"
  | "BANK_TRANSFER"
  | "OTHER";

export type CashDailyIntakeColumnId = CashDailyMethodId;
export type CashDailyDrawerColumnId = CashDailyMethodId;

export type CashDailyStatusKind = "ok" | "warn" | "critical" | "pending";

export type CashDailyIntakeTotals = Record<CashDailyMethodId, number>;
export type CashDailyDrawerValues = Partial<Record<CashDailyMethodId, number | null>>;

export type CashDailyMethodMeta = {
  id: CashDailyMethodId;
  label: string;
  currency: "ILS" | "USD";
};

/** רשימת אמצעי התשלום — מקור יחיד לטבלה, לטופס הספירה ולטבלת ההתאמה */
export const CASH_DAILY_METHODS: CashDailyMethodMeta[] = [
  { id: "CASH_ILS", label: "מזומן ₪", currency: "ILS" },
  { id: "CASH_USD", label: "מזומן $", currency: "USD" },
  { id: "CREDIT", label: "אשראי", currency: "ILS" },
  { id: "CHECK", label: "צ'קים", currency: "ILS" },
  { id: "BANK_TRANSFER", label: "העברות", currency: "ILS" },
  { id: "OTHER", label: "אחר", currency: "ILS" },
];

/** תאימות לאחור — שמות ישנים */
export const CASH_DAILY_INTAKE_COLUMNS = CASH_DAILY_METHODS;
export const CASH_DAILY_DRAWER_COLUMNS = CASH_DAILY_METHODS;

/** ספים לקביעת צבע הסטטוס */
export const CASH_DAILY_DIFF_THRESHOLD = { ILS: 50, USD: 5 } as const;

const HEB_DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export type CashDailyReconLine = {
  method: CashDailyMethodId;
  label: string;
  currency: "ILS" | "USD";
  /** סכום ברוטו שהתקבל מקליטות התשלום (לפני ניכוי הוצאות) */
  grossReceived: number;
  /** הוצאות קופה שנוכו מהאמצעי (מזומן ₪/$ בלבד) */
  expense: number;
  /** התקבל נטו = ברוטו פחות הוצאות — מול הספירה */
  received: number;
  counted: number | null;
  /** חריגה = צפוי נטו − נספר (חיובי = חסר בקופה) */
  diff: number | null;
  status: CashDailyStatusKind;
};

/** הוצאות קופה יומיות — לפי עמודת בקרת קופה (מטבע + אמצעי תשלום) */
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
  return { CASH_ILS: 0, CASH_USD: 0, CREDIT: 0, CHECK: 0, BANK_TRANSFER: 0, OTHER: 0 };
}

function bucketToMethod(bucket: PaymentBucketKey, side: "ILS" | "USD"): CashDailyMethodId | null {
  if (bucket === "CASH") return side === "ILS" ? "CASH_ILS" : "CASH_USD";
  if (bucket === "BANK_TRANSFER") return "BANK_TRANSFER";
  if (bucket === "CHECK") return "CHECK";
  if (bucket === "CREDIT") return "CREDIT";
  if (bucket === "OTHER") return "OTHER";
  return null;
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

/** קלט לפיצול קליטה לעמודות — כולל notes לתשלום מורכב */
export type DailyPaymentSplitInput = {
  amountIls: { toString(): string } | null;
  amountUsd: { toString(): string } | null;
  paymentMethod: string | null;
  usdPaymentMethod: string | null;
  ilsPaymentMethod: string | null;
  notes?: string | null;
  exchangeRate?: { toString(): string } | null;
};

function contributionsFromNoteLines(
  p: DailyPaymentSplitInput,
): Array<{ column: CashDailyMethodId; amount: number }> | null {
  const rate = Number(p.exchangeRate?.toString() ?? 0);
  const parts = parsePaymentNoteContributions(p.notes, rate);
  if (parts.length === 0) return null;

  const out: Array<{ column: CashDailyMethodId; amount: number }> = [];
  for (const part of parts) {
    const col = bucketToMethod(part.bucket, part.side);
    if (!col) continue;
    out.push({ column: col, amount: part.amount });
  }
  return out.length > 0 ? out : null;
}

/** מפצל קליטה לעמודות הטבלה היומית (כולל «אחר»). */
export function getDailyPaymentContributions(
  p: DailyPaymentSplitInput,
): Array<{ column: CashDailyMethodId; amount: number }> {
  const fromNotes = contributionsFromNoteLines(p);
  if (fromNotes) return fromNotes;

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

/** צבע הסטטוס לפי גודל הפרש (מטבע נלקח בחשבון) */
export function diffStatusKind(diff: number | null, currency: "ILS" | "USD"): CashDailyStatusKind {
  if (diff == null) return "pending";
  const abs = Math.abs(diff);
  if (abs <= CASH_CONTROL_EPS) return "ok";
  if (abs <= CASH_DAILY_DIFF_THRESHOLD[currency]) return "warn";
  return "critical";
}

/**
 * טבלת התאמה: לכל אמצעי — צפוי / הוצאות / צפוי נטו / נספר / חריגה.
 * חריגה = צפוי נטו − נספר (חיובי = חסר בקופה).
 */
export function buildDailyReconciliation(
  intake: CashDailyIntakeTotals,
  drawer: CashDailyDrawerValues,
  expenses: CashDailyExpenseTotals = emptyDailyExpenses(),
): CashDailyReconLine[] {
  return CASH_DAILY_METHODS.map((m) => {
    const grossReceived = round2(intake[m.id] ?? 0);
    const expense = round2(expenses[m.id] ?? 0);
    const received = round2(grossReceived - expense);
    const countedRaw = drawer[m.id];
    const counted = countedRaw === null || countedRaw === undefined ? null : round2(countedRaw);
    const diff = counted == null ? null : round2(received - counted);
    return {
      method: m.id,
      label: m.label,
      currency: m.currency,
      grossReceived,
      expense,
      received,
      counted,
      diff,
      status: diffStatusKind(diff, m.currency),
    };
  });
}

/** סטטוס יומי מצרפי: המצב הגרוע ביותר בין האמצעים שנספרו. */
export function computeDailyStatus(
  intake: CashDailyIntakeTotals,
  drawer: CashDailyDrawerValues,
  expenses: CashDailyExpenseTotals = emptyDailyExpenses(),
): {
  kind: CashDailyStatusKind;
  worstDiff: number | null;
  worstCurrency: "ILS" | "USD";
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

export function fmtDailyMoney(currency: "ILS" | "USD", amount: number): string {
  const abs = Math.abs(amount);
  const body =
    currency === "ILS"
      ? `₪${abs.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
      : `$${abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  return amount < 0 ? `-${body}` : body;
}
