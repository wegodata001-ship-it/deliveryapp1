/**
 * @deprecated PaymentSummaryService — בקרת תזרים קוראת מ-Payment ישירות
 * (computePaymentsTotalReceivedIls / buildFlowPaymentDailyRows).
 * נשמר לתאימות בלבד; לא להשתמש כמקור ל־«סה״כ התקבל».
 */

export {
  loadFlowWeekCashCountSummary,
  loadFlowWeekApprovedSummary,
  FLOW_COUNTRY_LABEL,
  type FlowWeekCashCountSummary,
  type FlowWeekApprovedLine,
} from "@/lib/flow-control/services/cash-count-summary-service";

/** @deprecated — מחזיר ספירת קופה, לא קליטות תשלום */
export async function loadFlowWeekPaymentSummary(weekCode: string) {
  const { loadFlowWeekCashCountSummary } = await import(
    "@/lib/flow-control/services/cash-count-summary-service"
  );
  const summary = await loadFlowWeekCashCountSummary(weekCode);
  return {
    received: Object.fromEntries(
      Object.entries(summary.approved).map(([k, v]) => [
        k,
        { amount: v.amount, paymentCount: v.daysCounted },
      ]),
    ),
    totalReceivedIls: summary.totalApprovedIls,
  };
}

/** @deprecated */
export async function loadFlowWeekPaymentsForIntake(_weekCode: string): Promise<never[]> {
  return [];
}
