/**
 * SSOT — תוצאת קליטת תשלום לאחר שמירה (Recalculate → UI modals).
 */
import { ORDER_DEBT_EPS, roundOrderMoney2 } from "@/lib/order-remaining-debt";

export type PaymentIntakePostSaveOutcome = {
  remainingDebtUsd: number;
  surplusUsd: number;
  needsSurplusDisposition: boolean;
  needsShortfallResolution: boolean;
};

export function computePaymentIntakePostSaveOutcome(params: {
  remainingDebtUsd: number;
  deferredSurplusUsd: number;
  surplusAlreadyAppliedUsd?: number;
  eps?: number;
}): PaymentIntakePostSaveOutcome {
  const eps = params.eps ?? ORDER_DEBT_EPS;
  const remainingDebtUsd = roundOrderMoney2(Math.max(0, params.remainingDebtUsd));
  const pendingSurplusUsd = roundOrderMoney2(
    Math.max(0, params.deferredSurplusUsd - (params.surplusAlreadyAppliedUsd ?? 0)),
  );
  return {
    remainingDebtUsd,
    surplusUsd: pendingSurplusUsd,
    needsSurplusDisposition: pendingSurplusUsd > eps,
    // Partial payment is a valid business outcome: keep the remaining debt open.
    // Only real overpayment requires a follow-up disposition flow.
    needsShortfallResolution: false,
  };
}
