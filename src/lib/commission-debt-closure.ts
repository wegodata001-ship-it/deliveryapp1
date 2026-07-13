import { Prisma } from "@prisma/client";
import { calculateBalanceReset } from "@/lib/balance-reset-calculation";

/** שורת כרטסת — איפוס עמלה בודד מתוך קליטת תשלום */
export const COMMISSION_DEBT_CLOSURE_LEDGER_LABEL = "סגירת חוב באמצעות עמלה";

/** שורת כרטסת — ספיגת הפרש קטן בין תשלום לחוב (עד $5) */
export const PAYMENT_SMALL_OVERAGE_COMMISSION_ABSORPTION_LABEL = "ספיגת הפרש קטן בעמלה";

/** שורת כרטסת / היסטוריה — איפוס יתרה (לא תשלום) */
export const BALANCE_RESET_LEDGER_LABEL = "איפוס יתרה";

/** שורת כרטסת — איפוס יתרה מתוך יתרת זכות קיימת */
export const BALANCE_RESET_FROM_CREDIT_LEDGER_LABEL = "איפוס יתרה מתוך יתרת זכות";

/** שורת כרטסת — עודף תשלום שהועבר לעמלה לפי בחירת משתמש */
export const PAYMENT_SURPLUS_TO_COMMISSION_LEDGER_LABEL = "העודף הועבר לעמלה לפי בחירת המשתמש";

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

/** ספיגת עודף תשלום קטן — העברת ההפרש לעמלה וסגירת יתרה ל-0. */
export function planCommissionSurplusAbsorption(params: {
  commissionUsd: Prisma.Decimal;
  totalUsd: Prisma.Decimal;
  surplusUsd: Prisma.Decimal;
}): CommissionDebtClosurePlan {
  const surplus = params.surplusUsd.abs().toDecimalPlaces(4, 4);
  const afterCom = params.commissionUsd.add(surplus).toDecimalPlaces(4, 4);
  const afterTotal = params.totalUsd.add(surplus).toDecimalPlaces(4, 4);
  return {
    remainingUsd: surplus.neg(),
    beforeCommissionUsd: params.commissionUsd,
    beforeTotalUsd: params.totalUsd,
    paidUsd: afterTotal,
    afterCommissionUsd: afterCom,
    afterTotalUsd: afterTotal,
  };
}

/**
 * איפוס יתרה — סגירה מלאה ל-0 באמצעות התאמת עמלה:
 * עמלה_חדשה = עמלה_קיימת + (שולם − סה״כ לפני).
 */
export function planBalanceResetToZero(params: {
  commissionUsd: Prisma.Decimal;
  totalUsd: Prisma.Decimal;
  paidUsd: Prisma.Decimal;
}): CommissionDebtClosurePlan {
  const calc = calculateBalanceReset({
    totalBeforeUsd: Number(params.totalUsd),
    paidUsd: Number(params.paidUsd),
    commissionBeforeUsd: Number(params.commissionUsd),
  });
  return {
    remainingUsd: new Prisma.Decimal(calc.balanceBeforeUsd.toFixed(4)),
    beforeCommissionUsd: params.commissionUsd,
    beforeTotalUsd: params.totalUsd,
    paidUsd: params.paidUsd,
    afterCommissionUsd: new Prisma.Decimal(calc.commissionAfterUsd.toFixed(4)),
    afterTotalUsd: new Prisma.Decimal(calc.totalAfterUsd.toFixed(4)),
  };
}

export function planBalanceResetToZeroFromNumbers(params: {
  commissionUsd: number;
  totalUsd: number;
  paidUsd: number;
}): {
  remainingUsd: number;
  beforeCommissionUsd: number;
  afterCommissionUsd: number;
  afterTotalUsd: number;
} {
  const calc = calculateBalanceReset({
    totalBeforeUsd: params.totalUsd,
    paidUsd: params.paidUsd,
    commissionBeforeUsd: params.commissionUsd,
  });
  return {
    remainingUsd: calc.balanceBeforeUsd,
    beforeCommissionUsd: params.commissionUsd,
    afterCommissionUsd: calc.commissionAfterUsd,
    afterTotalUsd: calc.totalAfterUsd,
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
