/**
 * הקשר שבוע — הזמנות vs תשלומים (intakeDate vs weekCode).
 */
import { prisma } from "@/lib/prisma";
import { activePaidPaymentWhere } from "@/lib/payment-record-status-shared";
import { cashControlFlowReceiptPaymentsWhere } from "@/lib/cash-control-flow-receipt-payments";
import { cashControlExcludeInternalPaymentsWhere } from "@/lib/cash-control-internal-payments";
import { mergeOrderWhere, mergePaymentWhere, type CountryScope } from "@/lib/country-data-scope";

export async function loadFlowWeekContext(
  weekCode: string,
  scope: CountryScope,
): Promise<{ paymentsReceivedInWeek: number; paymentsByWeekCodeOnly: number; ordersInOrderWeek: number }> {
  const wk = weekCode.trim();
  const [paymentsReceivedInWeek, paymentsByWeekCodeOnly, ordersInOrderWeek] = await Promise.all([
    prisma.payment.count({
      where: mergePaymentWhere(cashControlFlowReceiptPaymentsWhere(wk), scope),
    }),
    prisma.payment.count({
      where: mergePaymentWhere(
        {
          AND: [
            activePaidPaymentWhere,
            { weekCode: wk },
            cashControlExcludeInternalPaymentsWhere,
            { NOT: { businessType: "ADJUSTMENT_FEE" } },
          ],
        },
        scope,
      ),
    }),
    prisma.order.count({
      where: mergeOrderWhere({ weekCode: wk, deletedAt: null }, scope),
    }),
  ]);
  return { paymentsReceivedInWeek, paymentsByWeekCodeOnly, ordersInOrderWeek };
}
