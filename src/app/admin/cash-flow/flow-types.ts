import type { CashWeekFlowLineId } from "@/lib/cash-control-week-flow";
import type { CashDailyMethodId } from "@/lib/cash-control-daily";

/** רשומת רכישת מט"ח — נשמרת ב-CashWeekFlow.fxPurchases (JSON), append-only */
export type FxPurchaseRecord = {
  id: string;
  ilsAmount: number;
  usdReceived: number;
  rate: number;
  remainderCashIls: number;
  remainderBankIls: number;
  commissionUsd?: number;
  commissionIls?: number;
  createdById?: string;
  createdByName?: string;
  note?: string;
  createdAt: string;
};

export type FxProfitLossHistoryRow = {
  purchaseId: string;
  dateLabel: string;
  timeLabel: string;
  purchaseRate: number;
  avgRateBefore: number;
  saleRate: number | null;
  profitIls: number;
  lossIls: number;
};

export type TurkeyDebtResult = {
  expectedUsd: number;
  actualUsd: number;
  debtUsd: number;
  status: "ok" | "debt";
};

export type FlowWeekKpiCards = {
  totalReceivedIls: string;
  totalFxConvertedIls: string;
  totalFxConvertedUsd: string;
  turkeyTransferredUsd: string;
  cashRemainingIls: string;
  cashRemainingUsd: string;
  bankBalanceIls: string;
  fxProfitIls: string;
  fxLossIls: string;
};

export type FxProfitLossSummary = {
  purchases: FxPurchaseRecord[];
  totalProfitIls: number;
  totalLossIls: number;
  avgRate: number;
  cumulativeUsd: number;
  cumulativeIls: number;
  /** לתצוגת גרף בלבד */
  maxBarAmount: number;
};

export type ManagerCountForm = {
  countedCashUsd: string;
  countedCashIls: string;
  countedChecksIls: string;
  countedCreditIls: string;
  countedTransferIls: string;
  commissionUsd: string;
  commissionIls: string;
  turkeyTransferUsd: string;
};

export type FlowWeekPayload = {
  week: string;
  weekLabel: string | null;
  received: Record<CashWeekFlowLineId, { amount: string; paymentCount: number }>;
  counted: Partial<Record<CashWeekFlowLineId, string | null>>;
  countDiff: Partial<Record<CashWeekFlowLineId, string | null>>;
  expensesIls: string;
  expensesUsd: string;
  commissionUsd: string | null;
  commissionIls: string | null;
  fxPurchaseIls: string | null;
  fxPurchaseUsd: string | null;
  fxRemainderCashIls: string | null;
  fxRemainderBankIls: string | null;
  fxPurchases: FxPurchaseRecord[];
  fxProfitLoss: FxProfitLossSummary;
  fxProfitLossHistory: FxProfitLossHistoryRow[];
  kpis: FlowWeekKpiCards;
  turkey: TurkeyDebtResult;
  turkeyTransferUsd: string | null;
  /** מחושב: כסף שהועבר לבנק − משיכות + הפקדות */
  bankBalanceIls: string | null;
  bankBalanceUsd: string | null;
  /** דולר בקופה — מחושב */
  drawerRemainingIls: string;
  drawerRemainingUsd: string;
  /** כמה ₪ זמין לרכישת מט"ח הבאה */
  availableIlsForFx: string;
  /** כמה $ היה צריך להעביר לטורקיה */
  turkeyExpectedUsd: string;
  /** חוב לטורקיה (חיובי = חסר העברה) */
  turkeyDebtUsd: string;
  turkeyDebtStatus: "ok" | "debt";
};

/** עמודות טבלת קליטות — חלק 1 */
export const FLOW_PAYMENT_COLUMNS: CashDailyMethodId[] = [
  "CASH_USD",
  "CASH_ILS",
  "BANK_TRANSFER",
  "CHECK",
  "CREDIT",
];

export const FLOW_COLUMN_CLASS: Record<CashDailyMethodId, string> = {
  CASH_USD: "fc-col--usd",
  CASH_ILS: "fc-col--ils",
  BANK_TRANSFER: "fc-col--transfer",
  CHECK: "fc-col--check",
  CREDIT: "fc-col--credit",
  OTHER: "fc-col--other",
};
