import type { Prisma } from "@prisma/client";

export function linkedCommissionFeeWhere(params: {
  customerId: string;
  paymentIds: string[];
  paymentCaptureCode: string | null;
}): Prisma.PaymentAdjustmentFeeWhereInput {
  const or: Prisma.PaymentAdjustmentFeeWhereInput[] = [];
  if (params.paymentIds.length > 0) {
    or.push({ paymentId: { in: params.paymentIds } });
  }
  const code = params.paymentCaptureCode?.trim();
  if (code) or.push({ paymentCaptureCode: code });
  return {
    customerId: params.customerId,
    status: { not: "CANCELLED" },
    ...(or.length > 0 ? { OR: or } : { id: { in: [] } }),
  };
}

/** אחים של אותה קליטה — paymentNumber / paymentIds / paymentCode, בלי ניחוש לפי סכום. */
export function linkedCapturePaymentWhere(params: {
  customerId: string;
  paymentIds: string[];
  paymentNumber: number | null;
  paymentCaptureCode: string | null;
}): Prisma.PaymentWhereInput {
  const or: Prisma.PaymentWhereInput[] = [];
  if (params.paymentIds.length > 0) or.push({ id: { in: params.paymentIds } });
  if (params.paymentNumber != null) or.push({ paymentNumber: params.paymentNumber });
  const code = params.paymentCaptureCode?.trim();
  if (code) or.push({ paymentCode: code });
  return {
    customerId: params.customerId,
    ...(or.length > 0 ? { OR: or } : { id: { in: [] } }),
  };
}

export function linkedCreditPaymentWhere(params: {
  customerId: string;
  paymentIds: string[];
  paymentNumber: number | null;
  paymentCaptureCode: string | null;
}): Prisma.PaymentWhereInput {
  return {
    AND: [
      linkedCapturePaymentWhere(params),
      { businessType: "CUSTOMER_CREDIT", status: { not: "CANCELLED" } },
    ],
  };
}
