/**
 * Single Source of Truth — יתרת חוב / «נשאר לתשלום» ברמת הזמנה (USD).
 *
 * נוסחה: סכום מקור (totalUsd = עסקה + עמלה) − Σ תשלומים פעילים שנקלטו.
 * אין חישוב מקביל במסכים — כולם מייבאים מכאן.
 */

import {
  computeOpenDebtUsd,
  ledgerStatus,
  type LedgerBalanceStatus,
  type OrderLedgerSnapshot,
} from "@/lib/finance-data/ledger";
import type { OrderBreakdownMethodRow } from "@/lib/payment-intake";
import { formatMoneyAmount } from "@/lib/money-format";

export { computeOpenDebtUsd, ledgerStatus };
export type { LedgerBalanceStatus, OrderLedgerSnapshot };

/** סף תצוגה לסטטוס תשלום (שולם / חלקי / לא שולם) */
export const ORDER_DEBT_EPS = 0.02;

export type OrderPaymentDisplayStatus = "unpaid" | "partial" | "paid";

export function roundOrderMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** חוב חתום: חיובי = לקוח חייב; שלילי = זכות */
export function computeOrderOpenDebtSignedUsd(totalUsd: number, paidUsd: number): number {
  return computeOpenDebtUsd({
    orderId: "",
    totalUsd: Number(totalUsd),
    paidUsd: Number(paidUsd),
  }).openDebtUsd;
}

/** יתרה פתוחה לתצוגה (לא שלילית) */
export function computeOrderOpenDebtUsd(totalUsd: number, paidUsd: number): number {
  return roundOrderMoney2(Math.max(0, computeOrderOpenDebtSignedUsd(totalUsd, paidUsd)));
}

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** totalUsd מהשדה השמור, או amountUsd + commissionUsd */
export function resolveOrderTotalUsd(fields: {
  totalUsd?: unknown;
  amountUsd?: unknown;
  commissionUsd?: unknown;
}): number {
  const stored = num(fields.totalUsd);
  if (stored > 0) return roundOrderMoney2(stored);
  return roundOrderMoney2(num(fields.amountUsd) + num(fields.commissionUsd));
}

/** תצוגת סטטוס תשלום — מבוסס על Ledger בלבד */
export function deriveOrderPaymentDisplayStatus(params: {
  totalUsd: number;
  paidUsd: number;
  isDebtWithdrawal?: boolean;
  eps?: number;
}): OrderPaymentDisplayStatus {
  if (params.isDebtWithdrawal) return "paid";
  const eps = params.eps ?? ORDER_DEBT_EPS;
  const total = roundOrderMoney2(params.totalUsd);
  const paid = roundOrderMoney2(params.paidUsd);
  const open = computeOrderOpenDebtSignedUsd(total, paid);
  if (open <= eps) return "paid";
  if (paid <= eps) return "unpaid";
  return "partial";
}

/** Ledger מלא לשורת הזמנה — כל השירותים והמסכים */
export function computeOrderLedgerView(params: {
  orderId?: string;
  totalUsd?: unknown;
  amountUsd?: unknown;
  commissionUsd?: unknown;
  paidUsd: unknown;
}): OrderLedgerSnapshot & {
  remainingUsd: number;
  paymentStatus: OrderPaymentDisplayStatus;
} {
  const totalUsd = resolveOrderTotalUsd(params);
  const paidUsd = roundOrderMoney2(num(params.paidUsd));
  const snap = computeOpenDebtUsd({
    orderId: params.orderId ?? "",
    totalUsd,
    paidUsd,
  });
  return {
    ...snap,
    remainingUsd: roundOrderMoney2(Math.max(0, snap.openDebtUsd)),
    paymentStatus: deriveOrderPaymentDisplayStatus({
      totalUsd,
      paidUsd,
    }),
  };
}

export function computeOrderRemainingAfterAllocationUsd(
  totalUsd: number,
  paidUsd: number,
  allocationUsd = 0,
): number {
  const open = computeOrderOpenDebtUsd(totalUsd, paidUsd);
  const alloc = roundOrderMoney2(Number.isFinite(allocationUsd) ? allocationUsd : 0);
  return roundOrderMoney2(Math.max(0, open - alloc));
}

/** «נשאר לתשלום» — סכום עמודת יתרת החוב (matched / orderViews) */
export function sumRemainingToPayUsd(
  rows: Array<{ remainingAmount?: number; formRemainingUsd?: number }>,
): number {
  let sum = 0;
  for (const row of rows) {
    const rem =
      row.remainingAmount != null
        ? Number(row.remainingAmount)
        : row.formRemainingUsd != null
          ? Number(row.formRemainingUsd)
          : 0;
    if (Number.isFinite(rem) && rem > 0) sum += rem;
  }
  return roundOrderMoney2(sum);
}

/** יתרה חתומה לאחר הקצאת תשלום — Σ(dbRem − alloc) לכל הזמנה */
export function sumFormRemainingSignedUsd(
  rows: Array<{ formRemainingUsd?: number }>,
): number {
  let sum = 0;
  for (const row of rows) {
    const rem = row.formRemainingUsd != null ? Number(row.formRemainingUsd) : 0;
    if (Number.isFinite(rem)) sum += rem;
  }
  return roundOrderMoney2(sum);
}

export type PaymentBalanceState = "debt" | "cleared" | "surplus";

export type PaymentBalanceDisplay = {
  state: PaymentBalanceState;
  title: string;
  /** טקסט משני — למשל «תשלום יתר» / «שולם במלואו» */
  statusHint?: string;
  /** חתום: חיובי=חוב, 0=נסגר, שלילי=עודף */
  balanceUsdSigned: number;
  displayUsd: number;
  displayIls: number;
};

/**
 * SSOT — יתרת חוב לאחר תשלום (USD).
 * balanceUsd = totalDebtUsd − appliedPaymentUsd
 */
export function computePaymentBalanceUsd(
  totalDebtUsd: number,
  appliedPaymentUsd: number,
  eps = ORDER_DEBT_EPS,
): number {
  const debt = roundOrderMoney2(Math.max(0, Number(totalDebtUsd) || 0));
  const applied = roundOrderMoney2(Math.max(0, Number(appliedPaymentUsd) || 0));
  return roundOrderMoney2(debt - applied);
}

/** תצוגת כרטיס/KPI — USD ראשי, ₪ שווי מתחת */
export function derivePaymentBalanceDisplay(
  balanceUsdSigned: number,
  exchangeRate: number,
  eps = ORDER_DEBT_EPS,
): PaymentBalanceDisplay {
  const signed = roundOrderMoney2(balanceUsdSigned);
  if (Math.abs(signed) <= eps) {
    return {
      state: "cleared",
      title: "נשאר לתשלום",
      statusHint: "שולם במלואו",
      balanceUsdSigned: 0,
      displayUsd: 0,
      displayIls: 0,
    };
  }
  if (signed > eps) {
    return {
      state: "debt",
      title: "נשאר לתשלום",
      balanceUsdSigned: signed,
      displayUsd: signed,
      displayIls:
        exchangeRate > 0 ? roundOrderMoney2(signed * exchangeRate) : 0,
    };
  }
  const surplus = roundOrderMoney2(Math.abs(signed));
  return {
    state: "surplus",
    title: "תשלום יתר",
    balanceUsdSigned: roundOrderMoney2(-surplus),
    displayUsd: surplus,
    displayIls: exchangeRate > 0 ? roundOrderMoney2(surplus * exchangeRate) : 0,
  };
}

/** מחרוזות תצוגה — + לעודף, ללא −0.00 */
export function formatPaymentBalanceUsdLine(display: PaymentBalanceDisplay): string {
  const amt = formatMoneyAmount(display.displayUsd);
  if (display.state === "surplus") return `+$${amt}`;
  return `$${amt}`;
}

export function formatPaymentBalanceIlsLine(display: PaymentBalanceDisplay): string {
  const amt = formatMoneyAmount(display.displayIls);
  if (display.state === "surplus") return `+₪${amt}`;
  return `₪${amt}`;
}

/**
 * יישור שורות breakdown עם Ledger — מונע סטייה בין PMC לקליטה כש-snapshot ישן.
 * USD: Σ remaining === openDebtUsd. ILS: נשאר במטבע השורה (planned − paid).
 */
export function reconcileOrderBreakdownWithLedger(
  breakdown: OrderBreakdownMethodRow[],
  openDebtUsd: number,
): OrderBreakdownMethodRow[] {
  if (breakdown.length === 0) return breakdown;
  const targetOpen = roundOrderMoney2(Math.max(0, openDebtUsd));

  const rows = breakdown.map((b) => {
    const planned = roundOrderMoney2(Math.max(0, b.planned ?? b.plannedUsd ?? 0));
    const paid = roundOrderMoney2(Math.max(0, b.paid ?? b.paidUsd ?? 0));
    const remaining = roundOrderMoney2(Math.max(0, planned - paid));
    return {
      ...b,
      planned,
      paid,
      remaining,
      remainingUsd:
        (b.currency ?? "USD") === "ILS"
          ? roundOrderMoney2(b.remainingUsd ?? remaining)
          : remaining,
    };
  });

  const usdRows = rows.filter((r) => (r.currency ?? "USD") === "USD");
  const sumUsdRem = roundOrderMoney2(usdRows.reduce((s, r) => s + (r.remaining ?? 0), 0));
  if (Math.abs(sumUsdRem - targetOpen) > 0.005) {
    distributeUsdRemainingToMatchOpenDebt(usdRows, targetOpen);
  }
  syncBreakdownPaidFromRemaining(rows);
  return rows;
}

function syncBreakdownPaidFromRemaining(rows: OrderBreakdownMethodRow[]): void {
  for (const r of rows) {
    const planned = roundOrderMoney2(Math.max(0, r.planned ?? r.plannedUsd ?? 0));
    const remaining = roundOrderMoney2(Math.max(0, r.remaining ?? r.remainingUsd ?? 0));
    r.paid = roundOrderMoney2(Math.max(0, planned - remaining));
    if ((r.currency ?? "USD") === "USD") {
      r.paidUsd = r.paid;
      r.remainingUsd = remaining;
    }
  }
}

function distributeUsdRemainingToMatchOpenDebt(
  usdRows: OrderBreakdownMethodRow[],
  open: number,
): void {
  if (usdRows.length === 0) return;
  const sum = roundOrderMoney2(usdRows.reduce((s, r) => s + (r.remaining ?? 0), 0));

  if (sum <= 0.005 && open > 0.005) {
    const totalPlanned = usdRows.reduce((s, r) => s + (r.planned ?? 0), 0);
    let assigned = 0;
    for (let i = 0; i < usdRows.length; i++) {
      const r = usdRows[i]!;
      if (i === usdRows.length - 1) {
        r.remaining = roundOrderMoney2(open - assigned);
      } else {
        const share = totalPlanned > 0 ? (r.planned ?? 0) / totalPlanned : 1 / usdRows.length;
        r.remaining = roundOrderMoney2(open * share);
        assigned = roundOrderMoney2(assigned + r.remaining);
      }
      r.remainingUsd = r.remaining;
    }
    return;
  }

  if (sum <= 0.005) return;

  let assigned = 0;
  for (let i = 0; i < usdRows.length; i++) {
    const r = usdRows[i]!;
    if (i === usdRows.length - 1) {
      r.remaining = roundOrderMoney2(open - assigned);
    } else {
      r.remaining = roundOrderMoney2(((r.remaining ?? 0) / sum) * open);
      assigned = roundOrderMoney2(assigned + r.remaining);
    }
    r.remainingUsd = r.remaining;
  }
}
