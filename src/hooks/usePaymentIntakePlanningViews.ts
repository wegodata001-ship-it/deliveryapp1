"use client";

import { useMemo } from "react";
import {
  derivePaymentIntakePlanningViews,
  type PaymentIntakePlanningViews,
} from "@/lib/payment-intake-planning-views";
import type { LivePaymentFormKpis } from "@/lib/payment-intake-live-kpi";
import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";
import type { CustomerCollectibleReconciliation } from "@/lib/customer-collectible-reconciliation";

/**
 * Shared planning views for intake UI — main screen + planned-methods modal.
 * Both consumers must use this (or the same parent memo) so rows stay in sync.
 */
export function usePaymentIntakePlanningViews(
  orders: PaymentIntakeOrderRow[],
  includedOrderIds: string[] | null,
  liveFormKpis: LivePaymentFormKpis,
  totalPaymentUsd: number,
  collectibleReconciliation: CustomerCollectibleReconciliation | null = null,
): PaymentIntakePlanningViews {
  return useMemo(
    () =>
      derivePaymentIntakePlanningViews(
        orders,
        includedOrderIds,
        liveFormKpis,
        totalPaymentUsd,
        collectibleReconciliation,
      ),
    [orders, includedOrderIds, liveFormKpis, totalPaymentUsd, collectibleReconciliation],
  );
}
