import type { LedgerBalanceStatus } from "@/lib/finance-data/ledger";

/**
 * Unified order balance — Ledger SSOT for debt amount.
 * Consumed by Payment Intake, KPI, Reports (after screen migration).
 */
export type OrderBalanceView = {
  orderId: string;
  orderNumber: string | null;
  customerId: string | null;
  weekCode: string | null;
  /** Deal amount (before commission) */
  amountUsd: number;
  commissionUsd: number;
  totalUsd: number;
  paidUsd: number;
  openDebtUsd: number;
  status: LedgerBalanceStatus;
  /** True when breakdown rows exist for this order */
  hasBreakdown: boolean;
};
