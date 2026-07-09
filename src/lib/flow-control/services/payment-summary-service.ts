/**
 * @deprecated PaymentSummaryService — בקרת תזרים אינה קוראת מ-Payment.
 * נשמר לתאימות; מפנה ל-CashCountSummaryService.
 */

export {
  loadFlowWeekCashCountSummary,
  loadFlowWeekApprovedSummary,
  FLOW_COUNTRY_LABEL,
  type FlowWeekCashCountSummary,
  type FlowWeekApprovedLine,
} from "@/lib/flow-control/services/cash-count-summary-service";

/** @deprecated */
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

/** @deprecated — אין טעינת Payment בבקרת תזרים */
export async function loadFlowWeekPaymentsForIntake(_weekCode: string): Promise<never[]> {
  return [];
}
