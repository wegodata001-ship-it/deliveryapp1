import type { CashflowView } from "@/lib/finance-data/view-models";

/**
 * CashflowService — phase 3 migration target.
 * Stub: returns empty view until Cash Control is migrated onto this layer.
 */
export type CashflowService = {
  getWeekCashflow(params: {
    weekCode: string;
    countryCode: string;
  }): Promise<CashflowView>;
};

export const cashflowService: CashflowService = {
  async getWeekCashflow(params) {
    return {
      weekCode: params.weekCode,
      countryCode: params.countryCode,
      lines: [],
      totalReceivedUsd: 0,
      totalReceivedIls: 0,
    };
  },
};
