import type { PaymentIntakeOrderStatus } from "@/lib/payment-intake";

export type DebtBreakdownOpenOrder = {
  orderId: string;
  orderNumber: string;
  orderDateYmd: string;
  weekCode: string | null;
  sourceCountry: string | null;
  originalAmount: number;
  commission: number;
  totalDue: number;
  paidAmount: number;
  creditedAmount: number;
  remainingBalance: number;
  lastPaymentDate: string | null;
  status: PaymentIntakeOrderStatus;
  statusLabel: string;
  visibleInIntakeWeek: boolean;
};

export type DebtBreakdownPaymentRow = {
  id: string;
  paymentDateYmd: string;
  paymentCode: string | null;
  amountUsd: number;
  currency: "USD" | "ILS";
  paymentMethodLabel: string;
  orderId: string | null;
  orderNumber: string | null;
  allocatedUsd: number;
  balanceAfterUsd: number | null;
  createdByName: string | null;
  notes: string | null;
  isUnallocated: boolean;
  isCancelled: boolean;
};

export type DebtBreakdownAdjustmentRow = {
  id: string;
  kind:
    | "OPENING_CREDIT"
    | "DEBT_WITHDRAWAL"
    | "CREDIT_SURPLUS"
    | "BALANCE_RESET"
    | "UNALLOCATED_PAYMENT"
    | "CANCELLED_PAYMENT"
    | "MANUAL"
    | "OTHER";
  label: string;
  dateYmd: string | null;
  amountUsd: number;
  description: string | null;
};

export type DebtBreakdownSourceRow = {
  id: string;
  label: string;
  amountUsd: number;
  description: string | null;
};

export type CustomerDebtBreakdownDto = {
  customerId: string;
  currency: "USD";
  intakeWeekCode: string | null;
  summary: {
    currentDebt: number;
    openOrdersCount: number;
    totalOriginalAmount: number;
    totalCommission: number;
    totalPaid: number;
    openOrdersDebt: number;
    creditUsd: number;
  };
  openOrders: DebtBreakdownOpenOrder[];
  paymentHistory: DebtBreakdownPaymentRow[];
  adjustments: DebtBreakdownAdjustmentRow[];
  sources: DebtBreakdownSourceRow[];
  totals: {
    openOrdersDebtVisible: number;
    openOrdersDebtHidden: number;
    openOrdersDebtAll: number;
    otherSourcesTotal: number;
    currentDebt: number;
    unexplainedDifference: number;
  };
  mismatch: boolean;
  explanationText: string;
};
