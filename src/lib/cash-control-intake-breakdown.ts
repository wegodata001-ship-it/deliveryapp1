/**
 * אכיפת אמצעי תשלום בקליטה — ללא תלות בשרת (ניתן לייבא מ-Client).
 */

import {
  enforceBreakdownAgainstEntered,
  type EnteredBucketUsd,
  type PlannedBucketUsd,
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
 *
 * אמצעי התשלום המתוכננים הם חוק עסקי. חריגה מהיתרה המתוכננת לאמצעי,
 * או שימוש באמצעי שלא תוכנן, חוסמים שמירה לפני FIFO.
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
  const idSet = includedOrderIds ? new Set(includedOrderIds) : null;
  const includedOrders = orders.filter((o) => !idSet || idSet.has(o.id));

  const methodPlan = buildIntakeBreakdownPlan(orders, includedOrderIds);
  const methodViolations = enforceBreakdownAgainstEntered(methodPlan, enteredByBucket);
  for (const violation of methodViolations) {
    rows.push({
      id: `method:${violation.bucket}`,
      typeLabel: violation.label,
      plannedDisplay: fmtUsd(violation.allowedUsd),
      receivedDisplay: fmtUsd(violation.enteredUsd),
      diffDisplay: fmtSignedUsd(violation.excessUsd),
      statusLabel:
        violation.type === "not-planned"
          ? "🔴 אמצעי תשלום לא תוכנן"
          : "🔴 חריגה מהתכנון",
      rowTone: "excess",
    });
  }

  let totalRemaining = 0;
  for (const o of includedOrders) {
    totalRemaining += Math.max(0, Number(o.dbRemainingUsd) || 0);
  }
  totalRemaining = round2(totalRemaining);
  const globalOverageUsd = round2(Math.max(0, totalPaymentUsd - totalRemaining));

  // תשלום חלקי — יתרה פתוחה ברמת המסמך (לא חריגה, לא חוסם)
  if (
    totalRemaining > CASH_CONTROL_EPS &&
    totalPaymentUsd < totalRemaining - CASH_CONTROL_EPS
  ) {
    rows.push({
      id: "balance:shortfall",
      typeLabel: "יתרה לתשלום",
      plannedDisplay: fmtUsd(totalRemaining),
      receivedDisplay: fmtUsd(totalPaymentUsd),
      diffDisplay: fmtSignedUsd(totalPaymentUsd - totalRemaining),
      statusLabel: "🟠 תשלום חלקי",
      rowTone: "shortfall",
    });
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

/** חריגת אמצעי תשלום שחוסמת שמירה. */
export function intakeHasMethodMismatch(rows: IntakeSaveDeviationRow[]): boolean {
  return rows.some((r) => r.rowTone === "excess" || r.id.startsWith("unplanned:"));
}

/** חריגת שער דולר */
export function intakeHasRateMismatch(rows: IntakeSaveDeviationRow[]): boolean {
  return rows.some((r) => r.rowTone === "rate");
}

/** יתרה פתוחה — סה"כ התשלום קטן מהיתרה הכוללת של המסמך (תשלום חלקי) */
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

// ─── Deviation Comparison Table ───────────────────────────────────────────────

/**
 * שורת השוואה לטבלת חריגת אמצעי תשלום.
 * מציגה כל אמצעי שתוכנן + כל אמצעי שהוזן — עם סטטוס ברור לכל שורה.
 */
export type DeviationComparisonRow = {
  bucket: PaymentBucketKey;
  methodLabel: string;
  /** יתרה פתוחה מתוכננת (b.remainingUsd אגרגטי) */
  plannedUsd: number;
  /** סכום שהוזן בטופס הנוכחי לאמצעי זה */
  enteredUsd: number;
  /** max(0, plannedUsd − enteredUsd) */
  remainingUsd: number;
  status: "partial" | "pending" | "cleared" | "unplanned" | "excess";
  statusLabel: string;
  /** true = עוצר שמירה (אמצעי לא מתוכנן, חריגה מעל המתוכנן) */
  isBlocking: boolean;
};

/**
 * בנה טבלת השוואה מלאה: כל אמצעי מתוכנן + כל אמצעי שהוזן.
 * ממחיש בבירור מה תוכנן, מה נקלט, ומה הסטטוס של כל אמצעי.
 *
 * כלל ההחלטה:
 *   • תשלום חלקי על אותו אמצעי → status="partial", לא חוסם.
 *   • אמצעי לא מתוכנן → status="unplanned", חוסם.
 *   • חריגה מהיתרה → status="excess", חוסם.
 *   • אמצעי מתוכנן שלא שולם → status="pending", לא חוסם.
 *   • שולם במלואו → status="cleared", לא חוסם.
 */
export function buildDeviationComparisonRows(
  orders: PaymentIntakeOrderRow[],
  includedOrderIds: string[] | null,
  enteredByBucket: EnteredBucketUsd[],
): DeviationComparisonRow[] {
  const plan = buildIntakeBreakdownPlan(orders, includedOrderIds);
  const planMap = new Map(plan.map((p) => [p.bucket, p]));
  const enteredMap = new Map(
    enteredByBucket.filter((e) => e.enteredUsd > CASH_CONTROL_EPS).map((e) => [e.bucket, e.enteredUsd]),
  );

  const allBuckets = new Set<PaymentBucketKey>([...planMap.keys(), ...enteredMap.keys()]);
  const rows: DeviationComparisonRow[] = [];

  for (const bucket of allBuckets) {
    const p = planMap.get(bucket);
    const plannedUsd = round2(p?.remainingUsd ?? 0);
    const enteredUsd = round2(enteredMap.get(bucket) ?? 0);
    const remainingUsd = round2(Math.max(0, plannedUsd - enteredUsd));
    const overUsd = round2(Math.max(0, enteredUsd - plannedUsd));

    let status: DeviationComparisonRow["status"];
    let statusLabel: string;
    let isBlocking: boolean;

    if (plannedUsd <= CASH_CONTROL_EPS && enteredUsd > CASH_CONTROL_EPS) {
      status = "unplanned";
      statusLabel = `🔴 אמצעי תשלום לא מתוכנן ($${enteredUsd.toFixed(2)} ב-${PAYMENT_BUCKET_LABELS[bucket]})`;
      isBlocking = true;
    } else if (enteredUsd > plannedUsd + CASH_CONTROL_EPS) {
      status = "excess";
      statusLabel = `🔴 חריגה מהתכנון — עודף $${overUsd.toFixed(2)}`;
      isBlocking = true;
    } else if (enteredUsd <= CASH_CONTROL_EPS && plannedUsd > CASH_CONTROL_EPS) {
      status = "pending";
      statusLabel = "🔴 לא שולם — חוב פתוח";
      isBlocking = false;
    } else if (remainingUsd <= CASH_CONTROL_EPS) {
      status = "cleared";
      statusLabel = "🟢 שולם במלואו";
      isBlocking = false;
    } else {
      // 0 < entered <= planned, remaining > 0
      status = "partial";
      statusLabel = `🟡 תשלום חלקי — נותר $${remainingUsd.toFixed(2)}`;
      isBlocking = false;
    }

    rows.push({
      bucket,
      methodLabel: PAYMENT_BUCKET_LABELS[bucket],
      plannedUsd,
      enteredUsd,
      remainingUsd,
      status,
      statusLabel,
      isBlocking,
    });
  }

  // סדר: חריגות קודם (עוצרות שמירה), אחר כך ממתין, חלקי, שולם
  const order: Record<DeviationComparisonRow["status"], number> = {
    unplanned: 0,
    excess: 1,
    pending: 2,
    partial: 3,
    cleared: 4,
  };
  return rows.sort((a, b) => (order[a.status] - order[b.status]) || a.methodLabel.localeCompare(b.methodLabel, "he"));
}

// ─── Locked methods + debt transfer + surplus-after-closure gate ─────────────

/**
 * אמצעי תשלום שנסגר (יתרה ≈ 0) נעול — אסור לפתוח מחדש / להעביר אליו חוב
 * ללא אישור מפורש של המשתמש.
 */
export function isPaymentMethodLocked(remainingUsd: number, eps = CASH_CONTROL_EPS): boolean {
  return remainingUsd <= eps;
}

/** הצעת העברת חוב בין אמצעי תשלום — דורשת אישור משתמש */
export type DebtTransferProposal = {
  fromBucket: PaymentBucketKey;
  fromLabel: string;
  toBucket: PaymentBucketKey;
  toLabel: string;
  amountUsd: number;
};

/**
 * שערי החלטה לקליטת תשלום לפי אמצעי:
 * - ALLOW — מותר להמשיך (תשלום חלקי תקין / התאמה מלאה ללא עודף)
 * - METHOD_DEVIATION — תשלום באמצעי לא מתוכנן / מעל היתרה (אין העברת חוב)
 * - SURPLUS_AFTER_CLOSURE — כל החוב נסגר ויש עודף אמיתי → חלון עודף ייעודי
 * - DEBT_TRANSFER — deprecated, לא מוחזר עוד (נשאר בטיפוס לתאימות)
 */
export type MethodIntakeGate =
  | { kind: "ALLOW" }
  | { kind: "DEBT_TRANSFER"; transfers: DebtTransferProposal[] }
  | { kind: "METHOD_DEVIATION" }
  | {
      kind: "SURPLUS_AFTER_CLOSURE";
      surplusUsd: number;
      totalDebtUsd: number;
      totalPaymentUsd: number;
    };

/**
 * בונה תכנון אכיפה רק מאמצעים פתוחים (remaining > 0).
 * אמצעים נעולים (remaining = 0) אינם מקבלים הקצאה אוטומטית.
 */
export function buildOpenMethodPlan(
  orders: PaymentIntakeOrderRow[],
  includedOrderIds: string[] | null,
): PlannedBucketUsd[] {
  return buildIntakeBreakdownPlan(orders, includedOrderIds)
    .filter((p) => p.remainingUsd > CASH_CONTROL_EPS)
    .map((p) => ({
      ...p,
      // לאכיפה: המותר הוא היתרה הפתוחה בלבד
      plannedUsd: p.remainingUsd,
    }));
}

/**
 * מחשב הצעות העברת חוב: סכומים שהוזנו לאמצעי נעול/לא-פתוח
 * מול יתרות פתוחות באמצעים אחרים (FIFO לפי סדר האמצעים הפתוחים).
 */
export function buildDebtTransferProposals(
  openPlan: PlannedBucketUsd[],
  enteredByBucket: EnteredBucketUsd[],
  eps = CASH_CONTROL_EPS,
): DebtTransferProposal[] {
  const openRemaining = new Map(openPlan.map((p) => [p.bucket, round2(p.remainingUsd)]));
  const proposals: DebtTransferProposal[] = [];

  for (const e of enteredByBucket) {
    if (e.enteredUsd <= eps) continue;
    const allowed = openRemaining.get(e.bucket) ?? 0;
    let needFromOthers = round2(Math.max(0, e.enteredUsd - allowed));
    if (needFromOthers <= eps) {
      // צורכים מהיתרה הפתוחה של אותו אמצעי
      if (allowed > eps) {
        openRemaining.set(e.bucket, round2(Math.max(0, allowed - Math.min(allowed, e.enteredUsd))));
      }
      continue;
    }
    // צורכים קודם את המותר באותו אמצעי
    if (allowed > eps) {
      openRemaining.set(e.bucket, 0);
    }
    for (const [fromBucket, fromRem] of openRemaining) {
      if (needFromOthers <= eps) break;
      if (fromBucket === e.bucket || fromRem <= eps) continue;
      const take = round2(Math.min(fromRem, needFromOthers));
      if (take <= eps) continue;
      proposals.push({
        fromBucket,
        fromLabel: PAYMENT_BUCKET_LABELS[fromBucket],
        toBucket: e.bucket,
        toLabel: e.label || PAYMENT_BUCKET_LABELS[e.bucket],
        amountUsd: take,
      });
      openRemaining.set(fromBucket, round2(fromRem - take));
      needFromOthers = round2(needFromOthers - take);
    }
  }
  return proposals;
}

/**
 * מחיל העברות חוב מאושרות על תכנון האמצעים הפתוחים —
 * מעביר remainingUsd מ-from ל-to (ללא שינוי סכום כולל).
 */
export function applyDebtTransfersToPlan(
  openPlan: PlannedBucketUsd[],
  transfers: DebtTransferProposal[],
  eps = CASH_CONTROL_EPS,
): PlannedBucketUsd[] {
  if (transfers.length === 0) return openPlan;
  const map = new Map(openPlan.map((p) => [p.bucket, { ...p }]));
  for (const t of transfers) {
    if (t.amountUsd <= eps) continue;
    const from = map.get(t.fromBucket);
    if (!from || from.remainingUsd <= eps) continue;
    const take = round2(Math.min(from.remainingUsd, t.amountUsd));
    from.remainingUsd = round2(from.remainingUsd - take);
    from.plannedUsd = from.remainingUsd;
    const to =
      map.get(t.toBucket) ??
      ({
        bucket: t.toBucket,
        label: t.toLabel || PAYMENT_BUCKET_LABELS[t.toBucket],
        plannedUsd: 0,
        remainingUsd: 0,
      } satisfies PlannedBucketUsd);
    to.remainingUsd = round2(to.remainingUsd + take);
    to.plannedUsd = to.remainingUsd;
    map.set(t.toBucket, to);
    map.set(t.fromBucket, from);
  }
  return [...map.values()].filter((p) => p.remainingUsd > eps);
}

/**
 * מקור אמת יחיד להחלטת שערי אמצעי תשלום לפני שמירה.
 *
 * עקרון עסקי:
 * - אין העברת חוב בין אמצעי תשלום בזמן קליטה.
 * - שינוי אמצעי מתוכנן נעשה רק במסך «אמצעי תשלום מתוכננים».
 * - תשלום באמצעי לא מתוכנן / מעל היתרה → METHOD_DEVIATION (חסימה).
 * - עודף אמיתי (סכום > חוב) רק כשאין חריגת אמצעי → SURPLUS_AFTER_CLOSURE.
 */
export function classifyMethodIntakeGate(params: {
  orders: PaymentIntakeOrderRow[];
  includedOrderIds: string[] | null;
  enteredByBucket: EnteredBucketUsd[];
  totalPaymentUsd: number;
  /** @deprecated לא בשימוש — העברת חוב בין אמצעים בוטלה */
  approvedDebtTransfers?: DebtTransferProposal[] | null;
  eps?: number;
}): MethodIntakeGate {
  const eps = params.eps ?? CASH_CONTROL_EPS;
  const openPlan = buildOpenMethodPlan(params.orders, params.includedOrderIds);
  const entered = params.enteredByBucket.filter((e) => e.enteredUsd > eps);

  let totalDebtUsd = 0;
  const idSet = params.includedOrderIds ? new Set(params.includedOrderIds) : null;
  for (const o of params.orders) {
    if (idSet && !idSet.has(o.id)) continue;
    totalDebtUsd += Math.max(0, Number(o.dbRemainingUsd) || 0);
  }
  totalDebtUsd = round2(totalDebtUsd);
  const totalPaymentUsd = round2(Math.max(0, params.totalPaymentUsd));
  const surplusUsd = round2(Math.max(0, totalPaymentUsd - totalDebtUsd));
  const coversAllDebt = totalPaymentUsd >= totalDebtUsd - eps;

  // אין העברת חוב — אכיפה מול האמצעים הפתוחים כפי שתוכננו בלבד
  const violations = enforceBreakdownAgainstEntered(openPlan, entered, eps);

  const enteredMap = new Map(
    entered.map((e) => [e.bucket, e.enteredUsd] as const),
  );
  /** אמצעי פתוח שלא קיבל תשלום כלל — אי־אפשר «לסגור» אותו דרך עודף באמצעי אחר */
  const openUnpaidOtherMethod = openPlan.some((p) => {
    if (p.remainingUsd <= eps) return false;
    return (enteredMap.get(p.bucket) ?? 0) <= eps;
  });

  if (violations.length > 0) {
    // עודף אמיתי על האמצעי ששולם (למשל מזומן $120 על חוב $100) — לא חריגת אמצעי.
    // אבל אם נשאר אמצעי אחר פתוח שלא שולם — זו חריגה, לא העברת חוב.
    if (coversAllDebt && surplusUsd > eps && !openUnpaidOtherMethod) {
      return {
        kind: "SURPLUS_AFTER_CLOSURE",
        surplusUsd,
        totalDebtUsd,
        totalPaymentUsd,
      };
    }
    return { kind: "METHOD_DEVIATION" };
  }

  // עודף אמיתי בלבד: סכום התשלום גבוה מסך החוב הפתוח
  if (coversAllDebt && surplusUsd > eps) {
    return {
      kind: "SURPLUS_AFTER_CLOSURE",
      surplusUsd,
      totalDebtUsd,
      totalPaymentUsd,
    };
  }

  return { kind: "ALLOW" };
}
