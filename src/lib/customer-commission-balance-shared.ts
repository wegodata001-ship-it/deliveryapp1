/** בחירת משתמש — קיזוז מיתרת עמלה (מודל חדש, ללא שינוי הזמנה). */
export const COMMISSION_POOL_DEBIT_USER_CHOICE = "commission_pool_debit";

/** legacy — מקושר להפחתת commissionUsd על ההזמנה; לא מכפילים ביתרה. */
export const LEGACY_COMMISSION_ORDER_MUTATION_FEE_CHOICE = "fee_adjustment_negative";

export function isLegacyCommissionOrderMutationFee(userChoice: string | null | undefined): boolean {
  return (userChoice ?? "").trim() === LEGACY_COMMISSION_ORDER_MUTATION_FEE_CHOICE;
}

export function isCommissionPoolDebitFee(userChoice: string | null | undefined): boolean {
  return (userChoice ?? "").trim() === COMMISSION_POOL_DEBIT_USER_CHOICE;
}
