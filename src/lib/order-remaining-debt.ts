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
import { normalizeExclusiveCustomerBooks } from "@/lib/customer-account-balances-shared";
import type { OrderBreakdownMethodRow } from "@/lib/payment-intake";
import { formatMoneyAmount } from "@/lib/money-format";
import { convertDebtUsdToIlsIncludingVat } from "@/lib/usd-balance-ils-vat";

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
  /** יתרה לגבייה אחרי משיכות + זכות — גובר על total−paid */
  effectiveRemainingUsd?: number;
  eps?: number;
}): OrderPaymentDisplayStatus {
  if (params.isDebtWithdrawal) return "paid";
  const eps = params.eps ?? ORDER_DEBT_EPS;
  const paid = roundOrderMoney2(params.paidUsd);
  if (params.effectiveRemainingUsd != null && Number.isFinite(params.effectiveRemainingUsd)) {
    const rem = roundOrderMoney2(Math.max(0, params.effectiveRemainingUsd));
    if (rem <= eps) return "paid";
    if (paid <= eps) return "unpaid";
    return "partial";
  }
  const total = roundOrderMoney2(params.totalUsd);
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

/**
 * משיכת חוב ברמת לקוח נסגרת FIFO על יתרות הזמנה (הישן קודם).
 * לא משנה תשלומים שנקלטו — רק כמה נשאר לגבייה.
 */
export function applyDebtWithdrawalFifoToRemainders(
  remaindersUsd: number[],
  withdrawalUsd: number,
): number[] {
  let left = roundOrderMoney2(Math.max(0, Number(withdrawalUsd) || 0));
  return remaindersUsd.map((raw) => {
    const remaining = roundOrderMoney2(Math.max(0, Number(raw) || 0));
    if (left <= ORDER_DEBT_EPS || remaining <= ORDER_DEBT_EPS) return remaining;
    const take = Math.min(remaining, left);
    left = roundOrderMoney2(left - take);
    return roundOrderMoney2(remaining - take);
  });
}

/**
 * כמה CUSTOMER_CREDIT מותר להקצות וירטואלית להזמנות.
 * אותם כללי זכאות כמו normalizeExclusiveCustomerBooks:
 * min(ספר הזכות הפעיל של ה-SSOT, יתרה לגבייה אחרי משיכות).
 * לא משתמשים ביתרת זכות שאחרי exclusive — שם 101 כבר 0.
 */
export function creditUsdEligibleForOrderFifo(input: {
  remainingAfterWithdrawalUsd: number;
  availableCreditUsd: number;
}): number {
  const remaining = roundOrderMoney2(Math.max(0, Number(input.remainingAfterWithdrawalUsd) || 0));
  const credit = roundOrderMoney2(Math.max(0, Number(input.availableCreditUsd) || 0));
  const books = normalizeExclusiveCustomerBooks({
    openDebtUsd: remaining,
    availableCreditUsd: credit,
  });
  return roundOrderMoney2(Math.max(0, remaining - books.openDebtUsd));
}

function applyCollectibleBooksFifo(
  remaindersUsd: number[],
  withdrawalUsd: number,
  availableCreditUsd = 0,
): number[] {
  const afterWithdrawal = applyDebtWithdrawalFifoToRemainders(remaindersUsd, withdrawalUsd);
  const creditToApply = creditUsdEligibleForOrderFifo({
    remainingAfterWithdrawalUsd: afterWithdrawal.reduce(
      (s, n) => s + roundOrderMoney2(Math.max(0, n)),
      0,
    ),
    availableCreditUsd,
  });
  return applyDebtWithdrawalFifoToRemainders(afterWithdrawal, creditToApply);
}

/** יתרה לגבייה לפי הזמנה אחרי תשלומים + משיכת חוב FIFO + זכות לקוח זמינה. */
export function collectibleRemainingUsdByOrderId(
  rows: Array<{ orderId: string; remainingAfterPaymentsUsd: number }>,
  withdrawalUsd: number,
  availableCreditUsd = 0,
): Map<string, number> {
  const after = applyCollectibleBooksFifo(
    rows.map((row) => row.remainingAfterPaymentsUsd),
    withdrawalUsd,
    availableCreditUsd,
  );
  return new Map(rows.map((row, index) => [row.orderId, after[index] ?? 0]));
}

/** כמה זכות הוקצתה וירטואלית לכל הזמנה (FIFO אחרי משיכות). לא כותב ל-DB. */
export function virtualCustomerCreditAppliedUsdByOrderId(
  rows: Array<{ orderId: string; remainingAfterPaymentsUsd: number }>,
  withdrawalUsd: number,
  availableCreditUsd: number,
): Map<string, number> {
  const afterWithdrawal = applyDebtWithdrawalFifoToRemainders(
    rows.map((row) => row.remainingAfterPaymentsUsd),
    withdrawalUsd,
  );
  const afterCredit = applyCollectibleBooksFifo(
    rows.map((row) => row.remainingAfterPaymentsUsd),
    withdrawalUsd,
    availableCreditUsd,
  );
  return new Map(
    rows.map((row, index) => [
      row.orderId,
      roundOrderMoney2(Math.max(0, (afterWithdrawal[index] ?? 0) - (afterCredit[index] ?? 0))),
    ]),
  );
}

/** חוב פתוח לגבייה = Σ יתרות אחרי תשלומים − משיכות − זכות זמינה. */
export function collectibleOpenDebtAfterWithdrawalUsd(
  remaindersAfterPaymentsUsd: number[],
  withdrawalUsd: number,
  availableCreditUsd = 0,
): number {
  const after = applyCollectibleBooksFifo(
    remaindersAfterPaymentsUsd,
    withdrawalUsd,
    availableCreditUsd,
  );
  return roundOrderMoney2(after.reduce((s, n) => s + roundOrderMoney2(Math.max(0, n)), 0));
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

export type PaymentBalanceState = "debt" | "cleared" | "surplus" | "credit";

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
      displayIls: convertDebtUsdToIlsIncludingVat(signed, exchangeRate),
    };
  }
  const surplus = roundOrderMoney2(Math.abs(signed));
  return {
    state: "surplus",
    title: "תשלום יתר",
    balanceUsdSigned: roundOrderMoney2(-surplus),
    displayUsd: surplus,
    displayIls: convertDebtUsdToIlsIncludingVat(surplus, exchangeRate),
  };
}

/**
 * כרטיס מצב לקוח בקליטת תשלום — Debt / Credit / Balanced.
 * לא משתמש ב-signedBalance. Credit רק מ-availableCreditUsd.
 */
export function deriveCustomerAccountBalanceDisplay(
  books: { openDebtUsd: number; availableCreditUsd: number },
  exchangeRate: number,
  eps = ORDER_DEBT_EPS,
): PaymentBalanceDisplay {
  const exclusive = normalizeExclusiveCustomerBooks(books);
  const openDebtUsd = exclusive.openDebtUsd;
  const availableCreditUsd = exclusive.availableCreditUsd;
  if (openDebtUsd > eps) {
    return {
      state: "debt",
      title: "נשאר לתשלום",
      balanceUsdSigned: openDebtUsd,
      displayUsd: openDebtUsd,
      displayIls: convertDebtUsdToIlsIncludingVat(openDebtUsd, exchangeRate),
    };
  }
  if (availableCreditUsd > eps) {
    return {
      state: "credit",
      title: "יתרת זכות",
      balanceUsdSigned: roundOrderMoney2(-availableCreditUsd),
      displayUsd: availableCreditUsd,
      displayIls: convertDebtUsdToIlsIncludingVat(availableCreditUsd, exchangeRate),
    };
  }
  return {
    state: "cleared",
    title: "נשאר לתשלום",
    statusHint: "מאוזן",
    balanceUsdSigned: 0,
    displayUsd: 0,
    displayIls: 0,
  };
}

/** מחרוזות תצוגה — + לעודף, ללא −0.00 */
export function formatPaymentBalanceUsdLine(display: PaymentBalanceDisplay): string {
  const amt = formatMoneyAmount(display.displayUsd);
  if (display.state === "surplus" || display.state === "credit") return `+$${amt}`;
  return `$${amt}`;
}

export function formatPaymentBalanceIlsLine(display: PaymentBalanceDisplay): string {
  const amt = formatMoneyAmount(display.displayIls);
  const suffix = display.displayIls > 0.005 ? " כולל מע״מ" : "";
  if (display.state === "surplus" || display.state === "credit") return `+₪${amt}${suffix}`;
  return `₪${amt}${suffix}`;
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
