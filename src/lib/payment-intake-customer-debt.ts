/**
 * SSOT — יתרת חוב לקוח בקליטת תשלום.
 *
 * מקור: getCustomerOpenDebt → calculateCustomerBalance
 * (הזמנות − תשלומים − משיכות מחוב).
 *
 * אין לחשב חוב לקוח מסכום יתרות הזמנה בלבד — משיכה מחוב אינה שורת הזמנה בקליטה.
 */

import { roundMoney2 } from "@/lib/payment-intake";

const EPS = 0.02;

export function isExistingSavedPayment(savedPaymentId: string | null | undefined): boolean {
  return Boolean(savedPaymentId?.trim());
}

/** סכום USD שמשפיע על החוב — מלא לחדש, delta לקיים */
export function computePaymentIntakeApplyUsd(params: {
  isExistingPayment: boolean;
  formTotalUsd: number;
  savedBaselineTotalUsd: number;
}): number {
  const form = Number(params.formTotalUsd);
  if (!Number.isFinite(form)) return 0;
  if (!params.isExistingPayment) return roundMoney2(Math.max(0, form));
  const baseline = Number(params.savedBaselineTotalUsd);
  if (!Number.isFinite(baseline)) return roundMoney2(form);
  return roundMoney2(form - baseline);
}

export function isExistingPaymentUnchanged(applyUsd: number): boolean {
  return Math.abs(Number(applyUsd)) <= EPS;
}

export type PaymentIntakeCustomerDebtInput = {
  /** signedBalanceUsd מ-getCustomerOpenDebt — חיובי = חוב; null = SSOT לא נטען */
  customerOpenDebtSignedUsd: number | null;
  customerBalanceResetPending?: boolean;
};

/** חוב פתוח לתצוגה בקליטה — max(0, signedBalanceUsd) */
export function paymentIntakeCustomerOpenDebtUsd(
  input: PaymentIntakeCustomerDebtInput,
): number {
  if (input.customerBalanceResetPending) return 0;
  if (input.customerOpenDebtSignedUsd == null) return 0;
  const n = Number(input.customerOpenDebtSignedUsd);
  if (!Number.isFinite(n) || n <= EPS) return 0;
  return roundMoney2(n);
}

/** חוב לפני תשלום בטופס — זהה לכרטסת */
export function paymentIntakeDebtBeforePaymentUsd(
  input: PaymentIntakeCustomerDebtInput,
): number {
  return paymentIntakeCustomerOpenDebtUsd(input);
}

/** יתרה חתומה לאחר הקצאת תשלום בטופס (שלילי = עודף) */
export function paymentIntakeDebtAfterPaymentUsd(params: {
  customerOpenDebtSignedUsd: number | null;
  formPaymentUsd: number;
  customerBalanceResetPending?: boolean;
  isExistingPayment?: boolean;
  savedBaselineTotalUsd?: number;
}): number {
  if (params.customerBalanceResetPending) return 0;
  if (params.customerOpenDebtSignedUsd == null) return 0;
  const before = paymentIntakeDebtBeforePaymentUsd(params);
  const applyUsd = params.isExistingPayment
    ? computePaymentIntakeApplyUsd({
        isExistingPayment: true,
        formTotalUsd: params.formPaymentUsd,
        savedBaselineTotalUsd: params.savedBaselineTotalUsd ?? 0,
      })
    : roundMoney2(Math.max(0, params.formPaymentUsd));
  return roundMoney2(before - applyUsd);
}

/**
 * ספרי לקוח אחרי הקצאת תשלום בטופס — תצוגה בלבד.
 * Credit גדל רק מעודף שמתווסף לספר הזכות, לא מ-signed שלילי.
 */
export function customerBooksAfterPaymentApply(params: {
  openDebtUsd: number;
  availableCreditUsd: number;
  applyUsd: number;
  surplusToCredit: boolean;
}): { openDebtUsd: number; availableCreditUsd: number } {
  const debt = roundMoney2(Math.max(0, Number(params.openDebtUsd) || 0));
  const credit = roundMoney2(Math.max(0, Number(params.availableCreditUsd) || 0));
  const apply = roundMoney2(Math.max(0, Number(params.applyUsd) || 0));
  const remainingDebt = roundMoney2(Math.max(0, debt - apply));
  const excess = roundMoney2(Math.max(0, apply - debt));
  const nextCredit =
    params.surplusToCredit && excess > 0.01 ? roundMoney2(credit + excess) : credit;
  return { openDebtUsd: remainingDebt, availableCreditUsd: nextCredit };
}
