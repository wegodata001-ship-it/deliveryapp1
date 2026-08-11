import { prisma } from "@/lib/prisma";
import { cashControlWeekReconciliationPaymentsWhere } from "@/lib/cash-control-week-payments";
import type { FxPurchaseTrack } from "@/app/admin/cash-flow/flow-types";
import {
  groupIntakePaymentsByBankTarget,
  type FxRemainderBankTarget,
  type PaymentLocationRow,
} from "@/lib/flow-control/fx-purchase/remainder-bank-resolution.shared";

const paymentSelect = {
  id: true,
  paymentPlace: true,
  ilsNote: true,
  notes: true,
  paymentMethod: true,
  ilsPaymentMethod: true,
  usdPaymentMethod: true,
  amountIls: true,
  amountUsd: true,
  methodAllocations: { select: { method: true, currency: true, sourceAmount: true } },
} as const;

async function loadPaymentLocations(): Promise<PaymentLocationRow[]> {
  try {
    return await prisma.$queryRaw<PaymentLocationRow[]>`
      SELECT "id", "name", "code"
      FROM "PaymentLocation"
      WHERE "isActive" = true
      ORDER BY "name" ASC
    `;
  } catch {
    return [];
  }
}

export async function resolveFxRemainderBankTargets(
  weekCode: string,
  track: FxPurchaseTrack,
): Promise<FxRemainderBankTarget[]> {
  const wk = weekCode.trim();
  const [payments, locations] = await Promise.all([
    prisma.payment.findMany({
      where: cashControlWeekReconciliationPaymentsWhere(wk),
      select: paymentSelect,
    }),
    loadPaymentLocations(),
  ]);
  return groupIntakePaymentsByBankTarget(payments, locations, track);
}
