/**
 * payment-intake-order-analysis.ts
 *
 * Single Source of Truth for payment intake display views.
 *
 * SYNC GUARANTEE
 * ──────────────
 * Main intake table (order remaining):
 *   allocatePaymentAcrossOrders → formAllocationUsd / formRemainingUsd per order.
 *
 * PMC grid + KPI cards ("סכום מתוכנן / שנקלט / נותר"):
 *   Method rows attribute live payment-line totals by bucket into planned
 *   method capacities. KPI cards sum the exact same rows the table renders
 *   (after filters) — no parallel summary / cache.
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
import type { LivePaymentFormKpis } from "@/lib/payment-intake-live-kpi";
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
 * Column labels:
 *   plannedUsd       → "סכום מתוכנן"         (open capacity for this method)
 *   formEnteredUsd   → "סכום שנקלט"          (typed payment-line amount for this bucket)
 *   formRemainingUsd → "נותר לאמצעי התשלום"   (plannedUsd − formEnteredUsd)
 *
 * KPI cards must be summarizeIntakeMethodViews(visibleRows) — same list as the table.
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
 * Order-level remaining (main intake table):
 *   Uses allocatePaymentAcrossOrders — identical to matchPaymentToOrders.
 *   order.formRemainingUsd ≡ main-table remainingAmount.
 *
 * Method-level display (PMC grid + KPI cards):
 *   "סכום שנקלט" is attributed from the live payment lines by method bucket
 *   (same totals as PaymentLiveSummaryCards / methodControlRows), filled into
 *   each order×method row in FIFO order up to that method's open capacity.
 *   KPI cards MUST sum the exact same rows the table renders.
 *
 * Step 1 — effectiveCap per method:
 *   Distribute order-level dbRemainingUsd across methods in plan order.
 *   → effectiveCap always ≤ dbRem; sum(caps) === dbRem.
 *
 * Step 2 — attribute typed payments by bucket into method rows (display only).
 */
export function buildIntakeOrderViews(
  orders: PaymentIntakeOrderRow[],
  includedOrderIds: string[] | null,
  liveFormKpis: LivePaymentFormKpis,
  totalFormUsd: number,
): IntakeOrderView[] {
  const idSet = includedOrderIds ? new Set(includedOrderIds) : null;

  // ── Order-level FIFO (identical to matchPaymentToOrders) ─────────────────
  const bases = toPaymentIntakeBases(orders);
  const { byOrderId } = allocatePaymentAcrossOrders(bases, totalFormUsd, idSet);

  // Live payment-line totals by bucket — same source as the form KPIs.
  const bucketPool = new Map<PaymentBucketKey, number>([
    ["CASH", roundMoney2(liveFormKpis.cash.totalUsd)],
    ["BANK_TRANSFER", roundMoney2(liveFormKpis.bankTransfer.totalUsd)],
    ["CREDIT", roundMoney2(liveFormKpis.credit.totalUsd)],
    ["CHECK", roundMoney2(liveFormKpis.checks.totalUsd)],
    ["OTHER", roundMoney2(liveFormKpis.other.totalUsd)],
  ]);

  type MethodDraft = {
    bucket: PaymentBucketKey;
    methodLabel: string;
    plannedUsd: number;
    dbPaidUsd: number;
    cap: number;
    dateYmd: string;
    formEnteredUsd: number;
  };

  type OrderDraft = {
    order: PaymentIntakeOrderRow;
    dbRem: number;
    formAlloc: number;
    formRem: number;
    methods: MethodDraft[];
  };

  const drafts: OrderDraft[] = orders.map((o) => {
    const dbRem = roundMoney2(Math.max(0, Number(o.dbRemainingUsd)));
    const formAlloc = roundMoney2(byOrderId.get(o.id) ?? 0);
    const formRem = roundMoney2(dbRem - formAlloc);
    // Filter by b.remainingUsd: methods already paid in full (remainingUsd ≈ 0) must
    // be excluded from the display pool. Using b.plannedUsd here would assign the entire
    // dbRem cap to the first planned method even when that method is already fully paid
    // (e.g. CASH after a COMPOSITE partial payment), leaving CREDIT with cap=0 and making
    // the "סכום שנקלט" KPI card show $0.00 even when the user has typed the correct amount.
    const filteredBreakdown = o.breakdown.filter((b) => b.remainingUsd > CASH_CONTROL_EPS);

    let dbCapPool = dbRem;
    const methods: MethodDraft[] = filteredBreakdown.map((b) => {
      // Cap = min(b.remainingUsd, available pool).
      // This correctly limits each method to what is actually still owed for that method.
      const cap = roundMoney2(Math.min(roundMoney2(b.remainingUsd), Math.max(0, dbCapPool)));
      dbCapPool = roundMoney2(Math.max(0, dbCapPool - cap));
      const bucket = paymentMethodBucketKey(b.method);
      return {
        bucket,
        methodLabel: PAYMENT_BUCKET_LABELS[bucket],
        // לתצוגה/KPI: "מתוכנן" = יתרה פתוחה לאמצעי (לא הסכום ההיסטורי המקורי)
        plannedUsd: cap,
        dbPaidUsd: roundMoney2(b.paidUsd),
        cap,
        dateYmd: o.dateYmd || "—",
        formEnteredUsd: 0,
      };
    });

    return { order: o, dbRem, formAlloc, formRem, methods };
  });

  // Attribute typed payment-line amounts into method rows (oldest → newest).
  for (const draft of drafts) {
    if (idSet && !idSet.has(draft.order.id)) continue;
    if (draft.dbRem <= CASH_CONTROL_EPS) continue;
    for (const method of draft.methods) {
      const available = bucketPool.get(method.bucket) ?? 0;
      if (available <= CASH_CONTROL_EPS || method.cap <= CASH_CONTROL_EPS) continue;
      const take = roundMoney2(Math.min(method.cap, available));
      method.formEnteredUsd = take;
      bucketPool.set(method.bucket, roundMoney2(Math.max(0, available - take)));
    }
  }

  return drafts.map((draft) => {
    const o = draft.order;
    const methodViews: IntakeMethodView[] = draft.methods.map((m) => {
      const formMethodRem = roundMoney2(Math.max(0, m.cap - m.formEnteredUsd));
      return {
        id: `${o.id}:${m.bucket}`,
        orderId: o.id,
        orderNumber: o.orderNumber?.trim() || o.id.slice(0, 8),
        bucket: m.bucket,
        methodLabel: m.methodLabel,
        plannedUsd: m.plannedUsd,
        dbPaidUsd: m.dbPaidUsd,
        dbRemainingUsd: m.cap,
        formEnteredUsd: m.formEnteredUsd,
        formRemainingUsd: formMethodRem,
        status: deriveMethodStatus(m.cap, m.formEnteredUsd, formMethodRem),
        dateYmd: m.dateYmd,
      };
    });

    return {
      orderId: o.id,
      orderNumber: o.orderNumber,
      dateYmd: o.dateYmd,
      week: o.week,
      totalAmountUsd: roundMoney2(Number(o.totalAmountUsd)),
      dbPaidUsd: roundMoney2(Number(o.dbPaidUsd)),
      dbRemainingUsd: draft.dbRem,
      formAllocationUsd: draft.formAlloc,
      formRemainingUsd: draft.formRem,
      orderStatus: deriveOrderStatus(draft.dbRem, draft.formAlloc, draft.formRem),
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

  // עודף: כל סכום משורות התשלום שלא יוחס לאמצעי מתוכנן בטבלה.
  // כך סכום KPI "סכום שנקלט" (כולל שורת עודף) ≡ סה״כ שורות התשלום בטופס.
  const attributedUsd = roundMoney2(rows.reduce((s, r) => s + r.formEnteredUsd, 0));
  const excessUsd = roundMoney2(Math.max(0, totalFormUsd - attributedUsd));
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
