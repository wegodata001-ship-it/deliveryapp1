/**
 * פיצול תשלום: הקצאה לחוב לקוח (SSOT) + עודף ליתרת זכות/עמלה.
 * לא דורש הזמנה פתוחה עבור חלק העודף עצמו.
 *
 * receivedAmount = סכום שהתקבל בפועל
 * debtApplied    = MIN(received, openDebt)
 * surplusAmount  = received − debtApplied
 *
 * אמצעי תשלום מתארים איך התקבל receivedAmount.
 * הם אינם סכום העמלה.
 */
import { computePaymentOverpayment } from "@/lib/payment-overpayment";
import { roundMoney2 } from "@/lib/payment-intake";

const EPS = 0.02;

export type SurplusDestination = "commission" | "credit" | "forfeit" | "none";

export type DebtSurplusSplit = {
  receivedAmount: number;
  debtBefore: number;
  debtApplied: number;
  surplusAmount: number;
  /** סכום שיש להקצות להזמנות (סגירת חוב) */
  allocateToDebtUsd: number;
  /** עודף לתשלום כיתרת זכות / עמלות — ללא שיוך להזמנה */
  surplusUsd: number;
};

export type SurplusDestinationAmounts = {
  toCommission: number;
  toCredit: number;
  toForfeit: number;
};

/** כמה מהתשלום סוגר חוב וכמה עודף — לפי חוב לקוח SSOT */
export function splitPaymentAgainstCustomerDebt(
  customerOpenDebtUsd: number,
  paymentUsd: number,
): DebtSurplusSplit {
  const overpay = computePaymentOverpayment(customerOpenDebtUsd, paymentUsd);
  return {
    receivedAmount: overpay.incomingPaymentUsd,
    debtBefore: overpay.openDebtUsd,
    debtApplied: overpay.closesDebtUsd,
    surplusAmount: overpay.overpaymentUsd,
    allocateToDebtUsd: overpay.closesDebtUsd,
    surplusUsd: overpay.overpaymentUsd,
  };
}

/** יעד העודף — לעולם לא receivedAmount / methodTotal. */
export function resolveSurplusDestinationAmounts(
  split: DebtSurplusSplit,
  destination: SurplusDestination,
): SurplusDestinationAmounts {
  const surplus = roundMoney2(Math.max(0, split.surplusAmount));
  return {
    toCommission: destination === "commission" ? surplus : 0,
    toCredit: destination === "credit" ? surplus : 0,
    toForfeit: destination === "forfeit" ? surplus : 0,
  };
}

export function commissionWriteAmount(
  split: DebtSurplusSplit,
  destination: SurplusDestination,
): number {
  return resolveSurplusDestinationAmounts(split, destination).toCommission;
}

/**
 * אסור לכתוב עמלה = סכום הקליטה כשיש חוב שנסגר.
 * אסור לכתוב עמלה גדולה מהעודף.
 */
export function assertCommissionIsSurplusOnly(input: {
  receivedAmount: number;
  debtApplied: number;
  commissionAmount: number;
}): void {
  const received = roundMoney2(Math.max(0, input.receivedAmount));
  const debtApplied = roundMoney2(Math.max(0, input.debtApplied));
  const commission = roundMoney2(Math.max(0, input.commissionAmount));
  const surplus = roundMoney2(Math.max(0, received - debtApplied));
  if (commission - surplus > EPS) {
    throw new Error(
      `עמלה חייבת להיות העודף בלבד ($${surplus.toFixed(2)}), לא $${commission.toFixed(2)}`,
    );
  }
  if (debtApplied > EPS && received - commission <= EPS) {
    throw new Error(
      `אסור להעביר את כל סכום הקליטה ($${received.toFixed(2)}) לעמלות כשנסגר חוב $${debtApplied.toFixed(2)}`,
    );
  }
}

export function paymentSurplusInvariantHolds(split: DebtSurplusSplit): boolean {
  const sum = roundMoney2(split.debtApplied + split.surplusAmount);
  return Math.abs(sum - split.receivedAmount) <= EPS;
}

/**
 * פירוט לפי אמצעי מותר רק אם הוא מפצל את העודף הקנוני.
 * אם הסכום הוא received/methodTotal — מתעלמים וכותבים רשומת עודף אחת.
 */
export function commissionEntriesFromCanonicalSurplus<T extends { surplusUsd: number }>(
  canonicalSurplusUsd: number,
  perMethod: T[],
  fallback: T,
): T[] {
  const canonical = roundMoney2(Math.max(0, canonicalSurplusUsd));
  if (canonical <= EPS) return [];
  const methodSum = roundMoney2(perMethod.reduce((s, row) => s + (Number(row.surplusUsd) || 0), 0));
  if (perMethod.length > 0 && Math.abs(methodSum - canonical) <= 0.05) {
    return perMethod;
  }
  return [{ ...fallback, surplusUsd: canonical }];
}

/**
 * לאחר Matching/FIFO: מצמצם הקצאה כך שלא תעלה על חוב הלקוח,
 * ומחזיר את העודף כ-unallocated (לקרדיט/עמלה).
 */
export function alignAllocationToCustomerDebtSurplus(params: {
  allocationEntries: Array<[string, number]>;
  customerOpenDebtUsd: number;
  paymentUsd: number;
}): { allocationEntries: Array<[string, number]>; unallocatedUsd: number } {
  const split = splitPaymentAgainstCustomerDebt(params.customerOpenDebtUsd, params.paymentUsd);
  const entries: Array<[string, number]> = params.allocationEntries.map(([id, amt]) => [
    id,
    roundMoney2(amt),
  ]);

  let allocatedSum = roundMoney2(entries.reduce((s, [, a]) => s + a, 0));
  let peel = roundMoney2(Math.max(0, allocatedSum - split.allocateToDebtUsd));

  for (let i = entries.length - 1; i >= 0 && peel > EPS; i--) {
    const [oid, amt] = entries[i]!;
    const take = roundMoney2(Math.min(amt, peel));
    const next = roundMoney2(amt - take);
    if (next <= EPS) entries.splice(i, 1);
    else entries[i] = [oid, next];
    peel = roundMoney2(peel - take);
  }

  allocatedSum = roundMoney2(entries.reduce((s, [, a]) => s + a, 0));
  const unallocatedUsd = roundMoney2(Math.max(0, params.paymentUsd - allocatedSum));
  return { allocationEntries: entries, unallocatedUsd };
}

/** האם מותר לשמור בלי שורות הקצאה להזמנות (עודף טהור כקרדיט/עמלה) */
export function canSaveSurplusWithoutOrderAllocation(params: {
  surplusAsCredit: boolean;
  surplusToCommission: boolean;
  surplusForfeit?: boolean;
  unallocatedUsd: number;
  customerOpenDebtUsd: number;
}): boolean {
  const hasDisposition =
    params.surplusAsCredit || params.surplusToCommission || Boolean(params.surplusForfeit);
  return (
    hasDisposition &&
    params.unallocatedUsd > EPS &&
    params.customerOpenDebtUsd <= EPS
  );
}
