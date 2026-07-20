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
  /** Unique React key: `{orderId}:{bucket}:{currency}` or `__excess` */
  id: string;
  orderId: string;
  /** Display order-number; "—" for the excess-payment row */
  orderNumber: string;
  bucket: PaymentBucketKey;
  methodLabel: string;
  /** מטבע מקורי של השורה — הפרדה מלאה מול המטבע השני */
  currency?: "USD" | "ILS";
  /** מתוכנן במטבע השורה */
  planned?: number;
  /** שולם במטבע השורה (DB) */
  paid?: number;
  /** נותר במטבע השורה (DB) */
  remaining?: number;
  plannedUsd: number;
  dbPaidUsd: number;
  dbRemainingUsd: number;
  formEnteredUsd: number;
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
  plannedIls: number;
  enteredIls: number;
  remainingIls: number;
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

  // Live payment-line totals by bucket × currency — אין המרת שקל↔דולר
  const bucketPoolUsd = new Map<PaymentBucketKey, number>([
    ["CASH", roundMoney2(liveFormKpis.cash.enteredUsd)],
    ["BANK_TRANSFER", roundMoney2(liveFormKpis.bankTransfer.enteredUsd)],
    ["CREDIT", roundMoney2(liveFormKpis.credit.enteredUsd)],
    ["CHECK", roundMoney2(liveFormKpis.checks.enteredUsd)],
    ["OTHER", roundMoney2(liveFormKpis.other.enteredUsd)],
  ]);
  const bucketPoolIls = new Map<PaymentBucketKey, number>([
    ["CASH", roundMoney2(liveFormKpis.cash.enteredIls)],
    ["BANK_TRANSFER", roundMoney2(liveFormKpis.bankTransfer.enteredIls)],
    ["CREDIT", roundMoney2(liveFormKpis.credit.enteredIls)],
    ["CHECK", roundMoney2(liveFormKpis.checks.enteredIls)],
    ["OTHER", roundMoney2(liveFormKpis.other.enteredIls)],
  ]);

  type MethodDraft = {
    bucket: PaymentBucketKey;
    methodLabel: string;
    currency: "USD" | "ILS";
    planned: number;
    paid: number;
    remaining: number;
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
    const allBreakdown = o.breakdown;

    const methods: MethodDraft[] = allBreakdown.map((b) => {
      const currency = b.currency ?? "USD";
      const remaining = roundMoney2(Math.max(0, b.remaining ?? b.remainingUsd));
      const planned = roundMoney2(Math.max(0, b.planned ?? b.plannedUsd));
      const paid = roundMoney2(Math.max(0, b.paid ?? b.paidUsd));
      const bucket = paymentMethodBucketKey(b.method);
      return {
        bucket,
        methodLabel: PAYMENT_BUCKET_LABELS[bucket],
        currency,
        planned,
        paid,
        remaining,
        plannedUsd: roundMoney2(b.plannedUsd),
        dbPaidUsd: roundMoney2(b.paidUsd),
        cap: remaining,
        dateYmd: o.dateYmd || "—",
        formEnteredUsd: 0,
      };
    });

    return { order: o, dbRem, formAlloc, formRem, methods };
  });

  // Attribute typed amounts — USD רק לשורות USD, ILS רק לשורות ILS
  for (const draft of drafts) {
    if (idSet && !idSet.has(draft.order.id)) continue;
    for (const method of draft.methods) {
      const pool = method.currency === "ILS" ? bucketPoolIls : bucketPoolUsd;
      const available = pool.get(method.bucket) ?? 0;
      if (available <= CASH_CONTROL_EPS || method.cap <= CASH_CONTROL_EPS) continue;
      const take = roundMoney2(Math.min(method.cap, available));
      method.formEnteredUsd = take;
      pool.set(method.bucket, roundMoney2(Math.max(0, available - take)));
    }
  }

  return drafts.map((draft) => {
    const o = draft.order;
    const methodViews: IntakeMethodView[] = draft.methods.map((m) => {
      const formMethodRem = roundMoney2(Math.max(0, m.cap - m.formEnteredUsd));
      return {
        id: `${o.id}:${m.currency}:${m.bucket}`,
        orderId: o.id,
        orderNumber: o.orderNumber?.trim() || o.id.slice(0, 8),
        bucket: m.bucket,
        methodLabel: m.methodLabel,
        currency: m.currency,
        planned: m.planned,
        paid: m.paid,
        remaining: m.remaining,
        plannedUsd: m.plannedUsd,
        dbPaidUsd: m.dbPaidUsd,
        dbRemainingUsd: m.remaining,
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
    (ov) => ov.methodViews.length > 0 && (!idSet || idSet.has(ov.orderId)),
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
      currency: "USD",
      planned: 0,
      paid: 0,
      remaining: 0,
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
    const cur = (a.currency ?? "USD").localeCompare(b.currency ?? "USD");
    if (cur !== 0) return cur;
    return a.methodLabel.localeCompare(b.methodLabel, "he");
  });
}

/** Aggregate summary — USD ו-ILS בנפרד, בלי איחוד מטבעות */
export function summarizeIntakeMethodViews(views: IntakeMethodView[]): MethodViewSummary {
  const orderIds = new Set(views.map((v) => v.orderId).filter(Boolean));
  let plannedUsd = 0;
  let enteredUsd = 0;
  let remainingUsd = 0;
  let plannedIls = 0;
  let enteredIls = 0;
  let remainingIls = 0;
  for (const v of views) {
    const cur = v.currency ?? "USD";
    const planned = v.planned ?? v.plannedUsd;
    const paid = v.paid ?? v.dbPaidUsd;
    const rem = v.remaining ?? v.dbRemainingUsd;
    if (cur === "ILS") {
      plannedIls += planned;
      enteredIls += paid;
      remainingIls += rem;
    } else {
      plannedUsd += planned;
      enteredUsd += paid;
      remainingUsd += rem;
    }
  }
  return {
    orderCount: orderIds.size,
    plannedUsd: roundMoney2(plannedUsd),
    enteredUsd: roundMoney2(enteredUsd),
    remainingUsd: roundMoney2(remainingUsd),
    plannedIls: roundMoney2(plannedIls),
    enteredIls: roundMoney2(enteredIls),
    remainingIls: roundMoney2(remainingIls),
  };
}
