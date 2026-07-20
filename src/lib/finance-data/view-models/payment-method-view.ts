import type { MoneyCurrency } from "@/lib/finance-data/types";

export type PaymentMethodViewStatus = "paid" | "partial" | "open";

/**
 * Per-method planned / paid / remaining in native currency.
 * Used by Planned Payment Methods (PMC) after migration.
 *
 * remaining is method capacity (snapshot or derived) — not Ledger Open Debt.
 */
export type PaymentMethodView = {
  id: string;
  orderId: string;
  orderNumber: string | null;
  paymentMethod: string;
  currency: MoneyCurrency;
  planned: number;
  paid: number;
  remaining: number;
  status: PaymentMethodViewStatus;
};
