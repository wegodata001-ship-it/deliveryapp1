import { prisma } from "@/lib/prisma";
import {
  scanPaymentCancellationIntegrity,
  type PaymentIntegrityAnomaly,
} from "@/lib/payment-cancellation-integrity";

export async function loadPaymentCancellationIntegritySnapshot() {
  const [payments, fees, allocations] = await Promise.all([
    prisma.payment.findMany({
      select: {
        id: true,
        customerId: true,
        paymentNumber: true,
        paymentCode: true,
        businessType: true,
        status: true,
      },
    }),
    prisma.paymentAdjustmentFee.findMany({
      select: {
        id: true,
        customerId: true,
        paymentId: true,
        paymentCaptureCode: true,
        status: true,
        amountUsd: true,
      },
    }),
    prisma.paymentMethodAllocation.findMany({
      select: { id: true, paymentId: true },
    }),
  ]);

  return {
    payments: payments
      .filter((p) => p.customerId)
      .map((p) => ({
        id: p.id,
        customerId: p.customerId!,
        paymentNumber: p.paymentNumber,
        paymentCode: p.paymentCode,
        businessType: p.businessType,
        status: p.status,
      })),
    fees: fees.map((f) => ({
      id: f.id,
      customerId: f.customerId,
      paymentId: f.paymentId,
      paymentCaptureCode: f.paymentCaptureCode,
      status: f.status,
      amountUsd: Number(f.amountUsd ?? 0),
    })),
    allocations,
  };
}

export async function scanLivePaymentCancellationIntegrity(): Promise<{
  anomalies: PaymentIntegrityAnomaly[];
  paymentCount: number;
  feeCount: number;
}> {
  const snapshot = await loadPaymentCancellationIntegritySnapshot();
  return {
    anomalies: scanPaymentCancellationIntegrity(snapshot),
    paymentCount: snapshot.payments.length,
    feeCount: snapshot.fees.length,
  };
}
