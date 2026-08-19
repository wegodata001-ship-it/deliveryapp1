/**
 * SSOT — תשלום יתר בקליטת תשלום (USD).
 *
 * openDebtUsd = חוב פתוח לפני התשלום
 * incomingPaymentUsd = סה״כ amountUsd מכל רכיבי התשלום
 * overpaymentUsd = incomingPaymentUsd − openDebtUsd (כאשר > ORDER_DEBT_EPS)
 */
import { ORDER_DEBT_EPS, roundOrderMoney2 } from "@/lib/order-remaining-debt";
import type { LivePaymentFormKpis } from "@/lib/payment-intake-live-kpi";

export type PaymentOverpaymentPreview = {
  openDebtUsd: number;
  incomingPaymentUsd: number;
  closesDebtUsd: number;
  overpaymentUsd: number;
  hasOverpayment: boolean;
};

export function computePaymentOverpayment(
  openDebtUsd: number,
  incomingPaymentUsd: number,
  eps: number = ORDER_DEBT_EPS,
): PaymentOverpaymentPreview {
  const debt = roundOrderMoney2(Math.max(0, openDebtUsd));
  const payment = roundOrderMoney2(Math.max(0, incomingPaymentUsd));
  const overpaymentUsd = roundOrderMoney2(Math.max(0, payment - debt));
  const closesDebtUsd = roundOrderMoney2(Math.min(payment, debt));
  const hasOverpayment = payment > debt + eps;
  return {
    openDebtUsd: debt,
    incomingPaymentUsd: payment,
    closesDebtUsd,
    overpaymentUsd,
    hasOverpayment,
  };
}

/** סכום שקלים שהוזנו בטופס (לפי enteredIls בכל bucket) — לתצוגה בלבד */
export function sumEnteredIlsFromFormKpis(kpis: LivePaymentFormKpis): number {
  const buckets = [kpis.cash, kpis.bankTransfer, kpis.credit, kpis.checks, kpis.other];
  return roundOrderMoney2(buckets.reduce((sum, bucket) => sum + (bucket.enteredIls || 0), 0));
}

export function formatOverpaymentUsdSigned(overpaymentUsd: number): string {
  const n = roundOrderMoney2(overpaymentUsd);
  if (n <= ORDER_DEBT_EPS) return "$0.00";
  return `+$${n.toFixed(2)}`;
}
