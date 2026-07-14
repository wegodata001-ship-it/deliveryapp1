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
  totalPaymentUsd?: number,
): BreakdownEnforcementViolation[] {
  const planned = buildIntakeBreakdownPlan(orders, includedOrderIds);
  if (planned.length === 0) return [];
  const violations = enforceBreakdownAgainstEntered(planned, enteredByBucket);
  if (totalPaymentUsd == null || !Number.isFinite(totalPaymentUsd)) return violations;

  const idSet = includedOrderIds ? new Set(includedOrderIds) : null;
  let totalRemaining = 0;
  for (const o of orders) {
    if (idSet && !idSet.has(o.id)) continue;
    totalRemaining += Math.max(0, Number(o.dbRemainingUsd) || 0);
  }
  totalRemaining = round2(totalRemaining);
  let unexplainedOverageUsd = round2(Math.max(0, totalPaymentUsd - totalRemaining));

  return violations.filter((v) => {
    if (v.type !== "excess") return true;
    if (unexplainedOverageUsd >= v.excessUsd - CASH_CONTROL_EPS) {
      unexplainedOverageUsd = round2(Math.max(0, unexplainedOverageUsd - v.excessUsd));
      return false;
    }
    return true;
  });
}

export const METHOD_DEV_APPROVED_NOTE_TAG = "[METHOD_DEV_APPROVED]";

export type IntakeSaveDeviationRow = {
  id: string;
  typeLabel: string;
  plannedDisplay: string;
  receivedDisplay: string;
  diffDisplay: string;
  statusLabel: string;
  /** excess/shortfall/rate = חוסם שמירה · surplus/amount = עודף תשלום (לא חריגה) · ok = תקין */
  rowTone: "excess" | "shortfall" | "ok" | "rate" | "amount" | "surplus";
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

  let totalRemaining = 0;
  for (const o of includedOrders) {
    totalRemaining += Math.max(0, Number(o.dbRemainingUsd) || 0);
  }
  totalRemaining = round2(totalRemaining);
  const globalOverageUsd = round2(Math.max(0, totalPaymentUsd - totalRemaining));
  let unexplainedOverageUsd = globalOverageUsd;

  if (plan.length > 0) {
    for (const p of plan) {
      const entered = enteredMap.get(p.bucket) ?? 0;
      const allowed = p.remainingUsd;
      const diff = round2(entered - allowed);
      let rowTone: IntakeSaveDeviationRow["rowTone"] = "ok";
      let statusLabel = "🟢 תקין";
      if (entered > allowed + CASH_CONTROL_EPS) {
        const bucketOverage = round2(entered - allowed);
        if (unexplainedOverageUsd >= bucketOverage - CASH_CONTROL_EPS) {
          rowTone = "surplus";
          statusLabel = "🟢 עודף תשלום";
          unexplainedOverageUsd = round2(Math.max(0, unexplainedOverageUsd - bucketOverage));
        } else {
          rowTone = "excess";
          statusLabel = "🔴 חריגה";
        }
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

  if (globalOverageUsd > CASH_CONTROL_EPS) {
    rows.push({
      id: "balance:surplus",
      typeLabel: "עודף תשלום מול יתרת הזמנה",
      plannedDisplay: fmtUsd(totalRemaining),
      receivedDisplay: fmtUsd(totalPaymentUsd),
      diffDisplay: fmtSignedUsd(globalOverageUsd),
      statusLabel: "🟢 עודף תשלום",
      rowTone: "surplus",
    });
  }

  return rows;
}

/** חריגת אמצעי — אמצעי שונה / סכום באמצעי לא מתוכנן (לא shortfall) */
export function intakeHasMethodMismatch(rows: IntakeSaveDeviationRow[]): boolean {
  return rows.some((r) => r.rowTone === "excess" || r.id.startsWith("unplanned:"));
}

/** חריגת שער דולר */
export function intakeHasRateMismatch(rows: IntakeSaveDeviationRow[]): boolean {
  return rows.some((r) => r.rowTone === "rate");
}

/** יתרה פתוחה — אותו אמצעי, פחות מהמתוכנן */
export function intakeHasOpenBalanceShortfall(rows: IntakeSaveDeviationRow[]): boolean {
  return rows.some((r) => r.rowTone === "shortfall");
}

/** חריגות שחוסמות שמירה — רק אמצעי שונה או שער (לא shortfall / surplus) */
export function intakeSaveHasDeviations(rows: IntakeSaveDeviationRow[]): boolean {
  return intakeHasMethodMismatch(rows) || intakeHasRateMismatch(rows);
}

// ---------------------------------------------------------------------------
// חישוב עודף לפי אמצעי תשלום — עבור רישום הפרשי התאמה מפורטים
// ---------------------------------------------------------------------------

/** עודף לפי אמצעי תשלום אחד */
export type PerMethodSurplusRow = {
  /** קבוצת אמצעי תשלום נורמלית */
  bucket: PaymentBucketKey;
  /** מחרוזת אמצעי תשלום (ל-DB) — "CASH", "BANK_TRANSFER" וכו' */
  dbMethod: string;
  label: string;
  plannedUsd: number;
  enteredUsd: number;
  /** max(0, entered − planned) */
  surplusUsd: number;
};

/**
 * ממיר PaymentBucketKey לערך DB (PaymentMethod string).
 * שם מחרוזת ולא enum כדי לא לייבא Prisma מ-client-side.
 */
export function bucketKeyToDbMethod(bucket: PaymentBucketKey): string {
  switch (bucket) {
    case "CASH":
      return "CASH";
    case "BANK_TRANSFER":
      return "BANK_TRANSFER";
    case "CREDIT":
      return "CREDIT";
    case "CHECK":
      return "CHECK";
    default:
      return "OTHER";
  }
}

/**
 * מחשב עודף לכל אמצעי תשלום בנפרד.
 *
 * הלוגיקה:
 *   לכל bucket שהוזן:
 *     - plannedUsd  = סכום ה-remainingUsd מהחלוקה המתוכננת (breakdown)
 *     - enteredUsd  = מה שהוקלד בטופס עבור אותו bucket
 *     - surplusUsd  = max(0, entered − planned)
 *
 * מחזיר רק buckets עם surplusUsd > EPS.
 * אם אין חלוקה מתוכננת כלל (orders ללא breakdown) — מחזיר ריק.
 */
export function computePerMethodSurplus(params: {
  orders: PaymentIntakeOrderRow[];
  includedOrderIds: string[] | null;
  enteredByBucket: EnteredBucketUsd[];
  eps?: number;
}): PerMethodSurplusRow[] {
  const eps = params.eps ?? CASH_CONTROL_EPS;
  const plan = buildIntakeBreakdownPlan(params.orders, params.includedOrderIds);
  if (plan.length === 0) return [];

  const planMap = new Map(plan.map((p) => [p.bucket, p.remainingUsd]));
  const result: PerMethodSurplusRow[] = [];

  for (const e of params.enteredByBucket) {
    if (e.enteredUsd <= eps) continue;
    const plannedUsd = planMap.get(e.bucket) ?? 0;
    const surplusUsd = round2(Math.max(0, e.enteredUsd - plannedUsd));
    if (surplusUsd <= eps) continue;
    result.push({
      bucket: e.bucket,
      dbMethod: bucketKeyToDbMethod(e.bucket),
      label: e.label,
      plannedUsd: round2(plannedUsd),
      enteredUsd: round2(e.enteredUsd),
      surplusUsd,
    });
  }

  return result;
}

export function intakeSaveHasSurplus(rows: IntakeSaveDeviationRow[]): boolean {
  return rows.some((r) => r.rowTone === "surplus" || r.rowTone === "amount");
}

/** שורות לתצוגת מודאל חריגה — ללא shortfall/surplus */
export function intakeDeviationModalRows(rows: IntakeSaveDeviationRow[]): IntakeSaveDeviationRow[] {
  return rows.filter(
    (r) =>
      r.rowTone !== "ok" &&
      r.rowTone !== "surplus" &&
      r.rowTone !== "amount" &&
      r.rowTone !== "shortfall",
  );
}
