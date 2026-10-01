/**
 * SSOT — פירוק תשלום מול חוב פתוח.
 * received ≠ applied. חוב אחרי = max(0, חוב לפני − נסגר מהחוב).
 * לא כותב ל-DB.
 */
import { roundMoney2 } from "@/lib/payment-intake";
import {
  resolveSurplusDestinationAmounts,
  type SurplusDestination,
} from "@/lib/payment-debt-surplus-split";

const EPS = 0.02;

export type PaymentSurplusDestination = SurplusDestination;

export type PaymentReconciliation = {
  openDebtBefore: number;
  receivedAmount: number;
  appliedToDebt: number;
  surplusAmount: number;
  surplusToCredit: number;
  surplusToCommission: number;
  unallocated: number;
  surplusDestination: PaymentSurplusDestination;
  openDebtAfter: number;
};

export function paymentReconciliationOpenDebtAfter(openDebtBefore: number, appliedToDebt: number): number {
  return roundMoney2(Math.max(0, roundMoney2(Math.max(0, openDebtBefore)) - roundMoney2(Math.max(0, appliedToDebt))));
}

export function resolvePaymentSurplusDestination(input: {
  surplusToCredit: number;
  surplusToCommission: number;
}): PaymentSurplusDestination {
  const credit = roundMoney2(Math.max(0, input.surplusToCredit));
  const commission = roundMoney2(Math.max(0, input.surplusToCommission));
  if (commission > EPS && credit <= EPS) return "commission";
  if (credit > EPS && commission <= EPS) return "credit";
  if (credit <= EPS && commission <= EPS) return "none";
  return "none";
}

export function buildPaymentReconciliation(input: {
  openDebtBefore: number;
  receivedAmount: number;
  appliedToDebt: number;
  surplusToCredit?: number;
  surplusToCommission?: number;
  unallocated?: number;
}): PaymentReconciliation {
  const openDebtBefore = roundMoney2(Math.max(0, Number(input.openDebtBefore) || 0));
  const receivedAmount = roundMoney2(Math.max(0, Number(input.receivedAmount) || 0));
  const appliedToDebt = roundMoney2(Math.max(0, Number(input.appliedToDebt) || 0));
  const surplusToCredit = roundMoney2(Math.max(0, Number(input.surplusToCredit) || 0));
  const surplusToCommission = roundMoney2(Math.max(0, Number(input.surplusToCommission) || 0));
  const leftover = roundMoney2(Math.max(0, receivedAmount - appliedToDebt - surplusToCredit - surplusToCommission));
  const unallocated = input.unallocated != null ? roundMoney2(Math.max(0, input.unallocated)) : leftover;
  const surplusAmount = roundMoney2(surplusToCredit + surplusToCommission + unallocated);
  const surplusDestination = resolvePaymentSurplusDestination({ surplusToCredit, surplusToCommission });
  return {
    openDebtBefore,
    receivedAmount,
    appliedToDebt,
    surplusAmount,
    surplusToCredit,
    surplusToCommission,
    unallocated,
    surplusDestination,
    openDebtAfter: paymentReconciliationOpenDebtAfter(openDebtBefore, appliedToDebt),
  };
}

export function paymentReconciliationInvariantsHold(row: PaymentReconciliation, eps = EPS): boolean {
  const receivedSplit = roundMoney2(
    row.appliedToDebt + row.surplusToCredit + row.surplusToCommission + row.unallocated,
  );
  const after = paymentReconciliationOpenDebtAfter(row.openDebtBefore, row.appliedToDebt);
  return (
    Math.abs(receivedSplit - row.receivedAmount) <= eps &&
    Math.abs(after - row.openDebtAfter) <= eps &&
    row.openDebtAfter >= -eps
  );
}

export function surplusDestinationLabelHe(destination: PaymentSurplusDestination): string | null {
  if (destination === "commission") return "עמלות";
  if (destination === "credit") return "יתרת זכות";
  return null;
}

export function assertPaymentReconciliation(row: PaymentReconciliation): PaymentReconciliation {
  if (!paymentReconciliationInvariantsHold(row)) {
    throw new Error(
      `Payment reconciliation mismatch: received=${row.receivedAmount} applied=${row.appliedToDebt} credit=${row.surplusToCredit} commission=${row.surplusToCommission} unallocated=${row.unallocated} before=${row.openDebtBefore} after=${row.openDebtAfter}`,
    );
  }
  const dest = resolveSurplusDestinationAmounts(
    {
      receivedAmount: row.receivedAmount,
      debtBefore: row.openDebtBefore,
      debtApplied: row.appliedToDebt,
      surplusAmount: row.surplusAmount,
      allocateToDebtUsd: row.appliedToDebt,
      surplusUsd: row.surplusAmount,
    },
    row.surplusDestination,
  );
  if (row.unallocated <= EPS) {
    if (row.surplusDestination === "commission" && Math.abs(dest.toCommission - row.surplusToCommission) > EPS) {
      throw new Error("Commission surplus destination does not match surplus amount");
    }
    if (row.surplusDestination === "credit" && Math.abs(dest.toCredit - row.surplusToCredit) > EPS) {
      throw new Error("Credit surplus destination does not match surplus amount");
    }
  }
  return row;
}
