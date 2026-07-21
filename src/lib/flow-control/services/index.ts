/**
 * שכבת שירותי נתונים — בקרת תזרים.
 * «סה״כ התקבל»: Payment (קליטות תשלום) דרך week-flow / cashflow-received-table.
 * ספירת קופה מאושרת: CashCountSummaryService (CashDailyDrawerCount) — לא מחליף תקבולים.
 */

export {
  loadFlowWeekBankTransactions,
  type FlowWeekBankTransactions,
} from "@/lib/flow-control/services/bank-transaction-service";

export {
  loadFlowWeekCashCountSummary,
  loadFlowWeekApprovedSummary,
  FLOW_COUNTRY_LABEL,
  type FlowWeekCashCountSummary,
  type FlowWeekApprovedLine,
} from "@/lib/flow-control/services/cash-count-summary-service";

/** @deprecated — השתמש ב-loadFlowWeekCashCountSummary */
export {
  loadFlowWeekPaymentSummary,
  loadFlowWeekPaymentsForIntake,
} from "@/lib/flow-control/services/payment-summary-service";

export {
  loadFlowWeekCashCount,
  saveFlowWeekCashCount,
  cashCountToLineIds,
  type FlowWeekCashCount,
  type FlowManagerCountPersist,
} from "@/lib/flow-control/services/cash-count-service";

export {
  loadFlowWeekFxPurchases,
  appendFlowFxPurchase,
  type AppendFxPurchaseInput,
} from "@/lib/flow-control/services/exchange-service";

export {
  loadFlowWeekTurkeyTransfer,
  saveFlowWeekTurkeyTransfer,
} from "@/lib/flow-control/services/turkey-transfer-service";

export {
  futureLoadBankMovements,
  futureLoadBankReconciliation,
  futureLoadCreditCardSettlements,
  futureLoadPeriodReport,
  type FutureBankMovement,
  type FutureBankReconciliation,
  type FutureCreditCardSettlement,
  type FuturePeriodReportRequest,
  type FuturePeriodReportStub,
} from "@/lib/flow-control/services/flow-future-hooks";
