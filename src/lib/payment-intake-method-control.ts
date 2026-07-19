/**
 * בקרת אמצעי תשלום בזמן קליטה — חישוב חי לפי ההקלדה הנוכחית בטופס בלבד (UX).
 */

import { buildIntakeBreakdownPlan } from "@/lib/cash-control-intake-breakdown";
import { CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";
import type { LivePaymentFormKpis } from "@/lib/payment-intake-live-kpi";
import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";
import {
  PAYMENT_BUCKET_LABELS,
  paymentMethodBucketKey,
  type PaymentBucketKey,
} from "@/lib/payment-breakdown-shared";

export type MethodControlRowStatus = "paid" | "remaining" | "excess" | "surplus" | "not-required";

export type LivePaymentMethodControlTarget = {
  orderId: string;
  orderNumber: string;
};

export type LivePaymentMethodControlRow = {
  bucket: PaymentBucketKey;
  label: string;
  plannedUsd: number;
  enteredUsd: number;
  remainingUsd: number;
  status: MethodControlRowStatus;
  statusLabel: string;
  excessUsd: number;
  /** הזמנות / יעד שהסכום המתוכנן מיועד אליהן */
  targetLabel: string;
  /** יעדי הזמנה ללחיצה (עריכה מתוך חלון הבקרה) */
  targets: LivePaymentMethodControlTarget[];
};

const DISPLAY_BUCKETS: PaymentBucketKey[] = ["CASH", "BANK_TRANSFER", "CREDIT", "CHECK"];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildBucketTargets(
  orders: PaymentIntakeOrderRow[],
  includedOrderIds: string[] | null,
): Map<PaymentBucketKey, LivePaymentMethodControlTarget[]> {
  const idSet = includedOrderIds ? new Set(includedOrderIds) : null;
  const byBucket = new Map<PaymentBucketKey, Map<string, LivePaymentMethodControlTarget>>();
  for (const o of orders) {
    if (idSet && !idSet.has(o.id)) continue;
    if (Number(o.dbRemainingUsd) <= CASH_CONTROL_EPS) continue;
    if (o.breakdown.length === 0) continue;
    const orderNumber = o.orderNumber?.trim() || o.id.slice(0, 8);
    for (const b of o.breakdown) {
      if (b.plannedUsd <= CASH_CONTROL_EPS) continue;
      const bucket = paymentMethodBucketKey(b.method);
      const map = byBucket.get(bucket) ?? new Map<string, LivePaymentMethodControlTarget>();
      if (!map.has(o.id)) map.set(o.id, { orderId: o.id, orderNumber });
      byBucket.set(bucket, map);
    }
  }
  const out = new Map<PaymentBucketKey, LivePaymentMethodControlTarget[]>();
  for (const [bucket, map] of byBucket) {
    out.set(bucket, [...map.values()]);
  }
  return out;
}

function formatTargetsLabel(targets: LivePaymentMethodControlTarget[]): string {
  const list = targets.map((t) => t.orderNumber);
  if (list.length === 0) return "";
  if (list.length <= 2) return list.join(", ");
  return `${list.slice(0, 2).join(", ")} +${list.length - 2}`;
}

function targetLabelForRow(
  bucket: PaymentBucketKey,
  plannedUsd: number,
  enteredUsd: number,
  targets: Map<PaymentBucketKey, LivePaymentMethodControlTarget[]>,
): string {
  const planned = targets.get(bucket);
  if (planned && planned.length > 0) return formatTargetsLabel(planned);
  if (plannedUsd > CASH_CONTROL_EPS) return "חוב פתוח";
  if (enteredUsd > CASH_CONTROL_EPS) return "טרם הוקצה";
  return "—";
}

function enteredForBucket(kpis: LivePaymentFormKpis, bucket: PaymentBucketKey): number {
  switch (bucket) {
    case "CASH":
      return kpis.cash.totalUsd;
    case "BANK_TRANSFER":
      return kpis.bankTransfer.totalUsd;
    case "CREDIT":
      return kpis.credit.totalUsd;
    case "CHECK":
      return kpis.checks.totalUsd;
    default:
      return kpis.other.totalUsd;
  }
}

/** סטטוס שורה — תצוגה חיה של חוק אמצעי התשלום שנאכף בצד השרת. */
function computeRowStatus(
  plannedUsd: number,
  enteredUsd: number,
  globalOverageUsd: number,
): Pick<LivePaymentMethodControlRow, "status" | "statusLabel" | "excessUsd"> {
  if (plannedUsd <= CASH_CONTROL_EPS && enteredUsd <= CASH_CONTROL_EPS) {
    return { status: "not-required", statusLabel: "לא נדרש", excessUsd: 0 };
  }
  if (enteredUsd > plannedUsd + CASH_CONTROL_EPS) {
    const excess = round2(enteredUsd - plannedUsd);
    if (globalOverageUsd > CASH_CONTROL_EPS) {
      return { status: "surplus", statusLabel: "עודף תשלום", excessUsd: excess };
    }
    return { status: "excess", statusLabel: "חריגה מהתכנון", excessUsd: excess };
  }
  const remaining = round2(plannedUsd - enteredUsd);
  if (remaining <= CASH_CONTROL_EPS) {
    return { status: "paid", statusLabel: "שולם", excessUsd: 0 };
  }
  return { status: "remaining", statusLabel: "נותר לפי התכנון", excessUsd: 0 };
}

export function hasCompositeMethodControl(
  orders: PaymentIntakeOrderRow[],
  includedOrderIds: string[] | null,
): boolean {
  return buildIntakeBreakdownPlan(orders, includedOrderIds).length > 0;
}

/** שורות בקרה חיות — תצוגת התכנון המחייב מול ההקלדה הנוכחית. */
export function buildLivePaymentMethodControlRows(
  orders: PaymentIntakeOrderRow[],
  includedOrderIds: string[] | null,
  kpis: LivePaymentFormKpis,
  totalPaymentUsd?: number,
): LivePaymentMethodControlRow[] {
  const plan = buildIntakeBreakdownPlan(orders, includedOrderIds);
  const plannedByBucket = new Map(plan.map((p) => [p.bucket, p.plannedUsd]));

  const idSet = includedOrderIds ? new Set(includedOrderIds) : null;
  let totalRemaining = 0;
  for (const o of orders) {
    if (idSet && !idSet.has(o.id)) continue;
    totalRemaining += Math.max(0, Number(o.dbRemainingUsd) || 0);
  }
  totalRemaining = round2(totalRemaining);
  const paymentTotal = round2(totalPaymentUsd ?? kpis.totalPaymentUsd ?? 0);
  const globalOverageUsd = round2(Math.max(0, paymentTotal - totalRemaining));
  let unexplainedOverageUsd = globalOverageUsd;

  // מגבילים את "נותר לפי אמצעי" לסכום היתרה הכוללת של המסמך (FIFO על הסדר)
  let remCapPool = totalRemaining;
  const effectiveRemaining = new Map<PaymentBucketKey, number>();
  for (const p of plan) {
    const capped = round2(Math.min(Math.max(0, p.remainingUsd), remCapPool));
    remCapPool = round2(Math.max(0, remCapPool - capped));
    effectiveRemaining.set(p.bucket, capped);
  }

  const buckets: PaymentBucketKey[] = [...DISPLAY_BUCKETS];
  const otherPlanned = plannedByBucket.get("OTHER") ?? 0;
  const otherEntered = enteredForBucket(kpis, "OTHER");
  if (otherPlanned > CASH_CONTROL_EPS || otherEntered > CASH_CONTROL_EPS) {
    buckets.push("OTHER");
  }

  const targets = buildBucketTargets(orders, includedOrderIds);

  return buckets.map((bucket) => {
    // לתצוגה: "מתוכנן" = מה שעדיין פתוח לפי אמצעי (מכוסה ביתרה הכוללת), לא הסכום המקורי
    const plannedUsd = round2(effectiveRemaining.get(bucket) ?? 0);
    const enteredUsd = round2(enteredForBucket(kpis, bucket));
    const remainingUsd = round2(plannedUsd - enteredUsd);
    let { status, statusLabel, excessUsd } = computeRowStatus(plannedUsd, enteredUsd, unexplainedOverageUsd);
    if (status === "surplus" && excessUsd > 0) {
      unexplainedOverageUsd = round2(Math.max(0, unexplainedOverageUsd - excessUsd));
    }
    return {
      bucket,
      label: PAYMENT_BUCKET_LABELS[bucket],
      plannedUsd,
      enteredUsd,
      remainingUsd,
      status,
      statusLabel,
      excessUsd,
      targetLabel: targetLabelForRow(bucket, plannedUsd, enteredUsd, targets),
      targets: targets.get(bucket) ?? [],
    };
  });
}

export function fmtMethodControlUsd(n: number): string {
  return `$${round2(n).toFixed(2)}`;
}

/** סטטוס תצוגה ל־Data Grid (UI בלבד) */
export type MethodControlGridStatus = "completed" | "partial" | "pending" | "open";

export type LivePaymentMethodControlDetailRow = {
  id: string;
  orderId: string;
  orderNumber: string;
  bucket: PaymentBucketKey;
  methodLabel: string;
  plannedUsd: number;
  enteredUsd: number;
  remainingUsd: number;
  status: MethodControlGridStatus;
  statusLabel: string;
  dateYmd: string;
};

export const METHOD_CONTROL_GRID_STATUS_META: Record<
  MethodControlGridStatus,
  { label: string; tone: string }
> = {
  completed: { label: "🟢 הושלם", tone: "completed" },
  partial: { label: "🟡 חלקי", tone: "partial" },
  pending: { label: "🟠 ממתין", tone: "pending" },
  open: { label: "🔴 פתוח", tone: "open" },
};

function gridStatusFor(plannedUsd: number, enteredUsd: number, remainingUsd: number): {
  status: MethodControlGridStatus;
  statusLabel: string;
} {
  if (enteredUsd > plannedUsd + CASH_CONTROL_EPS) {
    return { status: "open", statusLabel: METHOD_CONTROL_GRID_STATUS_META.open.label };
  }
  if (remainingUsd <= CASH_CONTROL_EPS && plannedUsd > CASH_CONTROL_EPS) {
    return { status: "completed", statusLabel: METHOD_CONTROL_GRID_STATUS_META.completed.label };
  }
  if (enteredUsd > CASH_CONTROL_EPS && remainingUsd > CASH_CONTROL_EPS) {
    return { status: "partial", statusLabel: METHOD_CONTROL_GRID_STATUS_META.partial.label };
  }
  if (plannedUsd > CASH_CONTROL_EPS && enteredUsd <= CASH_CONTROL_EPS) {
    return { status: "pending", statusLabel: METHOD_CONTROL_GRID_STATUS_META.pending.label };
  }
  return { status: "open", statusLabel: METHOD_CONTROL_GRID_STATUS_META.open.label };
}

/**
 * פירוט להזמנה×אמצעי — תצוגה בלבד.
 * מקצה את «נקלט» מהטופס לפי FIFO על ההזמנות (סכום כולל = אותו entered של האמצעי).
 */
export function buildLivePaymentMethodControlDetailRows(
  orders: PaymentIntakeOrderRow[],
  includedOrderIds: string[] | null,
  kpis: LivePaymentFormKpis,
): LivePaymentMethodControlDetailRow[] {
  const idSet = includedOrderIds ? new Set(includedOrderIds) : null;
  const payable = orders
    .filter(
      (o) =>
        o.breakdown.length > 0 &&
        Number(o.dbRemainingUsd) > CASH_CONTROL_EPS &&
        (!idSet || idSet.has(o.id)),
    )
    .slice()
    .sort((a, b) => {
      const da = a.dateYmd || "";
      const db = b.dateYmd || "";
      if (da !== db) return da.localeCompare(db);
      return (a.orderNumber || a.id).localeCompare(b.orderNumber || b.id);
    });

  type Seed = {
    order: PaymentIntakeOrderRow;
    bucket: PaymentBucketKey;
    plannedUsd: number;
  };
  const seeds: Seed[] = [];
  for (const o of payable) {
    for (const b of o.breakdown) {
      if (b.plannedUsd <= CASH_CONTROL_EPS) continue;
      seeds.push({
        order: o,
        bucket: paymentMethodBucketKey(b.method),
        plannedUsd: round2(b.plannedUsd),
      });
    }
  }

  const byBucket = new Map<PaymentBucketKey, Seed[]>();
  for (const s of seeds) {
    const list = byBucket.get(s.bucket) ?? [];
    list.push(s);
    byBucket.set(s.bucket, list);
  }

  const rows: LivePaymentMethodControlDetailRow[] = [];
  for (const [bucket, list] of byBucket) {
    let pool = round2(enteredForBucket(kpis, bucket));
    for (const s of list) {
      const enteredUsd = round2(Math.min(s.plannedUsd, Math.max(0, pool)));
      pool = round2(Math.max(0, pool - enteredUsd));
      const remainingUsd = round2(Math.max(0, s.plannedUsd - enteredUsd));
      const { status, statusLabel } = gridStatusFor(s.plannedUsd, enteredUsd, remainingUsd);
      rows.push({
        id: `${s.order.id}:${bucket}`,
        orderId: s.order.id,
        orderNumber: s.order.orderNumber?.trim() || s.order.id.slice(0, 8),
        bucket,
        methodLabel: PAYMENT_BUCKET_LABELS[bucket],
        plannedUsd: s.plannedUsd,
        enteredUsd,
        remainingUsd,
        status,
        statusLabel,
        dateYmd: s.order.dateYmd || "—",
      });
    }
  }

  // עודף הקלדה על אמצעי בלי יעד מתוכנן — שורת תצוגה (לא משנה שמירה)
  for (const bucket of [...DISPLAY_BUCKETS, "OTHER" as PaymentBucketKey]) {
    if (byBucket.has(bucket)) continue;
    const enteredUsd = round2(enteredForBucket(kpis, bucket));
    if (enteredUsd <= CASH_CONTROL_EPS) continue;
    rows.push({
      id: `__unallocated:${bucket}`,
      orderId: "",
      orderNumber: "—",
      bucket,
      methodLabel: PAYMENT_BUCKET_LABELS[bucket],
      plannedUsd: 0,
      enteredUsd,
      remainingUsd: 0,
      status: "open",
      statusLabel: METHOD_CONTROL_GRID_STATUS_META.open.label,
      dateYmd: "—",
    });
  }

  return rows.sort((a, b) => {
    const on = a.orderNumber.localeCompare(b.orderNumber, "he");
    if (on !== 0) return on;
    return a.methodLabel.localeCompare(b.methodLabel, "he");
  });
}

export type MethodControlGridSummary = {
  orderCount: number;
  plannedUsd: number;
  enteredUsd: number;
  remainingUsd: number;
};

export function summarizeMethodControlDetailRows(
  rows: LivePaymentMethodControlDetailRow[],
): MethodControlGridSummary {
  const orderIds = new Set(rows.map((r) => r.orderId).filter(Boolean));
  let plannedUsd = 0;
  let enteredUsd = 0;
  let remainingUsd = 0;
  for (const r of rows) {
    plannedUsd += r.plannedUsd;
    enteredUsd += r.enteredUsd;
    remainingUsd += r.remainingUsd;
  }
  return {
    orderCount: orderIds.size,
    plannedUsd: round2(plannedUsd),
    enteredUsd: round2(enteredUsd),
    remainingUsd: round2(remainingUsd),
  };
}

export const METHOD_CONTROL_STATUS_ICON: Record<MethodControlRowStatus, string> = {
  paid: "🟢",
  remaining: "🟡",
  excess: "🔴",
  surplus: "🟢",
  "not-required": "⚪",
};

/** תצוגת תא — לא משנה חישוב עסקי */
export function fmtMethodControlCell(
  row: LivePaymentMethodControlRow,
  kind: "planned" | "entered" | "remaining",
): string {
  if (row.status === "not-required") return "—";
  if (kind === "remaining") {
    if (row.status === "excess" || row.status === "surplus") {
      return `+$${round2(row.excessUsd).toFixed(2)}`;
    }
    return fmtMethodControlUsd(row.remainingUsd);
  }
  if (kind === "planned") return fmtMethodControlUsd(row.plannedUsd);
  return fmtMethodControlUsd(row.enteredUsd);
}

/**
 * הודעת סיכום לאחר שמירה — יתרה כוללת בלבד.
 * אין פירוט "נותר" לפי אמצעי תשלום: היתרה היא סכום אחד למסמך,
 * וניתן לשלם אותה בכל אמצעי.
 */
export function buildPostSaveRemainingSummary(
  orders: PaymentIntakeOrderRow[],
  includedOrderIds: string[] | null,
): string {
  const idSet = includedOrderIds ? new Set(includedOrderIds) : null;
  let totalRemaining = 0;
  for (const o of orders) {
    if (idSet && !idSet.has(o.id)) continue;
    totalRemaining += Math.max(0, Number(o.dbRemainingUsd) || 0);
  }
  totalRemaining = round2(totalRemaining);
  if (totalRemaining <= CASH_CONTROL_EPS) return "התשלום נשמר — שולם במלואו";
  return `התשלום נשמר\nיתרה לתשלום: ${fmtMethodControlUsd(totalRemaining)}`;
}
