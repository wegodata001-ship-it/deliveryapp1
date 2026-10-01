/**
 * שני שערי שמירה עצמאיים לקליטת תשלום:
 * A. התאמת אמצעי תשלום מתוכננים מול התשלום שהוקלד
 * B. טיפול בחריגת תשלום (overpayment)
 *
 * פתרון A אינו מאשר את B, ופתרון B אינו מסתיר את A.
 */

import {
  buildOpenMethodPlan,
  classifyMethodIntakeGate,
  type MethodIntakeGate,
} from "@/lib/cash-control-intake-breakdown";
import {
  enteredUsdAppliedToOpenDebt,
  type EnteredBucketUsd,
} from "@/lib/payment-breakdown-shared";
import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";
import { computePaymentOverpayment } from "@/lib/payment-overpayment";

export type IntakeSurplusDisposition = "credit" | "commission";

export type PaymentIntakeFailureReason =
  | "METHOD_RECONCILIATION_FAILED"
  | "OVERPAYMENT_DESTINATION_MISSING"
  | null;

export type PaymentIntakeSaveGates = {
  methodCheck: {
    ok: boolean;
    kind: MethodIntakeGate["kind"];
  };
  overpaymentCheck: {
    ok: boolean;
    detected: boolean;
    overpaymentUsd: number;
  };
  saveAllowed: boolean;
  reason: PaymentIntakeFailureReason;
};

export function evaluatePaymentIntakeSaveGates(params: {
  orders: PaymentIntakeOrderRow[];
  includedOrderIds: string[] | null;
  enteredByBucket: EnteredBucketUsd[];
  totalPaymentUsd: number;
  openDebtUsd: number;
  surplusDisposition?: IntakeSurplusDisposition | null;
}): PaymentIntakeSaveGates {
  const methodGate = classifyMethodIntakeGate({
    orders: params.orders,
    includedOrderIds: params.includedOrderIds,
    enteredByBucket: params.enteredByBucket,
    totalPaymentUsd: params.totalPaymentUsd,
  });
  const methodOk = methodGate.kind === "ALLOW" || methodGate.kind === "SURPLUS_AFTER_CLOSURE";
  const overpay = computePaymentOverpayment(params.openDebtUsd, params.totalPaymentUsd);
  const disposition = params.surplusDisposition ?? null;
  const overpaymentResolved =
    disposition === "credit" || disposition === "commission";
  const overpaymentOk = !overpay.hasOverpayment || overpaymentResolved;
  const reason: PaymentIntakeFailureReason = !methodOk
    ? "METHOD_RECONCILIATION_FAILED"
    : overpay.hasOverpayment && !overpaymentResolved
      ? "OVERPAYMENT_DESTINATION_MISSING"
      : null;
  return {
    methodCheck: { ok: methodOk, kind: methodGate.kind },
    overpaymentCheck: {
      ok: overpaymentOk,
      detected: overpay.hasOverpayment,
      overpaymentUsd: overpay.overpaymentUsd,
    },
    saveAllowed: methodOk && overpaymentOk,
    reason,
  };
}

/** חלון תשלום יתר נפתח רק אחרי שערי אמצעי עברו. */
export function canProceedToOverpaymentResolution(gates: PaymentIntakeSaveGates): boolean {
  return gates.methodCheck.ok && gates.overpaymentCheck.detected;
}

/** Debug — השוואת אמצעי חוב בלבד מול יתרות מתוכננות פתוחות. */
export function describePostAdjustmentValidation(params: {
  orders: PaymentIntakeOrderRow[];
  includedOrderIds: string[] | null;
  enteredByBucket: EnteredBucketUsd[];
  totalPaymentUsd: number;
  openDebtUsd: number;
}) {
  const overpay = computePaymentOverpayment(params.openDebtUsd, params.totalPaymentUsd);
  const enteredForDebt = enteredUsdAppliedToOpenDebt(
    params.enteredByBucket,
    overpay.debtToCloseUsd,
  );
  const openPlan = buildOpenMethodPlan(params.orders, params.includedOrderIds);
  return {
    paymentTotalUsd: overpay.paymentTotalUsd,
    weekScopedDebtUsd: overpay.openDebtUsd,
    debtToCloseUsd: overpay.debtToCloseUsd,
    overpaymentUsd: overpay.overpaymentUsd,
    remainingDebtUsd: overpay.remainingDebtUsd,
    eligibleOrderIds: params.orders.map((order) => order.id),
    plannedOpenAfter: Object.fromEntries(openPlan.map((row) => [row.bucket, row.remainingUsd])),
    enteredDebtPortion: Object.fromEntries(enteredForDebt.map((row) => [row.bucket, row.enteredUsd])),
    validatorExpected: overpay.debtToCloseUsd,
    validatorActual: openPlan.reduce((sum, row) => sum + row.remainingUsd, 0),
  };
}
