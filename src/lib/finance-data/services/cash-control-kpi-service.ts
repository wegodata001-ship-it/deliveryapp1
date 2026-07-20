import {
  buildCashControlKpiView,
  type CashControlKpiChannelAmounts,
  type CashControlKpiView,
} from "@/lib/finance-data/view-models/cash-control-kpi-view";

/**
 * CashControlKpiService — stage 4 KPI surface.
 * Screens must not recompute KPIs; call this (or consume kpi attached to week summary).
 */
export type CashControlKpiService = {
  /**
   * Build KPIs from week channel intake + expenses already loaded for the tables.
   * Guarantees KPI ≡ table aggregates (same source).
   */
  buildFromWeekAggregates(params: {
    weekCode: string;
    channelIntake: CashControlKpiChannelAmounts;
    expensesUsd: number;
    expensesIls: number;
  }): CashControlKpiView;
};

export const cashControlKpiService: CashControlKpiService = {
  buildFromWeekAggregates(params) {
    return buildCashControlKpiView(params);
  },
};
