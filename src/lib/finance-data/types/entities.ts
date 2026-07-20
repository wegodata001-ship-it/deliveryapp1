/**
 * Domain entities as read by Repositories (DB-shaped, no UI).
 * These are the only shapes Repositories may return to Services.
 */

import type { MoneyCurrency } from "./money";

export type FinanceOrderRecord = {
  id: string;
  orderNumber: string | null;
  customerId: string | null;
  customerCodeSnapshot: string | null;
  customerNameSnapshot: string | null;
  weekCode: string | null;
  countryCode: string;
  orderDate: Date | null;
  status: string;
  paymentMethod: string | null;
  totalUsd: number;
  commissionUsd: number;
  amountUsd: number;
  exchangeRate: number | null;
  isActive: boolean;
};

export type FinancePaymentRecord = {
  id: string;
  paymentCode: string | null;
  customerId: string | null;
  orderId: string | null;
  weekCode: string | null;
  countryCode: string;
  paymentDate: Date | null;
  currency: string;
  amountUsd: number;
  amountIls: number;
  sourceCurrency: string | null;
  sourceAmount: number | null;
  paymentMethod: string | null;
  usdPaymentMethod: string | null;
  ilsPaymentMethod: string | null;
  status: string;
  businessType: string;
  isPaid: boolean;
};

export type FinanceBreakdownRecord = {
  id: string;
  orderId: string;
  paymentMethod: string;
  /** Planned amount in row currency */
  amount: number;
  currency: MoneyCurrency;
  /** Paid in row currency (snapshot from Matching / capture) */
  paidAmount: number;
  /**
   * Open capacity for this method (snapshot).
   * Not Ledger Open Debt. May diverge until single writer + validation land.
   */
  remainingAmount: number | null;
};

export type FinanceCustomerRecord = {
  id: string;
  customerCode: string | null;
  displayName: string;
  balanceUsd: number;
  countryCode: string;
  isActive: boolean;
};

export type FinanceMethodAllocationRecord = {
  id: string;
  paymentId: string;
  method: string;
  currency: MoneyCurrency;
  sourceAmount: number;
  amountUsd: number;
};
