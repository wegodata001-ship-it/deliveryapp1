import { roundOrderMoney2 } from "@/lib/order-remaining-debt";

export type CommissionResetPreviewNumbers = {
  resetUsd: number;
  commissionAfterUsd: number;
};

/** תצוגת popup — ללא DB */
export function computeCommissionResetPreviewNumbers(
  openDebtUsd: number,
  commissionBalanceUsd: number,
): CommissionResetPreviewNumbers {
  const resetUsd = roundOrderMoney2(openDebtUsd);
  const commissionAfterUsd = roundOrderMoney2(commissionBalanceUsd - resetUsd);
  return { resetUsd, commissionAfterUsd };
}
