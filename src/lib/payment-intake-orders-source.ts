/**
 * Soft-refresh of the shared payment-intake orders source (and open-debt balances).
 * Used after order edit / manual refresh so the main table and planned-methods
 * modal stay on the same `orders` snapshot — without remounting the intake form.
 */

import {
  fetchPaymentIntakeBalancesClient,
  fetchPaymentIntakeOrdersClient,
} from "@/lib/payment-intake-client";
import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";

export type SoftRefreshPaymentIntakeOrdersResult =
  | {
      ok: true;
      orders: PaymentIntakeOrderRow[];
      customerBalanceUsd: string;
      openDebtSignedUsd: number;
      internalSignedUsd: string;
    }
  | { ok: false; error: string };

/**
 * One network refresh for the shared orders entity.
 * Caller applies `orders` (+ balances) to the single React source of truth.
 */
export async function softRefreshPaymentIntakeOrders(params: {
  customerId: string;
  weekCode: string | null;
  workCountry: string;
}): Promise<SoftRefreshPaymentIntakeOrdersResult> {
  const cid = params.customerId.trim();
  if (!cid) return { ok: false, error: "חסר לקוח" };

  const [ordersRes, balancesRes] = await Promise.all([
    fetchPaymentIntakeOrdersClient(cid, params.weekCode, params.workCountry),
    fetchPaymentIntakeBalancesClient(cid, params.workCountry),
  ]);

  if (!ordersRes.ok) return { ok: false, error: ordersRes.error };
  if (!balancesRes.ok) {
    return {
      ok: true,
      orders: ordersRes.orders,
      customerBalanceUsd: "0",
      openDebtSignedUsd: 0,
      internalSignedUsd: "0",
    };
  }

  return {
    ok: true,
    orders: ordersRes.orders,
    customerBalanceUsd: balancesRes.customerBalanceUsd,
    openDebtSignedUsd: balancesRes.openDebtSignedUsd,
    internalSignedUsd: balancesRes.internalSignedUsd,
  };
}
