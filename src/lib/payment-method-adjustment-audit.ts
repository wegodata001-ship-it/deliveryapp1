import type { PaymentMethodAdjustmentReasonCode } from "@/lib/payment-method-auto-adjustment";

export const PAYMENT_METHOD_AUTO_ADJUSTED_ACTION = "PAYMENT_METHOD_AUTO_ADJUSTED" as const;
export const ORDER_PAYMENT_METHOD_ADJUSTED_ACTION = "ORDER_PAYMENT_METHOD_ADJUSTED" as const;

export type PaymentMethodAutoAdjustedAuditMetadata = {
  adjustmentId: string;
  customerId: string;
  customerName: string;
  customerCode: string | null;
  employeeId: string;
  employeeName: string;
  createdAtIso: string;
  fromPaymentMethod: string;
  toPaymentMethod: string;
  amountUsd: string;
  reasonCode: PaymentMethodAdjustmentReasonCode;
  reasonText: string;
  affectedOrders: Array<{
    orderId: string;
    orderNumber: string;
    movedUsd: string;
    beforeAllocation: Array<{ paymentMethod: string; amount: string; currency: string }>;
    afterAllocation: Array<{ paymentMethod: string; amount: string; currency: string }>;
  }>;
  reviewedAtIso?: string | null;
  reviewedByUserId?: string | null;
  reviewedByName?: string | null;
};

export type OrderPaymentMethodAdjustedAuditMetadata = {
  adjustmentId: string;
  orderId: string;
  orderNumber: string;
  fromPaymentMethod: string;
  toPaymentMethod: string;
  movedUsd: string;
  reasonCode: PaymentMethodAdjustmentReasonCode;
  reasonText: string;
  employeeId: string;
  employeeName: string;
  beforeAllocation: Array<{ paymentMethod: string; amount: string; currency: string }>;
  afterAllocation: Array<{ paymentMethod: string; amount: string; currency: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function asLines(value: unknown): Array<{ paymentMethod: string; amount: string; currency: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (!isRecord(row)) return null;
      const paymentMethod = asString(row.paymentMethod);
      const amount = asString(row.amount);
      const currency = asString(row.currency);
      if (!paymentMethod || !amount || !currency) return null;
      return { paymentMethod, amount, currency };
    })
    .filter((row): row is { paymentMethod: string; amount: string; currency: string } => Boolean(row));
}

export function parsePaymentMethodAutoAdjustedAuditMetadata(
  raw: unknown,
): PaymentMethodAutoAdjustedAuditMetadata | null {
  if (!isRecord(raw)) return null;
  const adjustmentId = asString(raw.adjustmentId);
  const customerId = asString(raw.customerId);
  const customerName = asString(raw.customerName);
  const employeeId = asString(raw.employeeId);
  const employeeName = asString(raw.employeeName);
  const createdAtIso = asString(raw.createdAtIso);
  const fromPaymentMethod = asString(raw.fromPaymentMethod);
  const toPaymentMethod = asString(raw.toPaymentMethod);
  const amountUsd = asString(raw.amountUsd);
  const reasonCode = asString(raw.reasonCode) as PaymentMethodAdjustmentReasonCode | null;
  const reasonText = asString(raw.reasonText);
  if (
    !adjustmentId ||
    !customerId ||
    !customerName ||
    !employeeId ||
    !employeeName ||
    !createdAtIso ||
    !fromPaymentMethod ||
    !toPaymentMethod ||
    !amountUsd ||
    !reasonCode ||
    !reasonText
  ) {
    return null;
  }
  const affectedOrders = Array.isArray(raw.affectedOrders)
    ? raw.affectedOrders
        .map((row) => {
          if (!isRecord(row)) return null;
          const orderId = asString(row.orderId);
          const orderNumber = asString(row.orderNumber);
          const movedUsd = asString(row.movedUsd);
          if (!orderId || !orderNumber || !movedUsd) return null;
          return {
            orderId,
            orderNumber,
            movedUsd,
            beforeAllocation: asLines(row.beforeAllocation),
            afterAllocation: asLines(row.afterAllocation),
          };
        })
        .filter((row): row is PaymentMethodAutoAdjustedAuditMetadata["affectedOrders"][number] => Boolean(row))
    : [];
  return {
    adjustmentId,
    customerId,
    customerName,
    customerCode: asString(raw.customerCode),
    employeeId,
    employeeName,
    createdAtIso,
    fromPaymentMethod,
    toPaymentMethod,
    amountUsd,
    reasonCode,
    reasonText,
    affectedOrders,
    reviewedAtIso: asString(raw.reviewedAtIso),
    reviewedByUserId: asString(raw.reviewedByUserId),
    reviewedByName: asString(raw.reviewedByName),
  };
}

export function parseOrderPaymentMethodAdjustedAuditMetadata(
  raw: unknown,
): OrderPaymentMethodAdjustedAuditMetadata | null {
  if (!isRecord(raw)) return null;
  const adjustmentId = asString(raw.adjustmentId);
  const orderId = asString(raw.orderId);
  const orderNumber = asString(raw.orderNumber);
  const fromPaymentMethod = asString(raw.fromPaymentMethod);
  const toPaymentMethod = asString(raw.toPaymentMethod);
  const movedUsd = asString(raw.movedUsd);
  const reasonCode = asString(raw.reasonCode) as PaymentMethodAdjustmentReasonCode | null;
  const reasonText = asString(raw.reasonText);
  const employeeId = asString(raw.employeeId);
  const employeeName = asString(raw.employeeName);
  if (
    !adjustmentId ||
    !orderId ||
    !orderNumber ||
    !fromPaymentMethod ||
    !toPaymentMethod ||
    !movedUsd ||
    !reasonCode ||
    !reasonText ||
    !employeeId ||
    !employeeName
  ) {
    return null;
  }
  return {
    adjustmentId,
    orderId,
    orderNumber,
    fromPaymentMethod,
    toPaymentMethod,
    movedUsd,
    reasonCode,
    reasonText,
    employeeId,
    employeeName,
    beforeAllocation: asLines(raw.beforeAllocation),
    afterAllocation: asLines(raw.afterAllocation),
  };
}
