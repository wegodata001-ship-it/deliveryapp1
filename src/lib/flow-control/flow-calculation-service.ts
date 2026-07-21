/**
 * בקרת תזרים — כל החישובים העסקיים במקום אחד בלבד.
 * אסור לבצע חישובים ב-React או ב-UI — רק כאן.
 */

import { CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";
import {
  paymentMethodBucketKey,
  type PaymentBucketKey,
} from "@/lib/payment-breakdown-shared";
import type { CashDailyMethodId, CashDailyIntakeTotals } from "@/lib/cash-control-daily";
import { emptyDailyIntake, resolveChannelFromPaymentBucket, sumIlsChannelIntake } from "@/lib/cash-control-daily";
import type {
  FxProfitLossSummary,
  FxPurchaseIntakeAllocation,
  FxPurchaseRecord,
  FxPurchaseTrack,
  FxProfitLossHistoryRow,
  TurkeyDebtResult,
  FlowWeekKpiCards,
} from "@/app/admin/cash-flow/flow-types";

export type FlowPaymentVatFields = {
  id?: string;
  paymentCode?: string | null;
  amountIls: { toString(): string } | null;
  amountUsd: { toString(): string } | null;
  paymentMethod: string | null;
  usdPaymentMethod: string | null;
  ilsPaymentMethod: string | null;
  exchangeRate?: { toString(): string } | null;
  methodAllocations?: Array<{
    method: string;
    currency: string;
    sourceAmount: { toString(): string };
  }>;
  amountWithoutVat?: { toString(): string } | null;
  totalIlsWithoutVat?: { toString(): string } | null;
  totalIlsWithVat?: { toString(): string } | null;
};

/** מפתח קיבוץ קליטה — paymentCode משותף לשורות FIFO של אותה שמירה */
export function paymentIntakeCaptureKey(p: {
  id?: string;
  paymentCode?: string | null;
}): string {
  const code = (p.paymentCode ?? "").trim();
  if (code) return `code:${code}`;
  if (p.id) return `id:${p.id}`;
  return "row:unknown";
}

/** האם לרשום את השורה באגרגציית ערוצים (מדלג על אחים כשיש methodAllocations) */
export function shouldContributePaymentToFlowIntake(
  p: FlowPaymentVatFields,
  captureKeysWithAllocations: Set<string>,
): boolean {
  const key = paymentIntakeCaptureKey(p);
  const hasAlloc = (p.methodAllocations?.length ?? 0) > 0;
  if (captureKeysWithAllocations.has(key) && !hasAlloc) return false;
  return true;
}

function captureKeysWithMethodAllocations(payments: FlowPaymentVatFields[]): Set<string> {
  const keys = new Set<string>();
  for (const p of payments) {
    if ((p.methodAllocations?.length ?? 0) > 0) {
      keys.add(paymentIntakeCaptureKey(p));
    }
  }
  return keys;
}

/**
 * סה״כ התקבל ב₪ משורת קליטה בודדת (או מקבוצת methodAllocations).
 * מקור: קליטת תשלום בלבד — לא הזמנות / יתרות / ספירת קופה.
 */
export function paymentRowReceivedIls(p: FlowPaymentVatFields): number {
  const structured = contributionsFromStructuredMethods(p);
  const rate = num(p.exchangeRate);
  if (structured) {
    let total = 0;
    for (const c of structured) {
      if (c.column.endsWith("_USD")) {
        total += rate > 0 ? c.amount * rate : 0;
      } else {
        total += c.amount;
      }
    }
    return round2(total);
  }

  const ilsFactor = ilsExVatFactor(p);
  const ilsGross = num(p.amountIls);
  const usdAmt = num(p.amountUsd);
  let total = 0;
  if (ilsGross > CASH_CONTROL_EPS) total += ilsGross * ilsFactor;
  if (usdAmt > CASH_CONTROL_EPS && rate > 0) total += usdAmt * rate;
  if (total <= CASH_CONTROL_EPS && num(p.totalIlsWithoutVat) > 0) {
    return round2(num(p.totalIlsWithoutVat));
  }
  return round2(total);
}

/**
 * סה״כ התקבל (₪) — סכום כל קליטות התשלום שנשמרו בפועל.
 * כולל מזומן/העברה/אשראי/צ'קים/אחר ב־₪ וב־$ (דולר מומר לפי שער הקליטה).
 */
export function computePaymentsTotalReceivedIls(payments: FlowPaymentVatFields[]): number {
  const withAlloc = captureKeysWithMethodAllocations(payments);
  let total = 0;
  for (const p of payments) {
    if (!shouldContributePaymentToFlowIntake(p, withAlloc)) continue;
    total += paymentRowReceivedIls(p);
  }
  return round2(total);
}

export type FlowWeekCalculationInput = {
  countedCashUsd: number;
  countedCashIls: number;
  expensesIls: number;
  commissionUsd: number;
  /** סכום העברות בפועל לטורקיה בשבוע — לא הקצאה מספירה */
  actualTurkeyTransfersUsd: number;
  fxPurchases: FxPurchaseRecord[];
  bankWithdrawalsIls?: number;
  bankDepositsIls?: number;
  /** הקצאות בנק לרכישת מט״ח IL */
  countedTransferIls?: number;
  countedCreditIls?: number;
  countedChecksIls?: number;
  /** סה״כ תקבולים ₪ מקליטת תשלום */
  totalReceiptsIls?: number;
  /** תקבולי בנק ₪ (העברה+אשראי+צ'קים) מקליטת תשלום */
  bankReceiptsIls?: number;
};

export type FlowWeekCalculationResult = {
  fxTotals: { ils: number; usd: number };
  availableIlsForFx: number;
  cashUsdInDrawer: number;
  cashIlsInDrawer: number;
  bankBalanceIls: number;
  /** רכישת מט״ח IL = העברות+צ'קים+אשראי */
  ilFxPurchaseIls: number;
  /** שקל שנשאר = תקבולים − FX PS − FX IL */
  ilsRemainingAfterFx: number;
  turkey: TurkeyDebtResult;
  fxProfitLoss: FxProfitLossSummary;
  fxProfitLossHistory: FxProfitLossHistoryRow[];
};

export type TurkeyDebtInput = {
  countedCashUsd: number;
  fxUsdTotal: number;
  commissionUsd: number;
  turkeyTransferUsd: number;
};

export type FlowWeekKpiInput = {
  totalReceivedIls: number;
  fxTotals: { ils: number; usd: number };
  turkeyTransferUsd: number;
  cashIlsInDrawer: number;
  cashUsdInDrawer: number;
  bankBalanceIls: number;
  fxProfitLoss: FxProfitLossSummary;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(v: { toString(): string } | null | undefined): number {
  const n = Number(v?.toString() ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function bucketToMethod(bucket: PaymentBucketKey, side: "ILS" | "USD"): CashDailyMethodId | null {
  return resolveChannelFromPaymentBucket(bucket, side);
}

/** גורם ניטרול מע״מ לקליטה — סכומי ₪ מוצגים ללא מע״מ */
export function ilsExVatFactor(p: FlowPaymentVatFields): number {
  const grossIls = num(p.amountIls);
  if (grossIls <= CASH_CONTROL_EPS) return 1;
  const net =
    num(p.totalIlsWithoutVat) > 0
      ? num(p.totalIlsWithoutVat)
      : num(p.amountWithoutVat) > 0
        ? num(p.amountWithoutVat)
        : grossIls;
  if (net <= 0 || net > grossIls + 0.01) return 1;
  return net / grossIls;
}

function contributionsFromStructuredMethods(
  p: FlowPaymentVatFields,
): Array<{ column: CashDailyMethodId; amount: number }> | null {
  const parts = p.methodAllocations ?? [];
  if (parts.length === 0) return null;

  const ilsFactor = ilsExVatFactor(p);
  const out: Array<{ column: CashDailyMethodId; amount: number }> = [];
  for (const part of parts) {
    const side = part.currency === "USD" ? "USD" : "ILS";
    const col = bucketToMethod(paymentMethodBucketKey(part.method), side);
    if (!col) continue;
    const sourceAmount = num(part.sourceAmount);
    const amount = side === "ILS" ? round2(sourceAmount * ilsFactor) : sourceAmount;
    out.push({ column: col, amount });
  }
  return out.length > 0 ? out : null;
}

/** מפצל קליטה לעמודות טבלת בקרת תזרים — סכומי ₪ ללא מע״מ */
export function getFlowPaymentContributions(
  p: FlowPaymentVatFields,
): Array<{ column: CashDailyMethodId; amount: number }> {
  const structured = contributionsFromStructuredMethods(p);
  if (structured) return structured;

  const out: Array<{ column: CashDailyMethodId; amount: number }> = [];
  const ilsFactor = ilsExVatFactor(p);
  const ilsGross = num(p.amountIls);
  const usdAmt = num(p.amountUsd);

  if (ilsGross > CASH_CONTROL_EPS) {
    const method = (p.ilsPaymentMethod ?? p.paymentMethod ?? "").trim();
    if (method) {
      const col = bucketToMethod(paymentMethodBucketKey(method), "ILS");
      if (col) out.push({ column: col, amount: round2(ilsGross * ilsFactor) });
    }
  }

  if (usdAmt > CASH_CONTROL_EPS) {
    const method = (p.usdPaymentMethod || p.paymentMethod || "").trim();
    if (method) {
      const col = bucketToMethod(paymentMethodBucketKey(method), "USD");
      if (col) out.push({ column: col, amount: usdAmt });
    }
  }

  return out;
}

export function paymentAmountForFlowColumn(p: FlowPaymentVatFields, column: CashDailyMethodId): number {
  return getFlowPaymentContributions(p)
    .filter((c) => c.column === column)
    .reduce((s, c) => s + c.amount, 0);
}

export function paymentMatchesFlowColumn(p: FlowPaymentVatFields, column: CashDailyMethodId): boolean {
  return paymentAmountForFlowColumn(p, column) > CASH_CONTROL_EPS;
}

export function aggregateFlowIntakesByDay(
  payments: Array<FlowPaymentVatFields & { paymentDate: Date | string | null; createdAt: Date | string }>,
  dayKey: (p: {
    intakeDate?: Date | string | null;
    paymentDate: Date | string | null;
    createdAt: Date | string;
  }) => string,
): Map<string, CashDailyIntakeTotals> {
  const withAlloc = captureKeysWithMethodAllocations(payments);
  const map = new Map<string, CashDailyIntakeTotals>();
  for (const p of payments) {
    if (!shouldContributePaymentToFlowIntake(p, withAlloc)) continue;
    const day = dayKey(p);
    let totals = map.get(day);
    if (!totals) {
      totals = emptyDailyIntake();
      map.set(day, totals);
    }
    for (const c of getFlowPaymentContributions(p)) {
      totals[c.column] = round2(totals[c.column] + c.amount);
    }
  }
  return map;
}

/**
 * תקבולי ₪ לערוצי שקל בלבד — לחישוב «שקל זמין לרכישת מט״ח».
 * לא כולל מזומן $ / אשראי $ וכו׳.
 */
export function computeIlsChannelReceiptsFromIntake(intake: CashDailyIntakeTotals): number {
  return sumIlsChannelIntake(intake);
}

/**
 * @deprecated העדף computePaymentsTotalReceivedIls(payments) — מקור אמת: קליטות תשלום.
 * נשמר לתאימות: סכום ערוצי ₪ באגרגציה יומית (ללא המרת $).
 */
export function computeWeekTotalReceivedIls(intake: CashDailyIntakeTotals): number {
  return computeIlsChannelReceiptsFromIntake(intake);
}

export function normalizeFxTrack(raw: unknown): FxPurchaseTrack {
  return String(raw ?? "").trim().toUpperCase() === "IL" ? "IL" : "PS";
}

export function filterFxPurchasesByTrack(
  records: FxPurchaseRecord[],
  track: FxPurchaseTrack,
): FxPurchaseRecord[] {
  return records.filter((r) => normalizeFxTrack(r.track) === track);
}

/** סיכום רכישות מט״ח — אופציונלית לפי מסלול PS / IL בלבד (ללא איחוד) */
export function sumFxPurchases(
  records: FxPurchaseRecord[],
  track?: FxPurchaseTrack,
): { ils: number; usd: number } {
  let ils = 0;
  let usd = 0;
  for (const r of records) {
    if (track && normalizeFxTrack(r.track) !== track) continue;
    ils += r.ilsAmount;
    usd += r.usdReceived;
  }
  return { ils: round2(ils), usd: round2(usd) };
}

/** דולר שהתקבל מרכישת מט״ח = סכום ₪ / שער */
export function computeFxUsdReceived(ilsAmount: number, rate: number): number {
  if (ilsAmount <= 0 || rate <= 0) return 0;
  return round2(ilsAmount / rate);
}

/**
 * זמין לרכישת מט״ח PS = מזומן ₪ PS − רכישות מט״ח PS בלבד.
 * אסור להחסיר כאן רכישות IL.
 */
export function computePsAvailableIlsForFx(
  countedCashIls: number,
  fxPurchases: FxPurchaseRecord[],
): number {
  const spent = sumFxPurchases(fxPurchases, "PS").ils;
  return Math.max(0, round2(Math.max(0, countedCashIls) - spent));
}

/**
 * זמין לרכישת מט״ח IL = מאגר IL (העברות+אשראי+צ'קים) − רכישות מט״ח IL בלבד.
 * אסור להחסיר כאן רכישות PS / מזומן PS.
 */
export function computeIlAvailableIlsForFx(
  countedTransferIls: number,
  countedCreditIls: number,
  countedChecksIls: number,
  fxPurchases: FxPurchaseRecord[],
): number {
  const pool = computeIlSourcePoolIls(countedTransferIls, countedCreditIls, countedChecksIls);
  const spent = sumFxPurchases(fxPurchases, "IL").ils;
  return Math.max(0, round2(pool - spent));
}

/**
 * @deprecated העדף computePsAvailableIlsForFx — מסלול PS בלבד.
 */
export function computeAvailableIlsForFx(
  managerCashIls: number,
  expensesIls: number,
  fxPurchases: FxPurchaseRecord[],
): number {
  void expensesIls;
  return computePsAvailableIlsForFx(managerCashIls, fxPurchases);
}

/** יתרת שקלים אחרי רכישה */
export function computeFxRemainderAfterPurchase(availableIls: number, ilsAmount: number): number {
  return Math.max(0, round2(availableIls - ilsAmount));
}

/** בדיקת חלוקת יתרה: נשאר בקופה + הועבר לבנק = יתרת שקלים */
export function validateFxRemainderSplit(
  remainderCashIls: number,
  remainderBankIls: number,
  remainderAfter: number,
): boolean {
  return Math.abs(round2(remainderCashIls + remainderBankIls) - remainderAfter) <= 0.02;
}

/**
 * דולר בקופה PS = דולר PS + רכישות מט״ח PS − העברות בפועל לטורקיה (USD)
 * רכישות IL לא נכנסות לכאן.
 */
export function computeCashUsdInDrawer(
  countedCashUsd: number,
  fxPurchases: FxPurchaseRecord[],
  actualTurkeyTransfersUsd: number,
): number {
  const fxUsd = sumFxPurchases(fxPurchases, "PS").usd;
  return round2(countedCashUsd + fxUsd - actualTurkeyTransfersUsd);
}

/**
 * שקל בקופה PS = שקל PS − הוצאות − רכישות מט״ח PS − יתרות שהועברו לבנק מ־PS
 */
export function computeCashIlsInDrawer(
  countedCashIls: number,
  expensesIls: number,
  fxPurchases: FxPurchaseRecord[],
): number {
  const ps = filterFxPurchasesByTrack(fxPurchases, "PS");
  const fxIls = sumFxPurchases(ps, "PS").ils;
  const bankFromRemainder = ps.reduce((s, p) => s + p.remainderBankIls, 0);
  return round2(countedCashIls - expensesIls - fxIls - bankFromRemainder);
}

/**
 * יתרה בבנק = יתרות מ־רכישות IL שהועברו לבנק − משיכות + הפקדות
 * (מסלול בנקאי — לא מזומן PS)
 */
export function computeBankBalanceIls(
  fxPurchases: FxPurchaseRecord[],
  bankWithdrawalsIls = 0,
  bankDepositsIls = 0,
): number {
  const il = filterFxPurchasesByTrack(fxPurchases, "IL");
  const transfersToBank = il.reduce((s, p) => s + p.remainderBankIls, 0);
  return round2(transfersToBank - bankWithdrawalsIls + bankDepositsIls);
}

/**
 * העברה לטורקיה (מסלול PS) =
 * דולר שהיה בקופה + רכישת מט״ח PS ($) + עמלת PS
 *
 * מסלול PS נפרד לחלוטין ממסלול IL — אין איחוד חישובים.
 */
export function computeTurkeyAllocationFromCashCount(
  countedCashUsd: number,
  fxUsdTotal: number,
  commissionUsd: number,
): number {
  return Math.max(
    0,
    round2(Math.max(0, countedCashUsd) + Math.max(0, fxUsdTotal) + Math.max(0, commissionUsd)),
  );
}

/** @deprecated — השתמש ב-computeTurkeyAllocationFromCashCount */
export const computeTurkeyExpectedUsd = computeTurkeyAllocationFromCashCount;

/**
 * מאגר כספי IL לספירה (מקור בלבד) =
 * העברות + אשראי + צ'קים
 * אינו רכישת מט״ח — רכישות IL הן רשומות fxPurchases עם track=IL.
 */
export function computeIlSourcePoolIls(
  countedTransferIls: number,
  countedCreditIls: number,
  countedChecksIls: number,
): number {
  return round2(
    Math.max(0, countedTransferIls) + Math.max(0, countedCreditIls) + Math.max(0, countedChecksIls),
  );
}

/**
 * @deprecated השם הישן ל־מאגר IL. העדף computeIlSourcePoolIls.
 * לא מייצג רכישות מט״ח שבוצעו — רק את מאגר המקור.
 */
export function computeIlFxPurchaseIls(
  countedTransferIls: number,
  countedCreditIls: number,
  countedChecksIls: number,
): number {
  return computeIlSourcePoolIls(countedTransferIls, countedCreditIls, countedChecksIls);
}

/**
 * העברה לטורקיה (מסלול IL) =
 * רכישת מט״ח IL (₪) + עמלת IL (₪)
 *
 * מסלול בנקאי — ללא מזומן קופה. לא מתערבב עם מסלול PS.
 */
export function computeTurkeyIlAllocationIls(
  ilFxPurchaseIls: number,
  commissionIls: number,
): number {
  return Math.max(0, round2(Math.max(0, ilFxPurchaseIls) + Math.max(0, commissionIls)));
}

/** @deprecated — השם הישן; השתמש ב-computeIlFxPurchaseIls */
export const computeBankPsTransferIls = computeIlFxPurchaseIls;

/** יתרת מסלול PS ₪ = מזומן PS − רכישות מט״ח PS */
export function computePsRemainingIls(psCashIls: number, fxPsIls: number): number {
  return round2(Math.max(0, psCashIls) - Math.max(0, fxPsIls));
}

/** יתרת מסלול IL ₪ = מאגר IL − רכישות מט״ח IL */
export function computeIlRemainingIls(ilPoolIls: number, fxIlIls: number): number {
  return round2(Math.max(0, ilPoolIls) - Math.max(0, fxIlIls));
}

/**
 * @deprecated איחוד PS+IL אסור עסקית. העדף computePsRemainingIls / computeIlRemainingIls.
 * נשמר לתאימות בדיקות ישנות בלבד.
 */
export function computeIlsRemainingAfterFx(
  totalReceiptsIls: number,
  fxPsIls: number,
  fxIlIls: number,
): number {
  return round2(totalReceiptsIls - Math.max(0, fxPsIls) - Math.max(0, fxIlIls));
}

/**
 * יתרה בקופה (מזומן) — תאימות לאחור.
 * @deprecated השתמש ב-computeWeekIlsBalanceAfterOps (מקור אמת מלא).
 */
export function computeCashDrawerIlsAfterPsFx(
  countedCashIls: number,
  expensesIls: number,
  fxPsIls: number,
): number {
  return round2(countedCashIls - Math.max(0, expensesIls) - Math.max(0, fxPsIls));
}

/**
 * יתרת שקלים אחרי כל הפעולות — מקור אמת לתצוגת «יתרה בקופה ₪».
 *
 * תקבולים ₪ − הוצאות − רכישת מט״ח PS − רכישת מט״ח IL − משיכות בנק + הפקדות בנק
 *
 * לא תלוי בספירת מנהל בלבד (שגרמה ליתרות שליליות שגויות כשרכישת מט״ח
 * מומנה מתקבולים רחבים יותר מהמזומן שנספר).
 */
export function computeWeekIlsBalanceAfterOps(params: {
  totalReceiptsIls: number;
  expensesIls: number;
  fxPsIls: number;
  fxIlIls: number;
  bankWithdrawalsIls?: number;
  bankDepositsIls?: number;
}): number {
  return round2(
    Math.max(0, params.totalReceiptsIls) -
      Math.max(0, params.expensesIls) -
      Math.max(0, params.fxPsIls) -
      Math.max(0, params.fxIlIls) -
      Math.max(0, params.bankWithdrawalsIls ?? 0) +
      Math.max(0, params.bankDepositsIls ?? 0),
  );
}

/**
 * יתרה בבנק =
 * תקבולי בנק (העברה+אשראי+צ'קים) − רכישת מט״ח IL − משיכות + הפקדות
 */
export function computeBankBalanceAfterIlFx(
  bankReceiptsIls: number,
  ilFxPurchaseIls: number,
  bankWithdrawalsIls = 0,
  bankDepositsIls = 0,
): number {
  return round2(
    bankReceiptsIls - Math.max(0, ilFxPurchaseIls) - bankWithdrawalsIls + bankDepositsIls,
  );
}

/** תקבולי בנק ₪ מקליטה — העברה + אשראי + צ'קים */
export function computeBankReceiptsIlsFromIntake(intake: CashDailyIntakeTotals): number {
  return round2(
    (intake.BANK_TRANSFER_ILS ?? 0) + (intake.CREDIT_CARD_ILS ?? 0) + (intake.CHECK_ILS ?? 0),
  );
}

/** חוב לטורקיה = צפוי − בפועל */
export function computeTurkeyDebtUsd(turkeyExpectedUsd: number, turkeyTransferUsd: number): number {
  return Math.max(0, round2(turkeyExpectedUsd - turkeyTransferUsd));
}

/**
 * computeTurkeyDebt — נקודת שינוי יחידה לנוסחת חוב לטורקיה.
 * כל הלוגיקה העסקית של חוב טורקיה מרוכזת כאן.
 */
export function computeTurkeyDebt(input: TurkeyDebtInput): TurkeyDebtResult {
  const expectedUsd = computeTurkeyExpectedUsd(
    input.countedCashUsd,
    input.fxUsdTotal,
    input.commissionUsd,
  );
  const debtUsd = computeTurkeyDebtUsd(expectedUsd, input.turkeyTransferUsd);
  return {
    expectedUsd,
    actualUsd: input.turkeyTransferUsd,
    debtUsd,
    status: debtUsd > 0.005 ? "debt" : "ok",
  };
}

/** שער קליטה משוקלל משורות הקצאת תקבולים לרכישה */
export function weightedIntakeRateFromAllocations(
  allocations: FxPurchaseIntakeAllocation[] | undefined,
): number | null {
  if (!allocations?.length) return null;
  let ils = 0;
  let weighted = 0;
  for (const a of allocations) {
    if (a.ilsAmount <= 0 || a.intakeRate <= 0) continue;
    ils += a.ilsAmount;
    weighted += a.ilsAmount * a.intakeRate;
  }
  if (ils <= 0.005) return null;
  return round2(weighted / ils);
}

/** היסטוריית רווח/הפסד לפי רכישה — לטבלת בקרה ניהולית */
export function computeFxProfitLossHistory(purchases: FxPurchaseRecord[]): FxProfitLossHistoryRow[] {
  const sorted = [...purchases].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let cumulativeUsd = 0;
  let cumulativeIls = 0;
  const rows: FxProfitLossHistoryRow[] = [];

  sorted.forEach((p, idx) => {
    const avgRateBefore = cumulativeUsd > 0 ? round2(cumulativeIls / cumulativeUsd) : p.rate;
    const intakeRate = weightedIntakeRateFromAllocations(p.intakeAllocations);
    const rateDiff =
      intakeRate != null && p.rate > 0 ? round2(p.rate - intakeRate) : null;

    // עדיפות: רווח/הפסד מהקצאת תקבולים (שער קליטה מול שער רכישה)
    let profitIls = 0;
    let lossIls = 0;
    if (p.intakeAllocations?.length) {
      const fromMeta = round2((p.intakeProfitIls ?? 0) - (p.intakeLossIls ?? 0));
      const fromLines = round2(p.intakeAllocations.reduce((s, a) => s + (a.profitIls ?? 0), 0));
      const allocNet = Math.abs(fromMeta) > 0.005 ? fromMeta : fromLines;
      if (allocNet > 0.005) profitIls = allocNet;
      else if (allocNet < -0.005) lossIls = round2(Math.abs(allocNet));
    } else {
      const fairIls = p.usdReceived * avgRateBefore;
      const diff = fairIls - p.ilsAmount;
      profitIls = diff > 0.005 ? round2(diff) : 0;
      lossIls = diff < -0.005 ? round2(Math.abs(diff)) : 0;
    }

    const dt = new Date(p.createdAt);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    rows.push({
      purchaseId: p.id,
      operationNumber: idx + 1,
      dateLabel: dt.toLocaleDateString("he-IL"),
      timeLabel: dt.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false }),
      dateYmd: `${y}-${m}-${d}`,
      usdReceived: round2(p.usdReceived),
      ilsAmount: round2(p.ilsAmount),
      intakeRate,
      purchaseRate: p.rate,
      rateDiff,
      avgRateBefore,
      saleRate: null,
      profitIls,
      lossIls,
      netIls: round2(profitIls - lossIls),
    });
    cumulativeUsd += p.usdReceived;
    cumulativeIls += p.ilsAmount;
  });
  return rows;
}

/** כרטיסי KPI עליונים — בקרת תזרים */
export function computeFlowWeekKpis(input: FlowWeekKpiInput): FlowWeekKpiCards {
  const fmt = (n: number) => round2(n).toFixed(2);
  return {
    totalReceivedIls: fmt(input.totalReceivedIls),
    totalFxConvertedIls: fmt(input.fxTotals.ils),
    totalFxConvertedUsd: fmt(input.fxTotals.usd),
    turkeyTransferredUsd: fmt(input.turkeyTransferUsd),
    cashRemainingIls: fmt(input.cashIlsInDrawer),
    cashRemainingUsd: fmt(input.cashUsdInDrawer),
    bankBalanceIls: fmt(input.bankBalanceIls),
    fxProfitIls: fmt(input.fxProfitLoss.totalProfitIls),
    fxLossIls: fmt(input.fxProfitLoss.totalLossIls),
  };
}

/** חישוב רווח/הפסד לפי שער ממוצע מצטבר לפני כל רכישה */
export function computeFxProfitLoss(purchases: FxPurchaseRecord[]): FxProfitLossSummary {
  const sorted = [...purchases].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let cumulativeUsd = 0;
  let cumulativeIls = 0;
  let totalProfitIls = 0;
  let totalLossIls = 0;

  for (const p of sorted) {
    const avgRate = cumulativeUsd > 0 ? cumulativeIls / cumulativeUsd : p.rate;
    const fairIls = p.usdReceived * avgRate;
    const diff = fairIls - p.ilsAmount;
    if (diff > 0.005) totalProfitIls += diff;
    else if (diff < -0.005) totalLossIls += Math.abs(diff);
    cumulativeUsd += p.usdReceived;
    cumulativeIls += p.ilsAmount;
  }

  return {
    purchases: sorted,
    totalProfitIls: round2(totalProfitIls),
    totalLossIls: round2(totalLossIls),
    avgRate: cumulativeUsd > 0 ? round2(cumulativeIls / cumulativeUsd) : 0,
    cumulativeUsd: round2(cumulativeUsd),
    cumulativeIls: round2(cumulativeIls),
    maxBarAmount: Math.max(
      round2(totalProfitIls),
      round2(totalLossIls),
      ...sorted.map((p) => p.ilsAmount),
      1,
    ),
  };
}

function parseIntakeAllocations(raw: unknown): FxPurchaseIntakeAllocation[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: FxPurchaseIntakeAllocation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const ils = Number(o.ilsAmount);
    const intakeRate = Number(o.intakeRate);
    const purchaseRate = Number(o.purchaseRate);
    if (!Number.isFinite(ils) || ils <= 0) continue;
    out.push({
      paymentId: String(o.paymentId ?? ""),
      orderId: o.orderId != null ? String(o.orderId) : null,
      orderNumber: o.orderNumber != null ? String(o.orderNumber) : null,
      dateYmd: String(o.dateYmd ?? ""),
      dateLabel: String(o.dateLabel ?? ""),
      sourceLabel: String(o.sourceLabel ?? ""),
      ilsAmount: ils,
      intakeRate: Number.isFinite(intakeRate) ? intakeRate : 0,
      purchaseRate: Number.isFinite(purchaseRate) ? purchaseRate : 0,
      profitIls: Number(o.profitIls) || 0,
    });
  }
  return out.length > 0 ? out : undefined;
}

export function parseFxPurchasesJson(raw: unknown): FxPurchaseRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: FxPurchaseRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const ils = Number(o.ilsAmount);
    const usd = Number(o.usdReceived);
    const rate = Number(o.rate);
    if (!Number.isFinite(ils) || !Number.isFinite(usd) || !Number.isFinite(rate)) continue;
    out.push({
      id: String(o.id ?? `fx-${Date.now()}-${out.length}`),
      track: normalizeFxTrack(o.track),
      ilsAmount: ils,
      usdReceived: usd,
      rate,
      remainderCashIls: Number(o.remainderCashIls) || 0,
      remainderBankIls: Number(o.remainderBankIls) || 0,
      commissionUsd: Number(o.commissionUsd) || 0,
      commissionIls: Number(o.commissionIls) || 0,
      intakeAllocations: parseIntakeAllocations(o.intakeAllocations),
      intakeProfitIls: Number(o.intakeProfitIls) || undefined,
      intakeLossIls: Number(o.intakeLossIls) || undefined,
      createdById: o.createdById != null ? String(o.createdById) : undefined,
      createdByName: o.createdByName != null ? String(o.createdByName) : undefined,
      note: o.note != null ? String(o.note) : undefined,
      createdAt: String(o.createdAt ?? new Date().toISOString()),
    });
  }
  return out;
}

/** חישוב מלא לסיכום תזרים — חלק 3 */
export function computeFlowWeekSummary(input: FlowWeekCalculationInput): FlowWeekCalculationResult {
  const fxPs = sumFxPurchases(input.fxPurchases, "PS");
  const fxIl = sumFxPurchases(input.fxPurchases, "IL");
  const ilSourcePool = computeIlSourcePoolIls(
    input.countedTransferIls ?? 0,
    input.countedCreditIls ?? 0,
    input.countedChecksIls ?? 0,
  );
  const bankBalanceIls = computeBankBalanceAfterIlFx(
    input.bankReceiptsIls ?? 0,
    fxIl.ils,
    input.bankWithdrawalsIls ?? 0,
    input.bankDepositsIls ?? 0,
  );
  /** יתרת PS / זמין ל־FX PS — ללא החסרת IL */
  const ilsRemainingAfterFx = computePsRemainingIls(input.countedCashIls, fxPs.ils);
  const availableIlsForFx = computePsAvailableIlsForFx(input.countedCashIls, input.fxPurchases);
  void ilSourcePool;
  const cashUsdInDrawer = computeCashUsdInDrawer(
    input.countedCashUsd,
    input.fxPurchases,
    input.actualTurkeyTransfersUsd,
  );
  /** יתרת מזומן PS בלבד — ללא מסלול IL */
  const cashIlsInDrawer = computeCashIlsInDrawer(
    input.countedCashIls,
    input.expensesIls,
    input.fxPurchases,
  );
  const turkey = computeTurkeyDebt({
    countedCashUsd: input.countedCashUsd,
    fxUsdTotal: fxPs.usd,
    commissionUsd: input.commissionUsd,
    turkeyTransferUsd: input.actualTurkeyTransfersUsd,
  });
  const fxProfitLoss = computeFxProfitLoss(filterFxPurchasesByTrack(input.fxPurchases, "PS"));
  const fxProfitLossHistory = computeFxProfitLossHistory(
    filterFxPurchasesByTrack(input.fxPurchases, "PS"),
  );

  return {
    fxTotals: fxPs,
    availableIlsForFx,
    cashUsdInDrawer,
    cashIlsInDrawer,
    bankBalanceIls,
    ilFxPurchaseIls: fxIl.ils,
    ilsRemainingAfterFx,
    turkey,
    fxProfitLoss,
    fxProfitLossHistory,
  };
}

export type FxPurchasePreviewInput = {
  availableIls: number;
  ilsAmount: number;
  rate: number;
  remainderCashIls: number;
  remainderBankIls: number;
};

export type FxPurchasePreviewResult = {
  usdReceived: number;
  remainderAfter: number;
  splitValid: boolean;
  splitSum: number;
};

export function computeFxPurchasePreview(input: FxPurchasePreviewInput): FxPurchasePreviewResult {
  const usdReceived = computeFxUsdReceived(input.ilsAmount, input.rate);
  const remainderAfter = computeFxRemainderAfterPurchase(input.availableIls, input.ilsAmount);
  const splitSum = round2(input.remainderCashIls + input.remainderBankIls);
  return {
    usdReceived,
    remainderAfter,
    splitSum,
    splitValid: validateFxRemainderSplit(input.remainderCashIls, input.remainderBankIls, remainderAfter),
  };
}
