/**
 * שני שערי שמירה עצמאיים לקליטת תשלום:
 * A. התאמת אמצעי תשלום מתוכננים מול התשלום שהוקלד
 * B. טיפול בחריגת תשלום (overpayment)
 *
 * פתרון A אינו מאשר את B, ופתרון B אינו מסתיר את A.
 */

import {
  classifyMethodIntakeGate,
  type MethodIntakeGate,
} from "@/lib/cash-control-intake-breakdown";
import type { EnteredBucketUsd } from "@/lib/payment-breakdown-shared";
import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";
import { computePaymentOverpayment } from "@/lib/payment-overpayment";

export type IntakeSurplusDisposition = "credit" | "commission";

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
  return {
    methodCheck: { ok: methodOk, kind: methodGate.kind },
    overpaymentCheck: {
      ok: overpaymentOk,
      detected: overpay.hasOverpayment,
      overpaymentUsd: overpay.overpaymentUsd,
    },
    saveAllowed: methodOk && overpaymentOk,
  };
}

/** חלון תשלום יתר נפתח רק אחרי שערי אמצעי עברו. */
export function canProceedToOverpaymentResolution(gates: PaymentIntakeSaveGates): boolean {
  return gates.methodCheck.ok && gates.overpaymentCheck.detected;
}
