import {
  enforceBreakdownAgainstEntered,
  PAYMENT_BUCKET_LABELS,
  type EnteredBucketUsd,
  type PaymentBucketKey,
  type PlannedBucketUsd,
} from "@/lib/payment-breakdown-shared";
import { roundMoney2 } from "@/lib/payment-intake";

export const PAYMENT_BUSINESS_EPS = 0.02;

export type PaymentBusinessDecisionCode =
  | "INVALID_METHODS"
  | "INVALID_TOTAL"
  | "USE_CREDIT"
  | "USE_COMMISSION"
  | "APPROVE_NEGATIVE_COMMISSION"
  | "CHOOSE_SURPLUS_DISPOSITION"
  | "MISSING_APPROVAL"
  | "READY";

export type PaymentMethodViolation = {
  bucket: PaymentBucketKey;
  label: string;
  plannedUsd: number;
  enteredUsd: number;
  excessUsd: number;
};

/**
 * כוונת קליטה — ההבחנה העסקית בין תשלום חלקי רגיל לניסיון סגירת מסמך.
 *
 * PARTIAL_PAYMENT — תשלום חלקי רגיל: נשמר כרגיל עם יתרה פתוחה,
 * ללא הפעלת מנגנון יתרת זכות / עמלות / עמלה שלילית.
 *
 * CLOSURE_ATTEMPT — ניסיון לסגור את המסמך: חובה לעבור את סולם הסגירה
 * (יתרת זכות → קיזוז עמלות → אישור עמלה שלילית) עד שהחוסר מטופל במלואו.
 */
export type SettlementIntent = "PARTIAL_PAYMENT" | "CLOSURE_ATTEMPT";

/**
 * הכלל הקנוני, היחיד במערכת, לקביעת כוונת הקליטה:
 *
 * הקליטה מסווגת CLOSURE_ATTEMPT כאשר מתקיים אחד מאלה:
 * 1. המשתמש ביקש סגירה מפורשת (איפוס יתרה, איפוס עמלה, סגירה עם עמלה) —
 *    `explicitClosureRequested`.
 * 2. אין חוסר — התשלום מכסה את מלוא החוב (או יותר). המסמך נסגר ממילא.
 * 3. קיים תכנון אמצעי תשלום, וקיים אמצעי ששולם *חלקית* — הוזן בו סכום
 *    חיובי אך קטן מהיתרה המתוכננת לאותו אמצעי. תשלום כזה מעיד שהלקוח
 *    ניסה לשלם את האמצעי אך חסר כסף (למשל: תוכנן אשראי $200, הוזן $195).
 *
 * בכל מקרה אחר הקליטה היא PARTIAL_PAYMENT — תשלום חלקי רגיל:
 * כל אמצעי ששולם, שולם במלואו לפי התכנון, ואמצעים שלא שולמו כלל
 * (הוזן 0) נשארים כיתרה פתוחה (למשל: "אני משלם היום רק את המזומן").
 *
 * מסמכים ללא תכנון אמצעים: אין ממה להסיק כוונת סגירה, ולכן חוסר נחשב
 * תשלום חלקי — סגירה מחייבת פעולה מפורשת של המשתמש.
 */
export function classifySettlementIntent(params: {
  plannedByMethod: PlannedBucketUsd[];
  enteredByMethod: EnteredBucketUsd[];
  totalDebtUsd: number;
  totalPaymentUsd: number;
  explicitClosureRequested?: boolean;
  eps?: number;
}): SettlementIntent {
  const eps = params.eps ?? PAYMENT_BUSINESS_EPS;
  if (params.explicitClosureRequested) return "CLOSURE_ATTEMPT";
  const shortageUsd = params.totalDebtUsd - params.totalPaymentUsd;
  if (shortageUsd <= eps) return "CLOSURE_ATTEMPT";
  if (params.plannedByMethod.length === 0) return "PARTIAL_PAYMENT";

  const planByBucket = new Map(params.plannedByMethod.map((p) => [p.bucket, p]));
  for (const entered of params.enteredByMethod) {
    if (!Number.isFinite(entered.enteredUsd) || entered.enteredUsd <= eps) continue;
    const plan = planByBucket.get(entered.bucket);
    // אמצעי שלא תוכנן נחסם קודם לכן ב-INVALID_METHODS — לא משפיע על הכוונה.
    if (!plan) continue;
    if (entered.enteredUsd < plan.remainingUsd - eps) return "CLOSURE_ATTEMPT";
  }
  return "PARTIAL_PAYMENT";
}

export type PaymentBusinessValidationInput = {
  plannedByMethod: PlannedBucketUsd[];
  enteredByMethod: EnteredBucketUsd[];
  totalDebtUsd: number;
  totalPaymentUsd: number;
  availableCreditUsd?: number;
  availableCommissionUsd?: number;
  /**
   * סגירה מפורשת שביקש המשתמש (איפוס יתרה / איפוס עמלה / סגירה עם עמלה).
   * הכוונה עצמה (חלקי מול סגירה) נקבעת ב-classifySettlementIntent — לא כאן.
   */
  explicitClosureRequested?: boolean;
  useCredit?: boolean;
  useCommission?: boolean;
  allowNegativeCommission?: boolean;
  /**
   * קליטת תשלום בשלב הראשון של זרימת save-first:
   * החוסר נשמר כחוב פתוח, והחלטת הסגירה נדחית לחלון הסיכום שלאחר השמירה.
   * כלל התאמת אמצעי התשלום וכללי העודף עדיין נאכפים לפני השמירה.
   */
  deferShortageResolution?: boolean;
  surplusDisposition?: "credit" | "commission" | "forfeit" | null;
  /**
   * העברות חוב בין אמצעי תשלום שאושרו במפורש ע״י המשתמש.
   * כשקיימות — מיושמות על התכנון לפני אכיפת אמצעי התשלום.
   */
  approvedDebtTransfers?: Array<{
    fromBucket: PaymentBucketKey;
    toBucket: PaymentBucketKey;
    amountUsd: number;
    fromLabel?: string;
    toLabel?: string;
  }> | null;
  requiredApprovalGranted?: boolean;
  eps?: number;
};

export type PaymentBusinessDecision = {
  code: PaymentBusinessDecisionCode;
  ok: boolean;
  message: string;
  settlementIntent: SettlementIntent;
  methodViolations: PaymentMethodViolation[];
  totalDebtUsd: number;
  totalPaymentUsd: number;
  creditAppliedUsd: number;
  commissionAppliedUsd: number;
  shortageUsd: number;
  surplusUsd: number;
};

function nonNegative(value: number): number {
  return roundMoney2(Number.isFinite(value) ? Math.max(0, value) : 0);
}

/** הודעת החסימה הקנונית לחריגת אמצעי תשלום — זהה בכל מסלולי הקליטה. */
export function paymentMethodMismatchMessage(violations: PaymentMethodViolation[]): string {
  const detail = violations
    .map((v) => `${v.label}: תוכנן $${v.plannedUsd.toFixed(2)}, הוזן $${v.enteredUsd.toFixed(2)}`)
    .join(" · ");
  return (
    "אמצעי התשלום שנקלטו אינם תואמים לאמצעי התשלום שתוכננו במסמך. " +
    "יש לעדכן את תכנון התשלום בהזמנה לפני ביצוע קליטת התשלום." +
    (detail ? ` (${detail})` : "")
  );
}

export function validatePaymentMethods(
  plannedRows: PlannedBucketUsd[],
  enteredRows: EnteredBucketUsd[],
  eps: number,
): PaymentMethodViolation[] {
  // מסמכים ישנים ללא תכנון מפורט נשארים ניתנים לקליטה.
  if (plannedRows.length === 0) return [];
  // אכיפה מול יתרות פתוחות בלבד — אמצעי נעול (remaining=0) אינו מקבל תשלום אוטומטי.
  const openRows = plannedRows
    .filter((p) => p.remainingUsd > eps)
    .map((p) => ({ ...p, plannedUsd: p.remainingUsd }));
  if (openRows.length === 0) {
    // אין אמצעים פתוחים — כל הזנה תיחשב חריגה (אלא אם אין הזנה).
    return enforceBreakdownAgainstEntered(
      plannedRows.map((p) => ({ ...p, remainingUsd: 0, plannedUsd: 0 })),
      enteredRows,
      eps,
    ).map((violation) => ({
      bucket: violation.bucket,
      label: PAYMENT_BUCKET_LABELS[violation.bucket],
      plannedUsd: violation.allowedUsd,
      enteredUsd: violation.enteredUsd,
      excessUsd: violation.excessUsd,
    }));
  }
  return enforceBreakdownAgainstEntered(openRows, enteredRows, eps).map((violation) => ({
    bucket: violation.bucket,
    label: PAYMENT_BUCKET_LABELS[violation.bucket],
    plannedUsd: violation.allowedUsd,
    enteredUsd: violation.enteredUsd,
    excessUsd: violation.excessUsd,
  }));
}

function applyApprovedTransfersToPlanned(
  plannedRows: PlannedBucketUsd[],
  transfers: NonNullable<PaymentBusinessValidationInput["approvedDebtTransfers"]>,
  eps: number,
): PlannedBucketUsd[] {
  if (!transfers || transfers.length === 0) return plannedRows;
  const map = new Map(plannedRows.map((p) => [p.bucket, { ...p }]));
  for (const t of transfers) {
    if (t.amountUsd <= eps) continue;
    const from = map.get(t.fromBucket);
    if (!from || from.remainingUsd <= eps) continue;
    const take = roundMoney2(Math.min(from.remainingUsd, t.amountUsd));
    from.remainingUsd = roundMoney2(from.remainingUsd - take);
    const to =
      map.get(t.toBucket) ??
      ({
        bucket: t.toBucket,
        label: t.toLabel ?? PAYMENT_BUCKET_LABELS[t.toBucket],
        plannedUsd: 0,
        remainingUsd: 0,
      } satisfies PlannedBucketUsd);
    to.remainingUsd = roundMoney2(to.remainingUsd + take);
    to.plannedUsd = roundMoney2(Math.max(to.plannedUsd, to.remainingUsd));
    map.set(t.fromBucket, from);
    map.set(t.toBucket, to);
  }
  return [...map.values()];
}

/**
 * מקור אמת יחיד להחלטה אם קליטת תשלום רשאית להגיע ל-FIFO ולשמירה.
 *
 * סדר החוקים קבוע:
 * אמצעי תשלום → סכום כולל → חוסר → יתרת זכות → עמלות →
 * עמלה שלילית → עודף → אישורים → READY.
 */
export function evaluatePaymentBusinessRules(
  input: PaymentBusinessValidationInput,
): PaymentBusinessDecision {
  const eps = input.eps ?? PAYMENT_BUSINESS_EPS;
  const totalDebtUsd = nonNegative(input.totalDebtUsd);
  const totalPaymentUsd = nonNegative(input.totalPaymentUsd);
  // אין העברת חוב בין אמצעים — אכיפה מול התכנון המקורי בלבד.
  // שינוי אמצעי מתוכנן נעשה במסך «אמצעי תשלום מתוכננים», לא בזמן קליטה.
  // approvedDebtTransfers נשאר בטיפוס לתאימות לאחור אך אינו מיושם.
  const plannedRows = input.plannedByMethod;
  const violations = validatePaymentMethods(plannedRows, input.enteredByMethod, eps);

  const settlementIntent = classifySettlementIntent({
    plannedByMethod: plannedRows,
    enteredByMethod: input.enteredByMethod,
    totalDebtUsd,
    totalPaymentUsd,
    explicitClosureRequested: input.explicitClosureRequested,
    eps,
  });

  const result = (
    code: PaymentBusinessDecisionCode,
    message: string,
    values: Partial<
      Pick<
        PaymentBusinessDecision,
        "creditAppliedUsd" | "commissionAppliedUsd" | "shortageUsd" | "surplusUsd"
      >
    > = {},
  ): PaymentBusinessDecision => ({
    code,
    ok: code === "READY",
    message,
    settlementIntent,
    methodViolations: violations,
    totalDebtUsd,
    totalPaymentUsd,
    creditAppliedUsd: values.creditAppliedUsd ?? 0,
    commissionAppliedUsd: values.commissionAppliedUsd ?? 0,
    shortageUsd: values.shortageUsd ?? 0,
    surplusUsd: values.surplusUsd ?? 0,
  });

  // חריגת אמצעי — חסימה תמיד. אין «העברת חוב» ואין עקיפה בעודף.
  if (violations.length > 0) {
    return result("INVALID_METHODS", paymentMethodMismatchMessage(violations));
  }

  if (totalPaymentUsd <= eps) {
    return result("INVALID_TOTAL", "יש להזין סכום תשלום תקין");
  }

  let shortageUsd = roundMoney2(Math.max(0, totalDebtUsd - totalPaymentUsd));
  const surplusUsd = roundMoney2(Math.max(0, totalPaymentUsd - totalDebtUsd));
  let creditAppliedUsd = 0;
  let commissionAppliedUsd = 0;
  // סולם הסגירה (זכות → עמלות → עמלה שלילית) מופעל אך ורק בניסיון סגירה.
  const mustSettleShortage =
    settlementIntent === "CLOSURE_ATTEMPT" && !input.deferShortageResolution;

  if (shortageUsd > eps) {
    const availableCreditUsd = nonNegative(input.availableCreditUsd ?? 0);
    if (mustSettleShortage && availableCreditUsd > eps && !input.useCredit) {
      return result("USE_CREDIT", "קיימת יתרת זכות זמינה. יש לבחור אם להשתמש בה לפני המשך הקליטה.", {
        shortageUsd,
      });
    }
    if (input.useCredit) {
      creditAppliedUsd = roundMoney2(Math.min(shortageUsd, availableCreditUsd));
      shortageUsd = roundMoney2(Math.max(0, shortageUsd - creditAppliedUsd));
    }
  }

  if (shortageUsd > eps) {
    const availableCommissionUsd = nonNegative(input.availableCommissionUsd ?? 0);
    if (mustSettleShortage && availableCommissionUsd > eps && !input.useCommission) {
      return result("USE_COMMISSION", "לאחר קיזוז יתרת הזכות נשאר חוסר. יש לבחור אם לקזז אותו מעמלות.", {
        creditAppliedUsd,
        shortageUsd,
      });
    }
    if (input.useCommission) {
      commissionAppliedUsd = roundMoney2(Math.min(shortageUsd, availableCommissionUsd));
      shortageUsd = roundMoney2(Math.max(0, shortageUsd - commissionAppliedUsd));
    }
  }

  if (mustSettleShortage && shortageUsd > eps && !input.allowNegativeCommission) {
    return result(
      "APPROVE_NEGATIVE_COMMISSION",
      "אין מספיק יתרת זכות או עמלות לסגירת החוסר. נדרש אישור לעמלה שלילית.",
      { creditAppliedUsd, commissionAppliedUsd, shortageUsd },
    );
  }

  if (surplusUsd > eps && !input.surplusDisposition) {
    return result(
      "CHOOSE_SURPLUS_DISPOSITION",
      `קיים עודף של $${surplusUsd.toFixed(2)}. יש לבחור: יתרת זכות ללקוח או העברה לעמלות.`,
      { creditAppliedUsd, commissionAppliedUsd, shortageUsd, surplusUsd },
    );
  }

  // אישור מורשה נדרש רק לעמלה שלילית — הוספת עודף לעמלות מותרת לכל מקבל תשלומים.
  if (input.allowNegativeCommission && input.requiredApprovalGranted === false) {
    return result("MISSING_APPROVAL", "נדרש אישור משתמש מורשה להשלמת הפעולה.", {
      creditAppliedUsd,
      commissionAppliedUsd,
      shortageUsd,
      surplusUsd,
    });
  }

  return result("READY", "כל חוקי קליטת התשלום עברו בהצלחה.", {
    creditAppliedUsd,
    commissionAppliedUsd,
    shortageUsd,
    surplusUsd,
  });
}
