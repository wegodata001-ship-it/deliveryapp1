/**
 * Cash Control week KPI view model — Finance Data Layer V2.
 *
 * Built from the same channel intake + expense aggregates that feed
 * the Cash Control week tables (no separate UI math).
 */

import { roundMoney2 } from "@/lib/finance-data/types/money";

/** Channel ids as stored on Cash Control daily intake (currency suffix). */
export type CashControlKpiChannelId =
  | "CASH_USD"
  | "CASH_ILS"
  | "BANK_TRANSFER_USD"
  | "BANK_TRANSFER_ILS"
  | "CREDIT_CARD_USD"
  | "CREDIT_CARD_ILS"
  | "CHECK_USD"
  | "CHECK_ILS"
  | "OTHER_USD"
  | "OTHER_ILS";

export type CashControlKpiChannelAmounts = Partial<Record<CashControlKpiChannelId, number>>;

export type CashControlKpiView = {
  weekCode: string;
  /** סה״כ תקבולים בדולר — כל ערוצי USD */
  totalReceiptsUsd: number;
  /** סה״כ תקבולים בשקלים — כל ערוצי ILS */
  totalReceiptsIls: number;
  /** סה״כ הוצאות בדולר */
  totalExpensesUsd: number;
  /** סה״כ הוצאות בשקלים */
  totalExpensesIls: number;
  /**
   * שולם בבנק — העברה + אשראי + צ'קים בלבד (ללא מזומן / אחר / זכות / עמלות).
   */
  bankPaidUsd: number;
  bankPaidIls: number;
};

const RECEIPT_USD_CHANNELS: CashControlKpiChannelId[] = [
  "CASH_USD",
  "BANK_TRANSFER_USD",
  "CREDIT_CARD_USD",
  "CHECK_USD",
  "OTHER_USD",
];

const RECEIPT_ILS_CHANNELS: CashControlKpiChannelId[] = [
  "CASH_ILS",
  "BANK_TRANSFER_ILS",
  "CREDIT_CARD_ILS",
  "CHECK_ILS",
  "OTHER_ILS",
];

/** העברה בנקאית + כרטיס אשראי + צ'קים */
const BANK_USD_CHANNELS: CashControlKpiChannelId[] = [
  "BANK_TRANSFER_USD",
  "CREDIT_CARD_USD",
  "CHECK_USD",
];

const BANK_ILS_CHANNELS: CashControlKpiChannelId[] = [
  "BANK_TRANSFER_ILS",
  "CREDIT_CARD_ILS",
  "CHECK_ILS",
];

function sumChannels(
  intake: CashControlKpiChannelAmounts,
  channels: CashControlKpiChannelId[],
): number {
  let total = 0;
  for (const id of channels) {
    total += intake[id] ?? 0;
  }
  return roundMoney2(total);
}

/**
 * Pure KPI builder — input must be the same week aggregates used by the tables.
 */
export function buildCashControlKpiView(params: {
  weekCode: string;
  channelIntake: CashControlKpiChannelAmounts;
  expensesUsd: number;
  expensesIls: number;
}): CashControlKpiView {
  const intake = params.channelIntake;
  return {
    weekCode: params.weekCode,
    totalReceiptsUsd: sumChannels(intake, RECEIPT_USD_CHANNELS),
    totalReceiptsIls: sumChannels(intake, RECEIPT_ILS_CHANNELS),
    totalExpensesUsd: roundMoney2(params.expensesUsd),
    totalExpensesIls: roundMoney2(params.expensesIls),
    bankPaidUsd: sumChannels(intake, BANK_USD_CHANNELS),
    bankPaidIls: sumChannels(intake, BANK_ILS_CHANNELS),
  };
}
