import { roundMoney2 } from "@/lib/payment-intake";
import { computeCommissionResetPreviewNumbers } from "@/lib/customer-commission-reset-preview";

const EPS = 0.01;

/**
 * יתרת עמלה לתצוגה בקליטת תשלום = SSOT מהשרת + דельת תצוגה (טרם נשמר).
 * אין לשנות את SSOT — רק preview לפני שמירה.
 */
export function computePaymentIntakeCommissionDisplayUsd(params: {
  serverCommissionBalanceUsd: number;
  /** סה״כ חוסר לאיפוס מעמלה (איפוס יתרה / איפוס עמלה) */
  pendingDebitFromCommissionUsd: number;
  /** תשלום יתר → עמלה (delta בלבד לתשלום קיים) */
  pendingCreditToCommissionUsd: number;
}): number {
  const base = roundMoney2(params.serverCommissionBalanceUsd);
  const debit = roundMoney2(Math.max(0, params.pendingDebitFromCommissionUsd));
  const credit = roundMoney2(Math.max(0, params.pendingCreditToCommissionUsd));
  return roundMoney2(base + credit - debit);
}

/** חישוב יתרה אחרי איפוס חוב מעמלה — ללא Math.max על העמלה */
export function previewCommissionAfterDebtResetUsd(
  openDebtUsd: number,
  commissionBalanceUsd: number,
): number {
  return computeCommissionResetPreviewNumbers(openDebtUsd, commissionBalanceUsd).commissionAfterUsd;
}

export function commissionDeltaAlreadyAppliedUsd(
  existingFeeSumUsd: number,
  intendedUsd: number,
): number {
  const intended = roundMoney2(intendedUsd);
  const existing = roundMoney2(existingFeeSumUsd);
  if (intended <= EPS) return 0;
  return roundMoney2(Math.max(0, intended - existing));
}
