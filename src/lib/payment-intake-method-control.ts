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
};

const DISPLAY_BUCKETS: PaymentBucketKey[] = ["CASH", "BANK_TRANSFER", "CREDIT", "CHECK"];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildBucketTargets(
  orders: PaymentIntakeOrderRow[],
  includedOrderIds: string[] | null,
): Map<PaymentBucketKey, string> {
  const idSet = includedOrderIds ? new Set(includedOrderIds) : null;
  const byBucket = new Map<PaymentBucketKey, Set<string>>();
  for (const o of orders) {
    if (idSet && !idSet.has(o.id)) continue;
    if (Number(o.dbRemainingUsd) <= CASH_CONTROL_EPS) continue;
    if (o.breakdown.length === 0) continue;
    for (const b of o.breakdown) {
      if (b.plannedUsd <= CASH_CONTROL_EPS) continue;
      const bucket = paymentMethodBucketKey(b.method);
      const nums = byBucket.get(bucket) ?? new Set<string>();
      nums.add(o.orderNumber?.trim() || o.id.slice(0, 8));
      byBucket.set(bucket, nums);
    }
  }
  const out = new Map<PaymentBucketKey, string>();
  for (const [bucket, nums] of byBucket) {
    const list = [...nums];
    out.set(bucket, list.length <= 2 ? list.join(", ") : `${list.slice(0, 2).join(", ")} +${list.length - 2}`);
  }
  return out;
}

function targetLabelForRow(
  bucket: PaymentBucketKey,
  plannedUsd: number,
  enteredUsd: number,
  targets: Map<PaymentBucketKey, string>,
): string {
  const planned = targets.get(bucket);
  if (planned) return planned;
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

function computeRowStatus(
  plannedUsd: number,
  enteredUsd: number,
  globalOverageUsd: number,
): Pick<LivePaymentMethodControlRow, "status" | "statusLabel" | "excessUsd"> {
  if (plannedUsd <= CASH_CONTROL_EPS) {
    if (enteredUsd <= CASH_CONTROL_EPS) {
      return { status: "not-required", statusLabel: "לא נדרש", excessUsd: 0 };
    }
    const excess = round2(enteredUsd);
    return { status: "excess", statusLabel: "חריגה", excessUsd: excess };
  }
  if (enteredUsd > plannedUsd + CASH_CONTROL_EPS) {
    const excess = round2(enteredUsd - plannedUsd);
    if (globalOverageUsd >= excess - CASH_CONTROL_EPS) {
      return { status: "surplus", statusLabel: "עודף תשלום", excessUsd: excess };
    }
    return { status: "excess", statusLabel: "חריגה", excessUsd: excess };
  }
  const remaining = round2(plannedUsd - enteredUsd);
  if (remaining <= CASH_CONTROL_EPS) {
    return { status: "paid", statusLabel: "שולם", excessUsd: 0 };
  }
  return { status: "remaining", statusLabel: "נותר לתשלום", excessUsd: 0 };
}

export function hasCompositeMethodControl(
  orders: PaymentIntakeOrderRow[],
  includedOrderIds: string[] | null,
): boolean {
  return buildIntakeBreakdownPlan(orders, includedOrderIds).length > 0;
}

/** שורות בקרה חיות — תוכנן מההזמנה, נקלט מהטופס הנוכחי בלבד */
export function buildLivePaymentMethodControlRows(
  orders: PaymentIntakeOrderRow[],
  includedOrderIds: string[] | null,
  kpis: LivePaymentFormKpis,
  totalPaymentUsd?: number,
): LivePaymentMethodControlRow[] {
  const plan = buildIntakeBreakdownPlan(orders, includedOrderIds);
  const planMap = new Map(plan.map((p) => [p.bucket, p.plannedUsd]));

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

  const buckets: PaymentBucketKey[] = [...DISPLAY_BUCKETS];
  const otherPlanned = planMap.get("OTHER") ?? 0;
  const otherEntered = enteredForBucket(kpis, "OTHER");
  if (otherPlanned > CASH_CONTROL_EPS || otherEntered > CASH_CONTROL_EPS) {
    buckets.push("OTHER");
  }

  const targets = buildBucketTargets(orders, includedOrderIds);

  return buckets.map((bucket) => {
    const plannedUsd = round2(planMap.get(bucket) ?? 0);
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
    };
  });
}

export function fmtMethodControlUsd(n: number): string {
  return `$${round2(n).toFixed(2)}`;
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

/** הודעת סיכום לאחר שמירה — כמה נשאר לגבות מכל אמצעי */
export function buildPostSaveRemainingSummary(
  orders: PaymentIntakeOrderRow[],
  includedOrderIds: string[] | null,
): string {
  const plan = buildIntakeBreakdownPlan(orders, includedOrderIds);
  const lines = plan
    .filter((p) => p.remainingUsd > CASH_CONTROL_EPS)
    .map((p) => `${p.label} – נותר ${fmtMethodControlUsd(p.remainingUsd)}`);
  if (lines.length === 0) return "התשלום נשמר — כל האמצעים שולמו במלואם";
  return `התשלום נשמר\n${lines.join("\n")}`;
}
