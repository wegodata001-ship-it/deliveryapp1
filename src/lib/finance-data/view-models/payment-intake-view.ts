import type { OrderBalanceView } from "./order-balance-view";
import type { PaymentMethodView } from "./payment-method-view";
import type { PaymentSummaryView } from "./payment-summary-view";

/**
 * Full intake payload for one customer (or selection of orders).
 * Screens render this — they must not recompute Ledger or Matching.
 */
export type PaymentIntakeView = {
  customerId: string;
  customerCode: string | null;
  customerName: string;
  orders: OrderBalanceView[];
  methods: PaymentMethodView[];
  summary: PaymentSummaryView;
  /**
   * Consistency flag from validators (Σ method remaining vs Ledger open debt).
   * Phase 1 surfaces the check; screens are not wired yet.
   */
  breakdownMatchesLedger: boolean;
};
