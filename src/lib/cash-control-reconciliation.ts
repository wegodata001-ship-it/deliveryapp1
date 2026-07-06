/**
 * התאמת קופה — אגרגציה של קליטות תשלום לפי אמצעי (ללא שינוי לוגיקת קליטה).
 */

import { CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";
import { paymentMethodBucketKey, type PaymentBucketKey } from "@/lib/payment-breakdown-shared";

export type CashReconciliationLineId =
  | "CASH_ILS"
  | "CASH_USD"
  | "CREDIT"
  | "BANK_TRANSFER"
  | "CHECK";

export type CashReconciliationCurrency = "ILS" | "USD";

export type CashReconciliationStatus = "ok" | "short" | "excess";

export type CashReconciliationLineMeta = {
  id: CashReconciliationLineId;
  label: string;
  icon: string;
  currency: CashReconciliationCurrency;
};

export const CASH_RECONCILIATION_LINES: CashReconciliationLineMeta[] = [
  { id: "CASH_ILS", label: "מזומן ₪", icon: "💵", currency: "ILS" },
  { id: "CASH_USD", label: "מזומן $", icon: "💵", currency: "USD" },
  { id: "CREDIT", label: "אשראי", icon: "💳", currency: "ILS" },
  { id: "BANK_TRANSFER", label: "העברה בנקאית", icon: "🏦", currency: "ILS" },
  { id: "CHECK", label: "צ׳קים", icon: "🧾", currency: "ILS" },
];

export type CashReconciliationSummaryRow = {
  lineId: CashReconciliationLineId;
  label: string;
  icon: string;
  currency: CashReconciliationCurrency;
  recorded: number;
  paymentCount: number;
};

export type CashReconciliationSummaryPayload = {
  rows: CashReconciliationSummaryRow[];
};

export type ReconciliationPaymentInput = {
  amountIls: { toString(): string } | null;
  amountUsd: { toString(): string } | null;
  paymentMethod: string | null;
  usdPaymentMethod: string | null;
  ilsPaymentMethod: string | null;
};

type LineContribution = { lineId: CashReconciliationLineId; amount: number };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(v: { toString(): string } | null | undefined): number {
  const n = Number(v?.toString() ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function bucketToLineId(bucket: PaymentBucketKey, side: "ILS" | "USD"): CashReconciliationLineId | null {
  if (bucket === "CASH") return side === "ILS" ? "CASH_ILS" : "CASH_USD";
  if (bucket === "CREDIT") return "CREDIT";
  if (bucket === "BANK_TRANSFER") return "BANK_TRANSFER";
  if (bucket === "CHECK") return "CHECK";
  return null;
}

/** מפצל קליטה לתרומות לשורות ההתאמה (מזומן ₪/$, אשראי, העברה, צ׳קים). */
export function getPaymentReconciliationContributions(p: ReconciliationPaymentInput): LineContribution[] {
  const out: LineContribution[] = [];
  const ilsAmt = num(p.amountIls);
  const usdAmt = num(p.amountUsd);

  if (ilsAmt > CASH_CONTROL_EPS) {
    const method = (p.ilsPaymentMethod ?? "").trim();
    if (method) {
      const lineId = bucketToLineId(paymentMethodBucketKey(method), "ILS");
      if (lineId) out.push({ lineId, amount: ilsAmt });
    }
  }

  if (usdAmt > CASH_CONTROL_EPS) {
    const method = (p.usdPaymentMethod || p.paymentMethod || "").trim();
    if (method) {
      const lineId = bucketToLineId(paymentMethodBucketKey(method), "USD");
      if (lineId) out.push({ lineId, amount: usdAmt });
    }
  }

  return out;
}

export function paymentMatchesReconciliationLine(
  p: ReconciliationPaymentInput,
  lineId: CashReconciliationLineId,
): boolean {
  return getPaymentReconciliationContributions(p).some((c) => c.lineId === lineId);
}

export function paymentAmountForReconciliationLine(
  p: ReconciliationPaymentInput,
  lineId: CashReconciliationLineId,
): number {
  return getPaymentReconciliationContributions(p)
    .filter((c) => c.lineId === lineId)
    .reduce((s, c) => s + c.amount, 0);
}

export function buildCashReconciliationSummary(
  payments: ReconciliationPaymentInput[],
): CashReconciliationSummaryPayload {
  const totals = new Map<CashReconciliationLineId, { amount: number; count: number }>();
  for (const line of CASH_RECONCILIATION_LINES) {
    totals.set(line.id, { amount: 0, count: 0 });
  }

  for (const p of payments) {
    const contribs = getPaymentReconciliationContributions(p);
    const seenLines = new Set<CashReconciliationLineId>();
    for (const c of contribs) {
      const bucket = totals.get(c.lineId)!;
      bucket.amount = round2(bucket.amount + c.amount);
      if (!seenLines.has(c.lineId)) {
        seenLines.add(c.lineId);
        bucket.count += 1;
      }
    }
  }

  const rows: CashReconciliationSummaryRow[] = CASH_RECONCILIATION_LINES.map((line) => {
    const t = totals.get(line.id)!;
    return {
      lineId: line.id,
      label: line.label,
      icon: line.icon,
      currency: line.currency,
      recorded: t.amount,
      paymentCount: t.count,
    };
  });

  return { rows };
}

export function reconciliationDiff(counted: number, recorded: number): number {
  return round2(counted - recorded);
}

export function reconciliationStatus(diff: number): CashReconciliationStatus {
  if (Math.abs(diff) <= CASH_CONTROL_EPS) return "ok";
  if (diff < 0) return "short";
  return "excess";
}

export const RECON_STATUS_LABELS: Record<CashReconciliationStatus, { icon: string; label: string }> = {
  ok: { icon: "✅", label: "תקין" },
  short: { icon: "🟡", label: "חסר" },
  excess: { icon: "🔴", label: "עודף" },
};

export function fmtReconciliationAmount(currency: CashReconciliationCurrency, amount: number): string {
  if (Math.abs(amount) <= CASH_CONTROL_EPS) return currency === "ILS" ? "₪0" : "$0";
  const abs = Math.abs(amount);
  const formatted =
    currency === "ILS"
      ? abs.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
      : abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const prefix = currency === "ILS" ? "₪" : "$";
  if (amount < 0) return `-${prefix}${formatted}`;
  return `${prefix}${formatted}`;
}

export function fmtReconciliationDiff(currency: CashReconciliationCurrency, diff: number): string {
  if (Math.abs(diff) <= CASH_CONTROL_EPS) return currency === "ILS" ? "₪0" : "$0";
  const sign = diff > 0 ? "+" : "-";
  return `${sign}${fmtReconciliationAmount(currency, Math.abs(diff)).replace(/^-/, "")}`;
}

export const CASH_RECON_COUNTED_STORAGE_KEY = "wego:cash-recon-counted";

export function loadCountedFromStorage(week: string): Partial<Record<CashReconciliationLineId, string>> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(`${CASH_RECON_COUNTED_STORAGE_KEY}:${week.trim()}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Record<CashReconciliationLineId, string>>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveCountedToStorage(
  week: string,
  values: Partial<Record<CashReconciliationLineId, string>>,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`${CASH_RECON_COUNTED_STORAGE_KEY}:${week.trim()}`, JSON.stringify(values));
  } catch {
    /* ignore quota */
  }
}
