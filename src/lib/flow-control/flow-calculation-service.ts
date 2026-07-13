/**
 * בקרת תזרים — כל החישובים העסקיים במקום אחד בלבד.
 * אסור לבצע חישובים ב-React או ב-UI — רק כאן.
 */

import { CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";
import {
  parsePaymentNoteContributions,
  paymentMethodBucketKey,
  type PaymentBucketKey,
} from "@/lib/payment-breakdown-shared";
import type { CashDailyMethodId, CashDailyIntakeTotals } from "@/lib/cash-control-daily";
import { emptyDailyIntake } from "@/lib/cash-control-daily";
import type {
  FxProfitLossSummary,
  FxPurchaseIntakeAllocation,
  FxPurchaseRecord,
  FxProfitLossHistoryRow,
  TurkeyDebtResult,
  FlowWeekKpiCards,
} from "@/app/admin/cash-flow/flow-types";

export type FlowPaymentVatFields = {
  amountIls: { toString(): string } | null;
  amountUsd: { toString(): string } | null;
  paymentMethod: string | null;
  usdPaymentMethod: string | null;
  ilsPaymentMethod: string | null;
  notes?: string | null;
  exchangeRate?: { toString(): string } | null;
  amountWithoutVat?: { toString(): string } | null;
  totalIlsWithoutVat?: { toString(): string } | null;
  totalIlsWithVat?: { toString(): string } | null;
};

export type FlowWeekCalculationInput = {
  countedCashUsd: number;
  countedCashIls: number;
  expensesIls: number;
  commissionUsd: number;
  turkeyTransferUsd: number;
  fxPurchases: FxPurchaseRecord[];
  bankWithdrawalsIls?: number;
  bankDepositsIls?: number;
};

export type FlowWeekCalculationResult = {
  fxTotals: { ils: number; usd: number };
  availableIlsForFx: number;
  cashUsdInDrawer: number;
  cashIlsInDrawer: number;
  bankBalanceIls: number;
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
  if (bucket === "CASH") return side === "ILS" ? "CASH_ILS" : "CASH_USD";
  if (bucket === "BANK_TRANSFER") return "BANK_TRANSFER";
  if (bucket === "CHECK") return "CHECK";
  if (bucket === "CREDIT") return "CREDIT";
  if (bucket === "OTHER") return "OTHER";
  return null;
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

function contributionsFromNoteLines(
  p: FlowPaymentVatFields,
): Array<{ column: CashDailyMethodId; amount: number }> | null {
  const rate = Number(p.exchangeRate?.toString() ?? 0);
  const parts = parsePaymentNoteContributions(p.notes, rate);
  if (parts.length === 0) return null;

  const ilsFactor = ilsExVatFactor(p);
  const out: Array<{ column: CashDailyMethodId; amount: number }> = [];
  for (const part of parts) {
    const col = bucketToMethod(part.bucket, part.side);
    if (!col) continue;
    const amount = part.side === "ILS" ? round2(part.amount * ilsFactor) : part.amount;
    out.push({ column: col, amount });
  }
  return out.length > 0 ? out : null;
}

/** מפצל קליטה לעמודות טבלת בקרת תזרים — סכומי ₪ ללא מע״מ */
export function getFlowPaymentContributions(
  p: FlowPaymentVatFields,
): Array<{ column: CashDailyMethodId; amount: number }> {
  const fromNotes = contributionsFromNoteLines(p);
  if (fromNotes) return fromNotes;

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
  dayKey: (p: { paymentDate: Date | string | null; createdAt: Date | string }) => string,
): Map<string, CashDailyIntakeTotals> {
  const map = new Map<string, CashDailyIntakeTotals>();
  for (const p of payments) {
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

/** סה״כ התקבל (₪) — ללא מזומן $ וללא «אחר» */
export function computeWeekTotalReceivedIls(intake: CashDailyIntakeTotals): number {
  return round2(
    intake.CASH_ILS + intake.CREDIT + intake.CHECK + intake.BANK_TRANSFER,
  );
}

export function sumFxPurchases(records: FxPurchaseRecord[]): { ils: number; usd: number } {
  let ils = 0;
  let usd = 0;
  for (const r of records) {
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

/** כמה ₪ זמין לרכישת מט״ח */
export function computeAvailableIlsForFx(
  managerCashIls: number,
  expensesIls: number,
  fxPurchases: FxPurchaseRecord[],
): number {
  const spent = fxPurchases.reduce((s, p) => s + p.ilsAmount, 0);
  return Math.max(0, round2(managerCashIls - expensesIls - spent));
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
 * דולר בקופה = דולר PS + רכישות מט״ח − דולר שנשלח לטורקיה
 */
export function computeCashUsdInDrawer(
  countedCashUsd: number,
  fxPurchases: FxPurchaseRecord[],
  turkeyTransferUsd: number,
): number {
  const fxUsd = sumFxPurchases(fxPurchases).usd;
  return round2(countedCashUsd + fxUsd - turkeyTransferUsd);
}

/**
 * שקל בקופה = שקל PS − הוצאות קופה − סכום רכישות מט״ח בשקלים − סכום שהועבר לבנק מיתרות
 */
export function computeCashIlsInDrawer(
  countedCashIls: number,
  expensesIls: number,
  fxPurchases: FxPurchaseRecord[],
): number {
  const fxIls = sumFxPurchases(fxPurchases).ils;
  const bankFromRemainder = fxPurchases.reduce((s, p) => s + p.remainderBankIls, 0);
  return round2(countedCashIls - expensesIls - fxIls - bankFromRemainder);
}

/**
 * יתרה בבנק = כסף שהועבר לבנק − משיכות + הפקדות
 * כסף שהועבר לבנק = סכום «הועבר לבנק» מרכישות מט״ח
 */
export function computeBankBalanceIls(
  fxPurchases: FxPurchaseRecord[],
  bankWithdrawalsIls = 0,
  bankDepositsIls = 0,
): number {
  const transfersToBank = fxPurchases.reduce((s, p) => s + p.remainderBankIls, 0);
  return round2(transfersToBank - bankWithdrawalsIls + bankDepositsIls);
}

/**
 * כל הכסף שהיה אמור לעבור לטורקיה = דולר PS + דולר מרכישות מט״ח − עמלה $
 */
export function computeTurkeyExpectedUsd(
  countedCashUsd: number,
  fxUsdTotal: number,
  commissionUsd: number,
): number {
  return Math.max(0, round2(countedCashUsd + fxUsdTotal - commissionUsd));
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

/** היסטוריית רווח/הפסד לפי רכישה — לטבלת בקרה */
export function computeFxProfitLossHistory(purchases: FxPurchaseRecord[]): FxProfitLossHistoryRow[] {
  const sorted = [...purchases].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let cumulativeUsd = 0;
  let cumulativeIls = 0;
  const rows: FxProfitLossHistoryRow[] = [];

  for (const p of sorted) {
    const avgRateBefore = cumulativeUsd > 0 ? round2(cumulativeIls / cumulativeUsd) : p.rate;
    const fairIls = p.usdReceived * avgRateBefore;
    const diff = fairIls - p.ilsAmount;
    const profitIls = diff > 0.005 ? round2(diff) : 0;
    const lossIls = diff < -0.005 ? round2(Math.abs(diff)) : 0;
    const dt = new Date(p.createdAt);
    rows.push({
      purchaseId: p.id,
      dateLabel: dt.toLocaleDateString("he-IL"),
      timeLabel: dt.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false }),
      purchaseRate: p.rate,
      avgRateBefore,
      saleRate: null,
      profitIls,
      lossIls,
    });
    cumulativeUsd += p.usdReceived;
    cumulativeIls += p.ilsAmount;
  }
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
  const fxTotals = sumFxPurchases(input.fxPurchases);
  const availableIlsForFx = computeAvailableIlsForFx(
    input.countedCashIls,
    input.expensesIls,
    input.fxPurchases,
  );
  const cashUsdInDrawer = computeCashUsdInDrawer(
    input.countedCashUsd,
    input.fxPurchases,
    input.turkeyTransferUsd,
  );
  const cashIlsInDrawer = computeCashIlsInDrawer(
    input.countedCashIls,
    input.expensesIls,
    input.fxPurchases,
  );
  const bankBalanceIls = computeBankBalanceIls(
    input.fxPurchases,
    input.bankWithdrawalsIls ?? 0,
    input.bankDepositsIls ?? 0,
  );
  const turkey = computeTurkeyDebt({
    countedCashUsd: input.countedCashUsd,
    fxUsdTotal: fxTotals.usd,
    commissionUsd: input.commissionUsd,
    turkeyTransferUsd: input.turkeyTransferUsd,
  });
  const fxProfitLoss = computeFxProfitLoss(input.fxPurchases);
  const fxProfitLossHistory = computeFxProfitLossHistory(input.fxPurchases);

  return {
    fxTotals,
    availableIlsForFx,
    cashUsdInDrawer,
    cashIlsInDrawer,
    bankBalanceIls,
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
