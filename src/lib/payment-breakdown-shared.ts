/**
 * "תשלום מורכב" — הגדרת חלוקת תשלום של הזמנה בין מספר אמצעי תשלום.
 * בטוח לייבוא מ-client ומ-server (ללא prisma / server-only).
 *
 * הסכמן (sentinel) COMPOSITE_PM נשמר ב-Order.paymentMethod כדי לסמן שההזמנה
 * מחולקת בין כמה אמצעים. החלוקה עצמה נשמרת בטבלת OrderPaymentBreakdown.
 */

export const COMPOSITE_PM = "COMPOSITE";

export const COMPOSITE_PM_LABEL = "תשלום מורכב";

/** סבילות השוואת סכומים (USD) — מונע חסימת שמירה בגלל עיגול */
export const BREAKDOWN_EPS = 0.01;

export type BreakdownCurrency = "USD" | "ILS";

/** שורת חלוקה כפי שהיא מוצגת/נשלחת מה-UI */
export type OrderBreakdownLineInput = {
  paymentMethod: string;
  /** סכום במטבע של currency */
  amount: string;
  currency: BreakdownCurrency;
};

export function isCompositePaymentMethod(method: string | null | undefined): boolean {
  return (method ?? "").trim().toUpperCase() === COMPOSITE_PM;
}

/** ממיר סכום שורה ל-USD לפי שער (₪ ל-$). מחזיר null אם לא תקין. */
export function breakdownLineUsd(
  line: { amount: string; currency: BreakdownCurrency },
  nisPerUsd: number,
): number | null {
  const raw = (line.amount || "").trim().replace(",", ".");
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (line.currency === "ILS") {
    if (!Number.isFinite(nisPerUsd) || nisPerUsd <= 0) return null;
    return n / nisPerUsd;
  }
  return n;
}

export type BreakdownValidation = {
  /** סכום החלוקה ב-USD */
  sumUsd: number;
  /** הפרש מול סך ההזמנה (חיובי = עודף, שלילי = חסר) */
  diffUsd: number;
  /** האם תקין לשמירה (סכום תואם + לפחות שורה אחת תקינה) */
  ok: boolean;
  /** מספר שורות תקינות */
  validCount: number;
};

/** אמצעי תשלום + סכום ב-USD (לזיהוי חריגות מתוכנן מול בפועל) */
export type MethodAmountUsd = { method: string; usd: number };

export type OrderMethodDeviation = {
  /** האם שולם באמצעי ששונה מהמתוכנן */
  hasDeviation: boolean;
  /** סכום USD ששולם באמצעי שלא תוכנן (מעבר למתוכנן לאותו אמצעי) */
  deviationUsd: number;
};

/**
 * חריגת אמצעי תשלום: השוואת המתוכנן (OrderPaymentBreakdown) מול בפועל (Payment).
 * חריגה = שולם באמצעי כלשהו יותר ממה שתוכנן לאותו אמצעי (כולל אמצעי שלא תוכנן כלל).
 * לא נועלת את המשתמש — רק מסמנת ומאפשרת בקרה.
 */
export function computeOrderMethodDeviation(
  planned: MethodAmountUsd[],
  actual: MethodAmountUsd[],
  eps = 0.02,
): OrderMethodDeviation {
  const plannedMap = new Map<string, number>();
  for (const p of planned) plannedMap.set(p.method, (plannedMap.get(p.method) ?? 0) + p.usd);
  let deviationUsd = 0;
  for (const a of actual) {
    if (a.usd <= 0) continue;
    const plan = plannedMap.get(a.method) ?? 0;
    if (a.usd > plan + eps) deviationUsd += a.usd - plan;
  }
  deviationUsd = Math.round(deviationUsd * 100) / 100;
  return { hasDeviation: deviationUsd > eps, deviationUsd };
}

/** קבוצת אמצעי תשלום מנורמלת (לבקרה מול חלוקה מתוכננת) */
export type PaymentBucketKey = "CASH" | "BANK_TRANSFER" | "CREDIT" | "CHECK" | "OTHER";

export const PAYMENT_BUCKET_LABELS: Record<PaymentBucketKey, string> = {
  CASH: "מזומן",
  BANK_TRANSFER: "העברה בנקאית",
  CREDIT: "אשראי",
  CHECK: "צ׳יקים",
  OTHER: "אחר",
};

/** ממפה אמצעי תשלום (קטלוג/Prisma) לקבוצת בקרה אחידה */
export function paymentMethodBucketKey(method: string | null | undefined): PaymentBucketKey {
  const m = (method ?? "").trim().toUpperCase();
  if (m === "CASH") return "CASH";
  if (m === "BANK_TRANSFER" || m === "TRANSFER" || m === "BANK") return "BANK_TRANSFER";
  if (m === "CREDIT" || m === "CREDIT_CARD" || m === "CARD") return "CREDIT";
  if (m === "CHECK" || m === "CHECKS" || m === "CHEQUE") return "CHECK";
  return "OTHER";
}

/** חלוקה מתוכננת לקבוצה (USD) — מתוכנן + מה שנותר לתשלום באמצעי זה */
export type PlannedBucketUsd = {
  bucket: PaymentBucketKey;
  label: string;
  plannedUsd: number;
  /** נותר מותר לתשלום באמצעי זה (מתוכנן − ששולם בפועל) */
  remainingUsd: number;
};

/** סכום שהוזן בטופס לקבוצה (USD, כולל המרת שקל) */
export type EnteredBucketUsd = {
  bucket: PaymentBucketKey;
  label: string;
  enteredUsd: number;
};

export type BreakdownEnforcementViolation = {
  bucket: PaymentBucketKey;
  label: string;
  /** "not-planned" = אמצעי שלא הוגדר בהזמנה · "excess" = חריגה מהסכום שהוגדר */
  type: "not-planned" | "excess";
  enteredUsd: number;
  plannedUsd: number;
  /** נותר מותר (מתוכנן − ששולם) */
  allowedUsd: number;
  /** חריגה = הוזן − מותר (>0) */
  excessUsd: number;
};

function round2pos(n: number): number {
  const r = Math.round(n * 100) / 100;
  return r < 0 ? 0 : r;
}

/**
 * בקרת "תשלום מורכב" — אכיפה אמיתית:
 * אסור לשלם באמצעי שלא הוגדר בחלוקה, ואסור לחרוג מהסכום שהוגדר לכל אמצעי.
 * מחזיר רשימת חריגות (ריק = תקין לשמירה).
 */
export function enforceBreakdownAgainstEntered(
  planned: PlannedBucketUsd[],
  entered: EnteredBucketUsd[],
  eps = 0.02,
): BreakdownEnforcementViolation[] {
  const planMap = new Map<PaymentBucketKey, PlannedBucketUsd>();
  for (const p of planned) planMap.set(p.bucket, p);

  const violations: BreakdownEnforcementViolation[] = [];
  for (const e of entered) {
    if (!Number.isFinite(e.enteredUsd) || e.enteredUsd <= eps) continue;
    const plan = planMap.get(e.bucket);
    if (!plan || plan.plannedUsd <= eps) {
      violations.push({
        bucket: e.bucket,
        label: e.label,
        type: "not-planned",
        enteredUsd: round2pos(e.enteredUsd),
        plannedUsd: 0,
        allowedUsd: 0,
        excessUsd: round2pos(e.enteredUsd),
      });
      continue;
    }
    if (e.enteredUsd > plan.remainingUsd + eps) {
      violations.push({
        bucket: e.bucket,
        label: e.label,
        type: "excess",
        enteredUsd: round2pos(e.enteredUsd),
        plannedUsd: round2pos(plan.plannedUsd),
        allowedUsd: round2pos(plan.remainingUsd),
        excessUsd: round2pos(e.enteredUsd - plan.remainingUsd),
      });
    }
  }
  return violations;
}

/** טקסט שגיאה ידידותי לחריגה בודדת */
export function breakdownViolationMessage(v: BreakdownEnforcementViolation): string {
  if (v.type === "not-planned") {
    return `${v.label} לא הוגדר בהזמנה.\n${v.label} שהוזן: $${v.enteredUsd.toFixed(2)}`;
  }
  return `${v.label} בהזמנה: $${v.allowedUsd.toFixed(2)}\n${v.label} שהוזן: $${v.enteredUsd.toFixed(2)}\nחריגה: $${v.excessUsd.toFixed(2)}`;
}

/** מאמת את חלוקת התשלום מול סך ההזמנה ב-USD */
export function validateBreakdown(
  lines: OrderBreakdownLineInput[],
  payableTotalUsd: number,
  nisPerUsd: number,
): BreakdownValidation {
  let sumUsd = 0;
  let validCount = 0;
  for (const line of lines) {
    const usd = breakdownLineUsd(line, nisPerUsd);
    if (usd == null) continue;
    if (!line.paymentMethod || isCompositePaymentMethod(line.paymentMethod)) continue;
    sumUsd += usd;
    validCount += 1;
  }
  sumUsd = Math.round(sumUsd * 100) / 100;
  const diffUsd = Math.round((sumUsd - payableTotalUsd) * 100) / 100;
  const ok = validCount >= 1 && Math.abs(diffUsd) <= BREAKDOWN_EPS;
  return { sumUsd, diffUsd, ok, validCount };
}
