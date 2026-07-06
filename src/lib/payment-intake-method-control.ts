/**
 * בקרת אמצעי תשלום בזמן קליטה — חישוב חי לפי ההקלדה הנוכחית בטופס בלבד (UX).
 */

import { buildIntakeBreakdownPlan } from "@/lib/cash-control-intake-breakdown";
import { CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";
import type { LivePaymentFormKpis } from "@/lib/payment-intake-live-kpi";
import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";
import { PAYMENT_BUCKET_LABELS, type PaymentBucketKey } from "@/lib/payment-breakdown-shared";

export type MethodControlRowStatus = "paid" | "remaining" | "excess" | "not-required";

export type LivePaymentMethodControlRow = {
  bucket: PaymentBucketKey;
  label: string;
  plannedUsd: number;
  enteredUsd: number;
  remainingUsd: number;
  status: MethodControlRowStatus;
  statusLabel: string;
  excessUsd: number;
};

const DISPLAY_BUCKETS: PaymentBucketKey[] = ["CASH", "BANK_TRANSFER", "CREDIT", "CHECK"];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
): LivePaymentMethodControlRow[] {
  const plan = buildIntakeBreakdownPlan(orders, includedOrderIds);
  const planMap = new Map(plan.map((p) => [p.bucket, p.plannedUsd]));

  const buckets: PaymentBucketKey[] = [...DISPLAY_BUCKETS];
  const otherPlanned = planMap.get("OTHER") ?? 0;
  const otherEntered = enteredForBucket(kpis, "OTHER");
  if (otherPlanned > CASH_CONTROL_EPS || otherEntered > CASH_CONTROL_EPS) {
    buckets.push("OTHER");
  }

  return buckets.map((bucket) => {
    const plannedUsd = round2(planMap.get(bucket) ?? 0);
    const enteredUsd = round2(enteredForBucket(kpis, bucket));
    const remainingUsd = round2(plannedUsd - enteredUsd);
    const { status, statusLabel, excessUsd } = computeRowStatus(plannedUsd, enteredUsd);
    return {
      bucket,
      label: PAYMENT_BUCKET_LABELS[bucket],
      plannedUsd,
      enteredUsd,
      remainingUsd,
      status,
      statusLabel,
      excessUsd,
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
  "not-required": "⚪",
};

/** תצוגת תא — לא משנה חישוב עסקי */
export function fmtMethodControlCell(
  row: LivePaymentMethodControlRow,
  kind: "planned" | "entered" | "remaining",
): string {
  if (row.status === "not-required") return "—";
  if (kind === "remaining") {
    if (row.status === "excess") return `+$${round2(row.excessUsd).toFixed(2)}`;
    return fmtMethodControlUsd(row.remainingUsd);
  }
  if (kind === "planned") return fmtMethodControlUsd(row.plannedUsd);
  return fmtMethodControlUsd(row.enteredUsd);
}
