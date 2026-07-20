import type { CashWeekFlowLineId } from "@/lib/cash-control-week-flow";
import type { CashDailyMethodId } from "@/lib/cash-control-daily";
import { allCashControlChannels, channelGroupClass } from "@/lib/cash-control-channel";
import type { CashDailySummaryRowDto } from "@/app/admin/cash-control/daily-types";

/** שורת הקצאת תקבול לרכישת מט"ח */
export type FxPurchaseIntakeAllocation = {
  paymentId: string;
  orderId: string | null;
  orderNumber: string | null;
  dateYmd: string;
  dateLabel: string;
  sourceLabel: string;
  ilsAmount: number;
  intakeRate: number;
  purchaseRate: number;
  profitIls: number;
};

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
  /** פירוט תקבולים שהרכיבו את רכישת המט"ח */
  intakeAllocations?: FxPurchaseIntakeAllocation[];
  intakeProfitIls?: number;
  intakeLossIls?: number;
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

/** @deprecated — השתמש ב-TurkeyTransferBalanceResult */
export type TurkeyDebtResultLegacy = TurkeyDebtResult;

export type { TurkeyTransferBalanceResult, TurkeyTransferMovementDto } from "@/lib/flow-control/turkey-transfer-balance-types";

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
  /** יתרה להעברה לטורקיה — מחושב מתנועות (לא מחוב לקוח) */
  turkeyBalance: import("@/lib/flow-control/turkey-transfer-balance-types").TurkeyTransferBalanceResult;
  turkeyTransferUsd: string | null;
  /** מחושב: כסף שהועבר לבנק − משיכות + הפקדות */
  bankBalanceIls: string | null;
  bankBalanceUsd: string | null;
  /** דולר בקופה — מחושב */
  drawerRemainingIls: string;
  drawerRemainingUsd: string;
  /** כמה ₪ זמין לרכישת מט"ח — זהה ל«שקל שנשאר» (תקבולים − FX PS − FX IL) */
  availableIlsForFx: string;
  /** כמה $ מוקצה לטורקיה מספירת קופה (לטורקיה PS) */
  turkeyExpectedUsd: string;
  /** @deprecated — השתמש ב-turkeyBalance.usd.closingBalance */
  turkeyDebtUsd: string;
  /** @deprecated */
  turkeyDebtStatus: "ok" | "debt";
  /** יתרה להעברה לטורקיה — סגירה */
  turkeyBalanceClosingUsd: string;
  turkeyBalanceStatus: import("@/lib/flow-control/turkey-transfer-balance-types").TurkeyWeekStatus;
  /** רכישת מט״ח IL = העברות IL + צ'קים IL + אשראי IL */
  ilFxPurchaseIls: string;
  /** שקל שנשאר = תקבולים ₪ − רכישת מט״ח PS − רכישת מט״ח IL */
  ilsRemainingAfterFx: string;
};

/** עמודות טבלת קליטות — כל ערוצי בקרת הקופה */
export const FLOW_PAYMENT_COLUMNS: CashDailyMethodId[] = allCashControlChannels();

export const FLOW_COLUMN_CLASS: Record<CashDailyMethodId, string> = Object.fromEntries(
  allCashControlChannels().map((id) => [id, channelGroupClass(id)]),
) as Record<CashDailyMethodId, string>;

/** שורת סיכום שבועי — בקרת תזרים (מסך ראשי) */
export type FlowWeekOverviewRow = {
  week: string;
  weekLabel: string | null;
  hasData: boolean;
  /** סכומי ספירות קופה יומיות מצטברים */
  drawer: Record<CashDailyMethodId, string>;
  totalReceivedIls: string;
  daysCounted: number;
  /** ספירת מנהל — CashWeekFlow */
  manager: Partial<Record<CashWeekFlowLineId, string | null>>;
  commissionUsd: string | null;
  commissionIls: string | null;
  /** לטורקיה PS מספירת קופה */
  turkeyTransferUsd: string | null;
  /** יתרה להעברה לטורקיה — USD */
  turkeyOpeningUsd: string | null;
  turkeyAddedUsd: string | null;
  turkeyTransferredUsd: string | null;
  turkeyClosingUsd: string | null;
  turkeyBalanceStatus: import("@/lib/flow-control/turkey-transfer-balance-types").TurkeyWeekStatus;
  fxPurchaseIls: string | null;
  fxPurchaseUsd: string | null;
  fxRemainderCashIls: string | null;
  fxRemainderBankIls: string | null;
  fxPurchaseCount: number;
  expensesIls: string;
  expensesUsd: string;
  drawerRemainingIls: string;
  drawerRemainingUsd: string;
  bankBalanceIls: string | null;
  /** רווח/הפסד שערים מרכישות מט״ח (קיים) — לתצוגה לחיצה */
  fxProfitIls: string;
  fxLossIls: string;
};

export type FlowWeeksOverviewPayload = {
  weeks: FlowWeekOverviewRow[];
};

/** פירוט שבוע — נפתח מתחת לשורה */
export type FlowWeekDrillPayload = {
  week: string;
  weekLabel: string | null;
  flow: FlowWeekPayload;
  dailyCounts: CashDailySummaryRowDto[];
  /** קליטות יומיות מ-Payment (ללא מע״מ ב-₪) */
  paymentDailyRows: FlowPaymentDailyRow[];
  expenses: FlowWeekDrillExpenseRow[];
  paymentIntake: Record<CashDailyMethodId, string>;
  meta: FlowWeekMeta;
};

export type FlowPaymentDailyRow = {
  dateYmd: string;
  dayName: string;
  dateDisplay: string;
  weekCode: string;
  countryLabel: string;
  intake: Record<CashDailyMethodId, string>;
  totalReceived: string;
  isTotal?: boolean;
};

export type FlowWeekMeta = {
  updatedByName: string | null;
  updatedAtDisplay: string | null;
};

export type FlowWeekDrillExpenseRow = {
  id: string;
  dateYmd: string;
  timeHm: string;
  reasonLabel: string;
  currency: "ILS" | "USD";
  paymentMethod: string;
  paymentMethodLabel: string;
  amount: string;
  createdByName: string | null;
};
