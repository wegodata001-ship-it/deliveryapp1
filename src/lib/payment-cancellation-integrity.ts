/**
 * סריקת שלמות: תשלום מבוטל לא משאיר השפעה פעילה,
 * ותנועה יתומה לא נשארת בלי Payment תקין.
 */
import {
  creditBelongsToCapture,
  feeBelongsToCapture,
  isActiveFinancialStatus,
  type CancellationAllocationRow,
  type CancellationFeeRow,
  type CancellationPaymentRow,
} from "@/lib/payment-cancellation-effects";

export type PaymentIntegrityAnomalyKind =
  | "CANCELLED_PAYMENT_ACTIVE_FEE"
  | "CANCELLED_PAYMENT_ACTIVE_CREDIT"
  | "CANCELLED_PAYMENT_ACTIVE_SIBLING"
  | "ACTIVE_PAYMENT_CANCELLED_CHILD_FEE"
  | "ORPHAN_FEE_MISSING_PAYMENT"
  | "ORPHAN_ALLOCATION_MISSING_PAYMENT"
  | "ORPHAN_CREDIT_MISSING_CAPTURE";

export type PaymentIntegrityAnomaly = {
  kind: PaymentIntegrityAnomalyKind;
  customerId: string;
  paymentId: string | null;
  paymentCode: string | null;
  childId: string;
  detail: string;
};

export type PaymentIntegritySnapshot = {
  payments: CancellationPaymentRow[];
  fees: CancellationFeeRow[];
  allocations: CancellationAllocationRow[];
};

function captureOf(row: CancellationPaymentRow, siblings: CancellationPaymentRow[]) {
  return {
    paymentIds: siblings.map((p) => p.id),
    paymentNumber: row.paymentNumber,
    paymentCaptureCode:
      row.paymentCode?.trim() ||
      siblings.find((p) => p.paymentCode?.trim())?.paymentCode?.trim() ||
      null,
  };
}

function siblingsOf(
  row: CancellationPaymentRow,
  all: CancellationPaymentRow[],
): CancellationPaymentRow[] {
  return all.filter((p) => {
    if (p.customerId !== row.customerId) return false;
    if (row.paymentNumber != null && p.paymentNumber === row.paymentNumber) return true;
    return p.id === row.id;
  });
}

export function scanPaymentCancellationIntegrity(
  snapshot: PaymentIntegritySnapshot,
): PaymentIntegrityAnomaly[] {
  const anomalies: PaymentIntegrityAnomaly[] = [];
  const paymentById = new Map(snapshot.payments.map((p) => [p.id, p]));
  const seen = new Set<string>();

  const push = (row: PaymentIntegrityAnomaly) => {
    const key = `${row.kind}:${row.paymentId ?? ""}:${row.childId}`;
    if (seen.has(key)) return;
    seen.add(key);
    anomalies.push(row);
  };

  for (const payment of snapshot.payments) {
    const isCaptureRow =
      payment.businessType !== "CUSTOMER_CREDIT" && payment.businessType !== "CREDIT_APPLICATION";
    if (!isActiveFinancialStatus(payment.status) && isCaptureRow) {
      const siblings = siblingsOf(payment, snapshot.payments);
      const capture = captureOf(payment, siblings);

      for (const fee of snapshot.fees) {
        if (fee.customerId !== payment.customerId) continue;
        if (!feeBelongsToCapture(fee, capture)) continue;
        if (isActiveFinancialStatus(fee.status)) {
          push({
            kind: "CANCELLED_PAYMENT_ACTIVE_FEE",
            customerId: payment.customerId,
            paymentId: payment.id,
            paymentCode: payment.paymentCode,
            childId: fee.id,
            detail: "Payment CANCELLED but linked PaymentAdjustmentFee is still active",
          });
        }
      }

      for (const sibling of siblings) {
        if (sibling.id === payment.id) continue;
        if (!isActiveFinancialStatus(sibling.status)) continue;
        if (sibling.businessType === "CUSTOMER_CREDIT") {
          push({
            kind: "CANCELLED_PAYMENT_ACTIVE_CREDIT",
            customerId: payment.customerId,
            paymentId: payment.id,
            paymentCode: payment.paymentCode,
            childId: sibling.id,
            detail: "Payment CANCELLED but linked CUSTOMER_CREDIT is still ACTIVE",
          });
        } else if (sibling.businessType !== "CREDIT_APPLICATION") {
          push({
            kind: "CANCELLED_PAYMENT_ACTIVE_SIBLING",
            customerId: payment.customerId,
            paymentId: payment.id,
            paymentCode: payment.paymentCode,
            childId: sibling.id,
            detail: "Payment CANCELLED but a sibling capture row is still ACTIVE",
          });
        }
      }
    } else if (isActiveFinancialStatus(payment.status) && isCaptureRow) {
      const siblings = siblingsOf(payment, snapshot.payments);
      const capture = captureOf(payment, siblings);
      for (const fee of snapshot.fees) {
        if (fee.customerId !== payment.customerId) continue;
        if (!feeBelongsToCapture(fee, capture)) continue;
        if (!isActiveFinancialStatus(fee.status)) {
          push({
            kind: "ACTIVE_PAYMENT_CANCELLED_CHILD_FEE",
            customerId: payment.customerId,
            paymentId: payment.id,
            paymentCode: payment.paymentCode,
            childId: fee.id,
            detail: "Payment ACTIVE but a payment-generated fee is CANCELLED",
          });
        }
      }
    }
  }

  for (const fee of snapshot.fees) {
    const hasLink = Boolean(fee.paymentId?.trim() || fee.paymentCaptureCode?.trim());
    if (!hasLink) continue;
    const payment = fee.paymentId ? paymentById.get(fee.paymentId) : undefined;
    const byCode = fee.paymentCaptureCode?.trim()
      ? snapshot.payments.some((p) => p.paymentCode?.trim() === fee.paymentCaptureCode?.trim())
      : false;
    if (fee.paymentId && !payment) {
      push({
        kind: "ORPHAN_FEE_MISSING_PAYMENT",
        customerId: fee.customerId,
        paymentId: fee.paymentId,
        paymentCode: fee.paymentCaptureCode,
        childId: fee.id,
        detail: "PaymentAdjustmentFee.paymentId does not point to an existing Payment",
      });
    } else if (!fee.paymentId && fee.paymentCaptureCode && !byCode) {
      push({
        kind: "ORPHAN_FEE_MISSING_PAYMENT",
        customerId: fee.customerId,
        paymentId: null,
        paymentCode: fee.paymentCaptureCode,
        childId: fee.id,
        detail: "PaymentAdjustmentFee.paymentCaptureCode has no matching Payment",
      });
    }
  }

  for (const alloc of snapshot.allocations) {
    if (!paymentById.has(alloc.paymentId)) {
      push({
        kind: "ORPHAN_ALLOCATION_MISSING_PAYMENT",
        customerId: "",
        paymentId: alloc.paymentId,
        paymentCode: null,
        childId: alloc.id,
        detail: "PaymentMethodAllocation.paymentId does not point to an existing Payment",
      });
    }
  }

  for (const credit of snapshot.payments) {
    if (credit.businessType !== "CUSTOMER_CREDIT") continue;
    if (!isActiveFinancialStatus(credit.status)) continue;
    if (credit.paymentNumber == null && !credit.paymentCode) {
      const anyStandard = snapshot.payments.some(
        (p) =>
          p.customerId === credit.customerId &&
          p.id !== credit.id &&
          p.businessType !== "CUSTOMER_CREDIT" &&
          creditBelongsToCapture(credit, {
            paymentIds: [p.id],
            paymentNumber: p.paymentNumber,
            paymentCaptureCode: p.paymentCode,
          }),
      );
      if (!anyStandard) {
        push({
          kind: "ORPHAN_CREDIT_MISSING_CAPTURE",
          customerId: credit.customerId,
          paymentId: credit.id,
          paymentCode: credit.paymentCode,
          childId: credit.id,
          detail: "ACTIVE CUSTOMER_CREDIT has no paymentNumber/paymentCode capture link",
        });
      }
    }
  }

  return anomalies;
}
