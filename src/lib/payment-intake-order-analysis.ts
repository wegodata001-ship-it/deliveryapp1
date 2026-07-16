/**
 * payment-intake-order-analysis.ts
 *
 * Single Source of Truth for payment intake display views.
 *
 * SYNC GUARANTEE
 * ──────────────
 * Both the main intake table and the PMC window must show consistent numbers
 * for the same order.  This is achieved by a single allocation strategy:
 *
 *   1. allocatePaymentAcrossOrders (order-level FIFO) → formAllocationUsd per order.
 *      ← This is the SAME engine that matchPaymentToOrders uses for the main table.
 *
 *   2. Distribute formAllocationUsd across the order's methods in plan order
 *      (fill method 1 first, then method 2, etc.).
 *      → sum(method.formRemainingUsd) === order.formRemainingUsd   ✓
 *
 * This eliminates the discrepancy that arose when the PMC used a separate
 * per-bucket FIFO (which could produce a different total than the order FIFO).
 *
 * Rules:
 *   - No DB / Prisma / API changes.
 *   - allocatePaymentAcrossOrders and payment-saving logic are UNCHANGED.
 *   - This module is display-only.
 */

import { CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";
import {
  allocatePaymentAcrossOrders,
  roundMoney2,
  toPaymentIntakeBases,
  type PaymentIntakeOrderRow,
} from "@/lib/payment-intake";
import {
  PAYMENT_BUCKET_LABELS,
  paymentMethodBucketKey,
  type PaymentBucketKey,
} from "@/lib/payment-breakdown-shared";

// ---------------------------------------------------------------------------
// Unified status vocabulary
// ---------------------------------------------------------------------------

/** Canonical view status used by ALL intake screens. */
export type PaymentViewStatus = "cleared" | "partial" | "pending" | "open" | "credit";

export const PAYMENT_VIEW_STATUS_META: Record<
  PaymentViewStatus,
  { label: string; tone: string }
> = {
  cleared: { label: "🟢 הושלם",      tone: "completed" },
  partial: { label: "🟡 חלקי",        tone: "partial"   },
  pending: { label: "🟠 ממתין",       tone: "pending"   },
  open:    { label: "🔴 פתוח",        tone: "open"      },
  credit:  { label: "🔵 זכות לקוח",   tone: "credit"    },
};

// ---------------------------------------------------------------------------
// View types
// ---------------------------------------------------------------------------

/**
 * Per-order × per-payment-method view.
 * Used by the "אמצעי תשלום מתוכננים" (PMC) screen.
 *
 * INVARIANT: sum(methodViews[].formRemainingUsd) === max(0, order.formRemainingUsd)
 * Both the main table and PMC always show consistent remaining numbers.
 *
 * Column labels:
 *   formEnteredUsd   → "סכום שנקלט"          (share of order allocation attributed to this method)
 *   formRemainingUsd → "נותר לאמצעי התשלום"   (remaining to settle for this method)
 */
export type IntakeMethodView = {
  /** Unique React key: `{orderId}:{bucket}` or `__excess` */
  id: string;
  orderId: string;
  /** Display order-number; "—" for the excess-payment row */
  orderNumber: string;
  bucket: PaymentBucketKey;
  methodLabel: string;
  /** USD planned by the payment plan for this order × method */
  plannedUsd: number;
  /** USD already saved in DB for this method */
  dbPaidUsd: number;
  /** DB remaining for this method (plannedUsd − dbPaidUsd) */
  dbRemainingUsd: number;
  /**
   * Share of the order's total form allocation attributed to this method.
   * Derived by filling methods in plan order until the allocation is exhausted.
   * Sum across all methods for an order === order.formAllocationUsd.
   */
  formEnteredUsd: number;
  /**
   * Remaining to settle for this method after applying the current form allocation.
   * Sum across all methods for an order === max(0, order.formRemainingUsd).
   * Column header: "נותר לאמצעי התשלום"
   */
  formRemainingUsd: number;
  status: PaymentViewStatus;
  dateYmd: string;
};

/**
 * Per-order view.
 * Used by the main payment intake screen.
 *
 * Column labels:
 *   formRemainingUsd → "יתרת חוב להזמנה"
 */
export type IntakeOrderView = {
  orderId: string;
  orderNumber: string | null;
  dateYmd: string;
  week: string | null;
  totalAmountUsd: number;
  /** USD already paid (from DB) */
  dbPaidUsd: number;
  /** Total remaining debt in DB (totalAmountUsd − dbPaidUsd) */
  dbRemainingUsd: number;
  /**
   * Amount from the current form that will be applied to this order.
   * Uses the identical allocatePaymentAcrossOrders engine as the main table.
   */
  formAllocationUsd: number;
  /**
   * Remaining debt after applying the current form payment.
   * Column header: "יתרת חוב להזמנה"
   * Negative = customer credit (overpayment).
   */
  formRemainingUsd: number;
  orderStatus: PaymentViewStatus;
  /** Method-level breakdown for the PMC screen */
  methodViews: IntakeMethodView[];
};

export type MethodViewSummary = {
  orderCount: number;
  plannedUsd: number;
  enteredUsd: number;
  remainingUsd: number;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * @param dbRemainingUsd  What DB says still needs to be collected for this method
 *                        (= b.remainingUsd = b.plannedUsd − b.paidUsd).
 *                        This is the "real" capacity — not the original plan.
 * @param formEnteredUsd  Share of the order's form allocation attributed to this method.
 * @param formRemainingUsd  max(0, dbRemainingUsd − formEnteredUsd)
 */
function deriveMethodStatus(
  dbRemainingUsd: number,
  formEnteredUsd: number,
  formRemainingUsd: number,
): PaymentViewStatus {
  if (dbRemainingUsd <= CASH_CONTROL_EPS) return "cleared";    // already paid in DB
  if (formRemainingUsd <= CASH_CONTROL_EPS) return "cleared";  // covered by form payment
  if (formEnteredUsd > CASH_CONTROL_EPS) return "partial";     // partially covered
  return "pending";                                             // nothing entered yet
}

function deriveOrderStatus(
  dbRemainingUsd: number,
  formAllocationUsd: number,
  formRemainingUsd: number,
): PaymentViewStatus {
  if (formRemainingUsd < -0.02) return "credit";
  if (formRemainingUsd <= 0.02) return "cleared";
  if (formAllocationUsd > CASH_CONTROL_EPS) return "partial";
  if (dbRemainingUsd > CASH_CONTROL_EPS) return "open";
  return "cleared";
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

/**
 * Build the full business model for all intake orders.
 *
 * Uses allocatePaymentAcrossOrders (unchanged) for order-level allocation,
 * then distributes that allocation across each order's planned methods.
 *
 * Result guarantees:
 *   • order.formRemainingUsd   ≡ main-table remainingAmount  (same engine)
 *   • sum(method.formRemainingUsd) ≡ max(0, order.formRemainingUsd)  (no gap)
 *
 * @param orders         Full list of intake orders for the customer.
 * @param includedOrderIds  Manual priority selection (null = all orders).
 * @param totalFormUsd   Total USD entered in the form (= totals.totalUsd in the parent).
 */
export function buildIntakeOrderViews(
  orders: PaymentIntakeOrderRow[],
  includedOrderIds: string[] | null,
  totalFormUsd: number,
): IntakeOrderView[] {
  const idSet = includedOrderIds ? new Set(includedOrderIds) : null;

  // ── Order-level FIFO (identical to matchPaymentToOrders) ─────────────────
  const bases = toPaymentIntakeBases(orders);
  const { byOrderId, unallocatedUsd: _unallocated } = allocatePaymentAcrossOrders(
    bases,
    totalFormUsd,
    idSet,
  );

  return orders.map((o) => {
    const dbRem = roundMoney2(Math.max(0, Number(o.dbRemainingUsd)));
    const formAlloc = roundMoney2(byOrderId.get(o.id) ?? 0);
    const formRem = roundMoney2(dbRem - formAlloc); // can be negative (credit)

    // ── Method-level: distribute dbRem then formAlloc across plan methods ───
    //
    // WHY TWO STEPS:
    // b.remainingUsd is unreliable — the API may not track per-method paidUsd,
    // so b.remainingUsd can equal b.plannedUsd even when the order has partial
    // payments recorded (e.g., order dbRemainingUsd=$1720 but b.remainingUsd=$2020).
    //
    // The ORDER-LEVEL dbRemainingUsd is always authoritative (same value the
    // main table shows as "יתרת חוב").  We derive method capacities from it
    // by filling methods in plan order — identical logic to formAlloc distribution.
    //
    // Invariant: sum(effectiveCap) = dbRem  (when sum(plannedUsd) >= dbRem)
    //            sum(formRemainingUsd) = max(0, formRem)  ← matches main table
    const filteredBreakdown = o.breakdown.filter((b) => b.plannedUsd > CASH_CONTROL_EPS);

    // Step 1: distribute order dbRem → effective capacity per method
    let dbCapPool = dbRem;
    const effectiveCaps = filteredBreakdown.map((b) => {
      const cap = roundMoney2(Math.min(roundMoney2(b.plannedUsd), Math.max(0, dbCapPool)));
      dbCapPool = roundMoney2(Math.max(0, dbCapPool - cap));
      return cap;
    });

    // Step 2: distribute formAlloc using those capacities
    let methodAllocPool = formAlloc;
    const methodViews: IntakeMethodView[] = filteredBreakdown.map((b, i) => {
        const bucket = paymentMethodBucketKey(b.method);
        const plannedUsd = roundMoney2(b.plannedUsd);    // original plan (display)
        const cap = effectiveCaps[i]!;                   // order-truth-based capacity
        const methodAlloc = roundMoney2(Math.min(cap, Math.max(0, methodAllocPool)));
        methodAllocPool = roundMoney2(Math.max(0, methodAllocPool - methodAlloc));
        const formMethodRem = roundMoney2(Math.max(0, cap - methodAlloc));
        return {
          id: `${o.id}:${bucket}`,
          orderId: o.id,
          orderNumber: o.orderNumber?.trim() || o.id.slice(0, 8),
          bucket,
          methodLabel: PAYMENT_BUCKET_LABELS[bucket],
          plannedUsd,
          dbPaidUsd: roundMoney2(b.paidUsd),
          dbRemainingUsd: cap,   // effective per-method remaining (derived from order-level truth)
          formEnteredUsd: methodAlloc,
          formRemainingUsd: formMethodRem,
          status: deriveMethodStatus(cap, methodAlloc, formMethodRem),
          dateYmd: o.dateYmd || "—",
        };
      });

    return {
      orderId: o.id,
      orderNumber: o.orderNumber,
      dateYmd: o.dateYmd,
      week: o.week,
      totalAmountUsd: roundMoney2(Number(o.totalAmountUsd)),
      dbPaidUsd: roundMoney2(Number(o.dbPaidUsd)),
      dbRemainingUsd: dbRem,
      formAllocationUsd: formAlloc,
      formRemainingUsd: formRem,
      orderStatus: deriveOrderStatus(dbRem, formAlloc, formRem),
      methodViews,
    };
  });
}

/**
 * Flat list of method views for the PMC grid.
 *
 * @param orderViews       ALL order views (needed for the excess-payment calculation).
 * @param totalFormUsd     Total entered in the form.
 * @param includedOrderIds Only these orders appear as rows (null = all with open debt + breakdown).
 *
 * Includes all order × method rows plus an optional "excess payment" row
 * when the total form payment exceeds all order debts.
 *
 * Sorted: orderNumber asc, methodLabel asc.
 */
export function buildIntakeMethodViews(
  orderViews: IntakeOrderView[],
  totalFormUsd: number,
  includedOrderIds: string[] | null,
): IntakeMethodView[] {
  const idSet = includedOrderIds ? new Set(includedOrderIds) : null;
  const relevant = orderViews.filter(
    (ov) =>
      ov.methodViews.length > 0 &&
      ov.dbRemainingUsd > CASH_CONTROL_EPS &&
      (!idSet || idSet.has(ov.orderId)),
  );
  const rows: IntakeMethodView[] = relevant.flatMap((ov) => ov.methodViews);

  // "Excess payment" row: form total > sum of ALL order debts (use all orderViews, not just relevant)
  const totalAllocated = roundMoney2(
    orderViews.reduce((s, ov) => s + ov.formAllocationUsd, 0),
  );
  const excessUsd = roundMoney2(Math.max(0, totalFormUsd - totalAllocated));
  if (excessUsd > CASH_CONTROL_EPS) {
    rows.push({
      id: "__excess",
      orderId: "",
      orderNumber: "—",
      bucket: "OTHER",
      methodLabel: "עודף תשלום",
      plannedUsd: 0,
      dbPaidUsd: 0,
      dbRemainingUsd: 0,
      formEnteredUsd: excessUsd,
      formRemainingUsd: 0,
      status: "credit",
      dateYmd: "—",
    });
  }

  return rows.sort((a, b) => {
    const on = a.orderNumber.localeCompare(b.orderNumber, "he");
    if (on !== 0) return on;
    return a.methodLabel.localeCompare(b.methodLabel, "he");
  });
}

/** Aggregate summary for the PMC summary cards. */
export function summarizeIntakeMethodViews(views: IntakeMethodView[]): MethodViewSummary {
  const orderIds = new Set(views.map((v) => v.orderId).filter(Boolean));
  let plannedUsd = 0;
  let enteredUsd = 0;
  let remainingUsd = 0;
  for (const v of views) {
    plannedUsd += v.plannedUsd;
    enteredUsd += v.formEnteredUsd;
    remainingUsd += v.formRemainingUsd;
  }
  return {
    orderCount: orderIds.size,
    plannedUsd: roundMoney2(plannedUsd),
    enteredUsd: roundMoney2(enteredUsd),
    remainingUsd: roundMoney2(remainingUsd),
  };
}
