/**
 * Aggregated KPI / summary card model.
 * Built only from OrderBalanceView + PaymentMethodView — never from parallel math.
 */
export type PaymentSummaryView = {
  orderCount: number;
  totalUsd: number;
  paidUsd: number;
  openDebtUsd: number;
  methodCount: number;
  methodRemainingUsd: number;
  methodRemainingIls: number;
};
