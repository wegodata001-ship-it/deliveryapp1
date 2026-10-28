/**
 * SSOT — בקרת תזרים: תקבול בפועל (Payment) ≠ ספירה יומית ≠ ספירת מנהל.
 */

import type { CashWeekFlowLineId } from "@/lib/cash-control-week-flow";
import { CASH_WEEK_FLOW_LINE_IDS, WEEK_FLOW_LINE_CHANNEL, countLineDiff } from "@/lib/cash-control-week-flow";
import type { CashDailyIntakeTotals, CashDailyMethodId } from "@/lib/cash-control-daily";
import { emptyDailyIntake } from "@/lib/cash-control-daily";
import type { FlowWeekApprovedLine } from "@/lib/flow-control/services/cash-count-summary-service";
import type { FlowWeekCashCount } from "@/lib/flow-control/services/cash-count-service";

export type FlowReceiptLineDto = {
  amount: number;
  /** מספר ימים עם ספירה מאושרת — רק ל-dailyApproved */
  daysCounted?: number;
  /** מספר תשלומים — רק ל-actualReceipts */
  paymentCount?: number;
};

export type FlowWeekReceiptLayers = {
  /** תקבולים בפועל — Payment */
  actualReceipts: Record<CashWeekFlowLineId, FlowReceiptLineDto>;
  /** ספירה יומית מאושרת — CashDailyDrawerCount */
  dailyApproved: Record<CashWeekFlowLineId, FlowReceiptLineDto>;
  /** הפרש: נספר (מנהל) − צפוי (תקבול בפועל), לפי countLineDiff */
  countDiff: Partial<Record<CashWeekFlowLineId, number | null>>;
};

export type ManagerCountState = "NONE" | "PARTIAL" | "COMPLETE";

export type FlowCashboxLine = {
  /** null כשיתרת פתיחה לא מאומתת — לא מציגים 0 מומצא */
  opening: number | null;
  openingVerified: boolean;
  inflows: number;
  outflows: number;
  /** opening + inflows − outflows */
  closingCalculated: number;
  /** יתרת קופה לפי נוסחת PS (רק כשיש ספירה) */
  drawerBalance: number | null;
  countedPhysical: number | null;
  countVariance: number | null;
  displayStatus: "NO_COUNT" | "OK" | "VARIANCE";
};

export type FlowWeekCashboxes = {
  usd: FlowCashboxLine;
  ils: FlowCashboxLine;
  managerCountState: ManagerCountState;
  /** יתרה מחושבת מתקבולים — מוצגת רק כשאין ספירת מנהל */
  receiptsBasedUsd: number | null;
  receiptsBasedIls: number | null;
  prevWeek: string | null;
  openingMessageHe: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** מצטבר ערוצי Payment → שורות ספירת מנהל (6 שורות) */
export function paymentIntakeToFlowLines(intake: CashDailyIntakeTotals): Record<CashWeekFlowLineId, number> {
  const out = Object.fromEntries(CASH_WEEK_FLOW_LINE_IDS.map((id) => [id, 0])) as Record<
    CashWeekFlowLineId,
    number
  >;
  out.CASH_ILS = round2(intake.CASH_ILS ?? 0);
  out.CASH_USD = round2(intake.CASH_USD ?? 0);
  out.CREDIT = round2(intake.CREDIT_CARD_ILS ?? 0);
  out.CHECK = round2(intake.CHECK_ILS ?? 0);
  out.BANK_TRANSFER = round2(intake.BANK_TRANSFER_ILS ?? 0);
  out.BANK_TRANSFER_USD = round2(intake.BANK_TRANSFER_USD ?? 0);
  return out;
}

function approvedToLines(
  approved: Record<CashWeekFlowLineId, FlowWeekApprovedLine>,
): Record<CashWeekFlowLineId, FlowReceiptLineDto> {
  return Object.fromEntries(
    CASH_WEEK_FLOW_LINE_IDS.map((id) => [
      id,
      {
        amount: round2(approved[id]?.amount ?? 0),
        daysCounted: approved[id]?.daysCounted ?? 0,
      },
    ]),
  ) as Record<CashWeekFlowLineId, FlowReceiptLineDto>;
}

export function resolveManagerCountState(cashCount: FlowWeekCashCount): ManagerCountState {
  const fields = [
    cashCount.countedCashUsd,
    cashCount.countedCashIls,
    cashCount.countedChecksIls,
    cashCount.countedCreditIls,
    cashCount.countedTransferIls,
  ];
  const set = fields.filter((v) => v != null).length;
  if (set === 0) return "NONE";
  if (set < fields.length) return "PARTIAL";
  return "COMPLETE";
}

export function hasManagerCountSaved(cashCount: FlowWeekCashCount): boolean {
  return resolveManagerCountState(cashCount) !== "NONE";
}

export function buildFlowWeekReceiptLayers(input: {
  weekPaymentIntake: CashDailyIntakeTotals;
  approvedByLine: Record<CashWeekFlowLineId, FlowWeekApprovedLine>;
  countedLines: Partial<Record<CashWeekFlowLineId, number | null>>;
  expensesByChannel: Partial<Record<CashDailyMethodId, number>>;
  paymentRowCount: number;
}): FlowWeekReceiptLayers {
  const actualByLine = paymentIntakeToFlowLines(input.weekPaymentIntake);
  const actualReceipts = Object.fromEntries(
    CASH_WEEK_FLOW_LINE_IDS.map((id) => [
      id,
      { amount: actualByLine[id], paymentCount: input.paymentRowCount },
    ]),
  ) as Record<CashWeekFlowLineId, FlowReceiptLineDto>;

  const dailyApproved = approvedToLines(input.approvedByLine);

  const countDiff: Partial<Record<CashWeekFlowLineId, number | null>> = {};
  for (const lineId of CASH_WEEK_FLOW_LINE_IDS) {
    const expected = actualByLine[lineId] ?? 0;
    const cnt = input.countedLines[lineId] ?? null;
    const channel = WEEK_FLOW_LINE_CHANNEL[lineId];
    const expAmt = input.expensesByChannel[channel] ?? 0;
    countDiff[lineId] = countLineDiff(expected, cnt, expAmt);
  }

  return { actualReceipts, dailyApproved, countDiff };
}

export function buildFlowWeekCashboxes(input: {
  cashCount: FlowWeekCashCount;
  openingUsd: number | null;
  openingIls: number | null;
  openingVerified: boolean;
  openingMessageHe: string;
  prevWeek: string | null;
  /** תקבול מזומן $ בפועל (Payment) */
  inflowCashUsd: number;
  inflowCashIls: number;
  fxUsdIn: number;
  fxIlsOut: number;
  turkeyOutUsd: number;
  bankOutIls: number;
  expensesIls: number;
  expensesUsd: number;
  drawerUsdWhenCounted: number | null;
  drawerIlsWhenCounted: number | null;
}): FlowWeekCashboxes {
  const state = resolveManagerCountState(input.cashCount);
  const countedUsd = input.cashCount.countedCashUsd;
  const countedIls = input.cashCount.countedCashIls;

  const openUsd = input.openingVerified && input.openingUsd != null ? input.openingUsd : 0;
  const openIls = input.openingVerified && input.openingIls != null ? input.openingIls : 0;

  const inflowsUsd = round2(input.inflowCashUsd + input.fxUsdIn);
  const outflowsUsd = round2(input.turkeyOutUsd + input.expensesUsd);
  const closingCalcUsd = round2(openUsd + inflowsUsd - outflowsUsd);

  const inflowsIls = round2(input.inflowCashIls);
  const outflowsIls = round2(input.fxIlsOut + input.bankOutIls + input.expensesIls);
  const closingCalcIls = round2(openIls + inflowsIls - outflowsIls);

  const receiptsBasedUsd =
    state === "NONE" ? round2(inflowsUsd - outflowsUsd) : null;
  const receiptsBasedIls =
    state === "NONE" ? round2(inflowsIls - outflowsIls) : null;

  function line(
    opening: number | null,
    openingVerified: boolean,
    inflows: number,
    outflows: number,
    closingCalculated: number,
    counted: number | null,
    drawerWhenCounted: number | null,
  ): FlowCashboxLine {
    const countVariance =
      counted != null ? round2(counted - closingCalculated) : null;
    let displayStatus: FlowCashboxLine["displayStatus"] = "NO_COUNT";
    if (counted != null) {
      displayStatus =
        countVariance != null && Math.abs(countVariance) > 0.02 ? "VARIANCE" : "OK";
    }
    return {
      opening,
      openingVerified,
      inflows,
      outflows,
      closingCalculated,
      drawerBalance: drawerWhenCounted,
      countedPhysical: counted,
      countVariance,
      displayStatus,
    };
  }

  const openingVerified = input.openingVerified;
  const displayUsd = openingVerified ? input.openingUsd : null;
  const displayIls = openingVerified ? input.openingIls : null;

  return {
    managerCountState: state,
    receiptsBasedUsd,
    receiptsBasedIls,
    prevWeek: input.prevWeek,
    openingMessageHe: input.openingMessageHe,
    usd: line(
      displayUsd,
      openingVerified,
      inflowsUsd,
      outflowsUsd,
      closingCalcUsd,
      countedUsd,
      input.drawerUsdWhenCounted,
    ),
    ils: line(
      displayIls,
      openingVerified,
      inflowsIls,
      outflowsIls,
      closingCalcIls,
      countedIls,
      input.drawerIlsWhenCounted,
    ),
  };
}

/** סכום intake לפי weekCode בלבד — להשוואה (לא ל-KPI) */
export function emptyFlowLines(): Record<CashWeekFlowLineId, number> {
  return paymentIntakeToFlowLines(emptyDailyIntake());
}
