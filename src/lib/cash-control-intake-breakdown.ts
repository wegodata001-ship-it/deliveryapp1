/**
 * אכיפת אמצעי תשלום בקליטה — ללא תלות בשרת (ניתן לייבא מ-Client).
 */

import {
  type BreakdownEnforcementViolation,
  type EnteredBucketUsd,
  type PlannedBucketUsd,
  enforceBreakdownAgainstEntered,
  paymentMethodBucketKey,
  PAYMENT_BUCKET_LABELS,
  type PaymentBucketKey,
} from "@/lib/payment-breakdown-shared";
import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";
import { CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildIntakeBreakdownPlan(
  orders: PaymentIntakeOrderRow[],
  includedOrderIds: string[] | null,
): PlannedBucketUsd[] {
  const idSet = includedOrderIds ? new Set(includedOrderIds) : null;
  const payable = orders.filter(
    (o) =>
      o.isComposite &&
      o.breakdown.length > 0 &&
      Number(o.dbRemainingUsd) > CASH_CONTROL_EPS &&
      (!idSet || idSet.has(o.id)),
  );
  const planByBucket = new Map<PaymentBucketKey, PlannedBucketUsd>();
  for (const o of payable) {
    for (const b of o.breakdown) {
      const bucket = paymentMethodBucketKey(b.method);
      const cur =
        planByBucket.get(bucket) ??
        { bucket, label: PAYMENT_BUCKET_LABELS[bucket], plannedUsd: 0, remainingUsd: 0 };
      cur.plannedUsd = round2(cur.plannedUsd + b.plannedUsd);
      cur.remainingUsd = round2(cur.remainingUsd + b.remainingUsd);
      planByBucket.set(bucket, cur);
    }
  }
  return [...planByBucket.values()];
}

export function checkIntakeBreakdownViolations(
  orders: PaymentIntakeOrderRow[],
  includedOrderIds: string[] | null,
  enteredByBucket: EnteredBucketUsd[],
): BreakdownEnforcementViolation[] {
  const planned = buildIntakeBreakdownPlan(orders, includedOrderIds);
  if (planned.length === 0) return [];
  return enforceBreakdownAgainstEntered(planned, enteredByBucket);
}

export const METHOD_DEV_APPROVED_NOTE_TAG = "[METHOD_DEV_APPROVED]";

export type IntakeSaveDeviationRow = {
  id: string;
  typeLabel: string;
  plannedDisplay: string;
  receivedDisplay: string;
  diffDisplay: string;
  statusLabel: string;
  rowTone: "excess" | "shortfall" | "ok" | "rate" | "amount";
};

function fmtUsd(n: number): string {
  return `$${round2(n).toFixed(2)}`;
}

function fmtSignedUsd(n: number): string {
  const r = round2(n);
  if (Math.abs(r) <= CASH_CONTROL_EPS) return "—";
  return r > 0 ? `+${fmtUsd(r)}` : `-${fmtUsd(Math.abs(r))}`;
}

/**
 * בדיקות חריגה לקליטת תשלום — מופעלות רק בניסיון שמירה (לא בזמן הקלדה).
 */
export function computeIntakeSaveDeviations(params: {
  orders: PaymentIntakeOrderRow[];
  includedOrderIds: string[] | null;
  enteredByBucket: EnteredBucketUsd[];
  formRateN: number;
  totalPaymentUsd: number;
}): IntakeSaveDeviationRow[] {
  const { orders, includedOrderIds, enteredByBucket, formRateN, totalPaymentUsd } = params;
  const rows: IntakeSaveDeviationRow[] = [];
  const plan = buildIntakeBreakdownPlan(orders, includedOrderIds);
  const enteredMap = new Map(enteredByBucket.map((e) => [e.bucket, e.enteredUsd]));
  const idSet = includedOrderIds ? new Set(includedOrderIds) : null;
  const includedOrders = orders.filter((o) => !idSet || idSet.has(o.id));

  if (plan.length > 0) {
    for (const p of plan) {
      const entered = enteredMap.get(p.bucket) ?? 0;
      const allowed = p.remainingUsd;
      const diff = round2(entered - allowed);
      let rowTone: IntakeSaveDeviationRow["rowTone"] = "ok";
      let statusLabel = "🟢 תקין";
      if (entered > allowed + CASH_CONTROL_EPS) {
        rowTone = "excess";
        statusLabel = "🔴 חריגה";
      } else if (allowed > CASH_CONTROL_EPS && entered < allowed - CASH_CONTROL_EPS) {
        rowTone = "shortfall";
        statusLabel = "🟠 לא שולם";
      }
      rows.push({
        id: `method:${p.bucket}`,
        typeLabel: p.label,
        plannedDisplay: fmtUsd(allowed),
        receivedDisplay: fmtUsd(entered),
        diffDisplay: fmtSignedUsd(diff),
        statusLabel,
        rowTone,
      });
    }

    for (const e of enteredByBucket) {
      if (e.enteredUsd <= CASH_CONTROL_EPS) continue;
      const planEntry = plan.find((p) => p.bucket === e.bucket);
      if (planEntry && planEntry.plannedUsd > CASH_CONTROL_EPS) continue;
      rows.push({
        id: `unplanned:${e.bucket}`,
        typeLabel: e.label,
        plannedDisplay: fmtUsd(0),
        receivedDisplay: fmtUsd(e.enteredUsd),
        diffDisplay: fmtSignedUsd(e.enteredUsd),
        statusLabel: "🔴 חריגה",
        rowTone: "excess",
      });
    }
  }

  const rateChecked = new Set<string>();
  for (const o of includedOrders) {
    const orderRate = Number((o.rate || "").replace(",", "."));
    if (!(orderRate > 0 && formRateN > 0) || Math.abs(orderRate - formRateN) <= 0.05) continue;
    const key = orderRate.toFixed(4);
    if (rateChecked.has(key)) continue;
    rateChecked.add(key);
    const diff = round2(formRateN - orderRate);
    rows.push({
      id: `rate:${o.id}`,
      typeLabel: "שער דולר",
      plannedDisplay: orderRate.toFixed(4),
      receivedDisplay: formRateN.toFixed(4),
      diffDisplay: diff >= 0 ? `+${diff.toFixed(4)}` : diff.toFixed(4),
      statusLabel: "🟡 חריגת שער",
      rowTone: "rate",
    });
  }

  let totalRemaining = 0;
  for (const o of includedOrders) {
    totalRemaining += Math.max(0, Number(o.dbRemainingUsd) || 0);
  }
  totalRemaining = round2(totalRemaining);
  if (totalRemaining > CASH_CONTROL_EPS && totalPaymentUsd > totalRemaining + CASH_CONTROL_EPS) {
    rows.push({
      id: "balance:excess",
      typeLabel: "סכום כולל מול יתרת הזמנה",
      plannedDisplay: fmtUsd(totalRemaining),
      receivedDisplay: fmtUsd(totalPaymentUsd),
      diffDisplay: fmtSignedUsd(totalPaymentUsd - totalRemaining),
      statusLabel: "🔴 חריגה",
      rowTone: "amount",
    });
  }

  return rows;
}

export function intakeSaveHasDeviations(rows: IntakeSaveDeviationRow[]): boolean {
  return rows.some((r) => r.rowTone !== "ok");
}
