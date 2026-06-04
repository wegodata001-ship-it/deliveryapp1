import { Prisma } from "@prisma/client";

/** שורת כרטסת — איפוס עמלה בודד מתוך קליטת תשלום */
export const COMMISSION_DEBT_CLOSURE_LEDGER_LABEL = "סגירת חוב באמצעות עמלה";

/** שורת כרטסת / היסטוריה — איפוס יתרה (לא תשלום) */
export const BALANCE_RESET_LEDGER_LABEL = "איפוס יתרה";

export type CommissionDebtClosurePlan = {
  /** יתרת הזמנה לפני האיפוס (X) */
  remainingUsd: Prisma.Decimal;
  beforeCommissionUsd: Prisma.Decimal;
  beforeTotalUsd: Prisma.Decimal;
  paidUsd: Prisma.Decimal;
  afterCommissionUsd: Prisma.Decimal;
  afterTotalUsd: Prisma.Decimal;
};

/**
 * איפוס עמלה / יתרה — העברת חוב היתרה לעמלה:
 * עמלה_חדשה = Y − X, יתרה_חדשה = 0 (total = שולם).
 */
export function planCommissionDebtClosure(params: {
  commissionUsd: Prisma.Decimal;
  totalUsd: Prisma.Decimal;
  paidUsd: Prisma.Decimal;
}): CommissionDebtClosurePlan {
  const beforeCom = params.commissionUsd;
  const beforeTotal = params.totalUsd;
  const paid = params.paidUsd;
  const remaining = beforeTotal.sub(paid).toDecimalPlaces(4, 4);
  const afterCom = beforeCom.sub(remaining).toDecimalPlaces(4, 4);
  const afterTotal = paid.toDecimalPlaces(4, 4);
  return {
    remainingUsd: remaining,
    beforeCommissionUsd: beforeCom,
    beforeTotalUsd: beforeTotal,
    paidUsd: paid,
    afterCommissionUsd: afterCom,
    afterTotalUsd: afterTotal,
  };
}

export function planCommissionDebtClosureFromNumbers(params: {
  commissionUsd: number;
  totalUsd: number;
  paidUsd: number;
}): {
  remainingUsd: number;
  beforeCommissionUsd: number;
  afterCommissionUsd: number;
  afterTotalUsd: number;
} {
  const remaining = Math.round((params.totalUsd - params.paidUsd) * 100) / 100;
  const afterCommission = Math.round((params.commissionUsd - remaining) * 100) / 100;
  return {
    remainingUsd: remaining,
    beforeCommissionUsd: params.commissionUsd,
    afterCommissionUsd: afterCommission,
    afterTotalUsd: Math.round(params.paidUsd * 100) / 100,
  };
}
