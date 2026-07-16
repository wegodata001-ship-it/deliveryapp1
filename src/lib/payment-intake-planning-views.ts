/**
 * Single source of truth for payment-intake *display views* derived from shared
 * `orders` + form KPIs.
 *
 * SYNC GUARANTEE
 * ──────────────
 * buildIntakeOrderViews uses the identical allocatePaymentAcrossOrders engine
 * that the main table's matchPaymentToOrders uses.  Therefore:
 *
 *   order.formRemainingUsd  ≡  main-table remainingAmount        (same engine)
 *   sum(method.formRemainingUsd) ≡ order.formRemainingUsd        (by construction)
 *
 * Both screens always show the same remaining figure for the same order.
 *
 * Business formulas are unchanged — this module only centralizes call sites.
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

export type PaymentIntakePlanningViews = {
  /** Aggregate bucket rows for the PMC button (unchanged logic) */
  methodControlRows: LivePaymentMethodControlRow[];
  /** Per-order × per-method rows for the PMC grid */
  methodViews: IntakeMethodView[];
  /** Summary for the PMC summary cards */
  methodViewSummary: MethodViewSummary;
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
): PaymentIntakePlanningViews {
  // PMC button rows — unchanged logic (shows aggregate per bucket)
  const methodControlRows = buildLivePaymentMethodControlRows(
    orders,
    includedOrderIds,
    liveFormKpis,
    totalPaymentUsd,
  );

  // Unified engine: order views + method views derived from the same allocation
  const orderViews = buildIntakeOrderViews(orders, includedOrderIds, totalPaymentUsd);
  const methodViews = buildIntakeMethodViews(orderViews, totalPaymentUsd, includedOrderIds);

  return {
    methodControlRows,
    methodViews,
    methodViewSummary: summarizeIntakeMethodViews(methodViews),
    orderViews,
    showMethodControl: hasCompositeMethodControl(orders, includedOrderIds),
  };
}
