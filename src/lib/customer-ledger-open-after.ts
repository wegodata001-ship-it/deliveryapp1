import type { CustomerLedgerRow } from "@/lib/customer-account-ledger";

export function ledgerRowOpenDebtAfterUsd(row: CustomerLedgerRow): string {
  if (row.kind === "PAYMENT" && !row.isPaymentCancelled && row.paymentReconciliation) {
    return row.paymentReconciliation.openDebtAfter.toFixed(2);
  }
  return row.balanceUsd;
}
