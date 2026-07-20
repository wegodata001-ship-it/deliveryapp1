/**
 * Maps legacy PaymentIntakeOrderRow → parity DTO (no UI impact).
 */

import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";
import type { LegacyParityOrder } from "@/lib/finance-data/parity/payment-intake-parity";

export function toLegacyParityOrders(rows: PaymentIntakeOrderRow[]): LegacyParityOrder[] {
  return rows.map((r) => {
    const totalUsd = Number(r.totalAmountUsd);
    const paidUsd = Number(r.dbPaidUsd);
    const openDebtUsd = Number(r.dbRemainingUsd);
    return {
      orderId: r.id,
      orderNumber: r.orderNumber,
      customerId: null,
      amountUsd: Number(r.amountUsd),
      commissionUsd: Number(r.commissionUsd),
      totalUsd: Number.isFinite(totalUsd) ? totalUsd : 0,
      paidUsd: Number.isFinite(paidUsd) ? paidUsd : 0,
      openDebtUsd: Number.isFinite(openDebtUsd) ? openDebtUsd : 0,
      status: r.status,
      methods: (r.breakdown ?? []).map((b) => {
        const currency = b.currency === "ILS" ? "ILS" : "USD";
        return {
          method: b.method,
          currency,
          planned: Number(b.planned ?? b.plannedUsd ?? 0),
          paid: Number(b.paid ?? b.paidUsd ?? 0),
          remaining: Number(b.remaining ?? b.remainingUsd ?? 0),
        };
      }),
    };
  });
}
