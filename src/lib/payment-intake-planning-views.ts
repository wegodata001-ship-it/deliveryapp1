/**
 * Single source of truth for payment-intake *display views* derived from shared
 * `orders` + form KPIs.
 *
 * SYNC GUARANTEE
 * ──────────────
 * Order remaining (main table): allocatePaymentAcrossOrders — unchanged.
 * PMC rows + KPI cards: live payment-line totals by bucket → method rows;
 * cards sum the exact visible table rows.
 */

import {
  buildIntakeMethodViews,
  buildIntakeOrderViews,
  summarizeIntakeMethodViews,
  type IntakeMethodView,
  type IntakeOrderView,
  type MethodViewSummary,
} from "@/lib/payment-intake-order-analysis";
import {
  buildLivePaymentMethodControlRows,
  hasCompositeMethodControl,
  type LivePaymentMethodControlRow,
} from "@/lib/payment-intake-method-control";
import type { LivePaymentFormKpis } from "@/lib/payment-intake-live-kpi";
import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";
import { sumRemainingToPayUsd } from "@/lib/order-remaining-debt";
import type { CustomerCollectibleReconciliation } from "@/lib/customer-collectible-reconciliation";

export type PaymentIntakePlanningViews = {
  /** Aggregate bucket rows for the PMC button (unchanged logic) */
  methodControlRows: LivePaymentMethodControlRow[];
  /** Per-order × per-method rows for the PMC grid */
  methodViews: IntakeMethodView[];
  /** Summary for the PMC summary cards */
  methodViewSummary: MethodViewSummary;
  /** Σ יתרות הזמנה (תכנון) — לא סכום לגבייה */
  orderRemainingToPayUsd: number;
  /** יתרה מתוכננת פתוחה (PMC remaining) */
  plannedOpenRemainingUsd: number;
  /** יתרה נטו לגבייה — SSOT reconciliation */
  netCollectibleUsd: number;
  collectibleReconciliation: CustomerCollectibleReconciliation | null;
  /** Full order business model — consumed by the main intake table */
  orderViews: IntakeOrderView[];
  showMethodControl: boolean;
};

/**
 * Derive method-control button rows + PMC grid rows + order views from the same inputs.
 * Call once in the payment intake owner component; pass results to children.
 */
export function derivePaymentIntakePlanningViews(
  orders: PaymentIntakeOrderRow[],
  includedOrderIds: string[] | null,
  liveFormKpis: LivePaymentFormKpis,
  totalPaymentUsd: number,
  collectibleReconciliation: CustomerCollectibleReconciliation | null = null,
): PaymentIntakePlanningViews {
  // PMC button rows — unchanged logic (shows aggregate per bucket)
  const methodControlRows = buildLivePaymentMethodControlRows(
    orders,
    includedOrderIds,
    liveFormKpis,
    totalPaymentUsd,
  );

  // Unified engine: order views + method views derived from the same allocation
  const orderViews = buildIntakeOrderViews(orders, includedOrderIds, liveFormKpis, totalPaymentUsd);
  const methodViews = buildIntakeMethodViews(orderViews, totalPaymentUsd, includedOrderIds);
  const orderRemainingToPayUsd = sumRemainingToPayUsd(orderViews);
  const summary = summarizeIntakeMethodViews(methodViews);
  const plannedOpenRemainingUsd = roundMoney2(summary.remainingUsd);

  return {
    methodControlRows,
    methodViews,
    methodViewSummary: summary,
    orderRemainingToPayUsd,
    plannedOpenRemainingUsd,
    netCollectibleUsd: collectibleReconciliation?.netCollectibleUsd ?? orderRemainingToPayUsd,
    collectibleReconciliation,
    orderViews,
    showMethodControl: hasCompositeMethodControl(orders, includedOrderIds),
  };
}

function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}
