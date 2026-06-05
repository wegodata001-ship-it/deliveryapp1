import { Prisma } from "@prisma/client";
import {
  calculateCustomerBalance,
  type CustomerBalanceScope,
} from "@/lib/customer-balance-calculator";
import {
  DEFAULT_WORK_COUNTRY,
  orderSourceCountryFromWorkCountry,
  normalizeWorkCountryCode,
  type WorkCountryCode,
} from "@/lib/work-country";

const EPS = new Prisma.Decimal("0.01");

export type CustomerOpenDebtResult = {
  customerId: string;
  /** סה״כ הזמנות (עסקה+עמלה) — ללא מבוטלות וללא משיכות מחוב */
  totalOrdersUsd: Prisma.Decimal;
  /** תשלומים שנקלטו בפועל (פעילים) */
  totalPaymentsUsd: Prisma.Decimal;
  /** משיכות מחוב (מקטינות חוב) */
  totalWithdrawalsUsd: Prisma.Decimal;
  /**
   * יתרה עסקית: הזמנות − תשלומים − משיכות.
   * חיובי = חוב פתוח, שלילי = יתרת זכות.
   */
  signedBalanceUsd: Prisma.Decimal;
  /** max(0, signedBalanceUsd) — סכום החוב הפתוח להצגה */
  openDebtUsd: Prisma.Decimal;
  /**
   * יתרה פנימית: תשלומים + משיכות − הזמנות (שלילי = חוב).
   * תואם שדה Customer.balanceUsd והקליטה.
   */
  internalSignedUsd: Prisma.Decimal;
};

/**
 * Single source of truth — חוב פתוח ללקוח:
 * סה״כ הזמנות (כולל עמלה, ללא מבוטלות) − תשלומים שנקלטו − משיכות מחוב.
 */
export async function getCustomerOpenDebt(
  customerId: string,
  scope: CustomerBalanceScope = {},
): Promise<CustomerOpenDebtResult> {
  const id = customerId.trim();
  const calc = await calculateCustomerBalance(id, scope);
  const signedBalanceUsd = calc.balance.toDecimalPlaces(2, 4);
  const openDebtUsd = signedBalanceUsd.gt(EPS) ? signedBalanceUsd : new Prisma.Decimal(0);
  const internalSignedUsd = calc.totalPayments
    .add(calc.totalWithdrawals)
    .sub(calc.totalOrders)
    .toDecimalPlaces(2, 4);

  return {
    customerId: id,
    totalOrdersUsd: calc.totalOrders,
    totalPaymentsUsd: calc.totalPayments,
    totalWithdrawalsUsd: calc.totalWithdrawals,
    signedBalanceUsd,
    openDebtUsd,
    internalSignedUsd,
  };
}

export function scopeFromWorkCountryParam(
  workCountry: string | null | undefined,
): CustomerBalanceScope {
  const wc = normalizeWorkCountryCode(workCountry) ?? DEFAULT_WORK_COUNTRY;
  return { sourceCountry: orderSourceCountryFromWorkCountry(wc) };
}

export function openDebtScopeForWorkCountry(
  workCountry: string | null | undefined,
): CustomerBalanceScope {
  return scopeFromWorkCountryParam(workCountry);
}

export { resolveWorkCountryOrDefault } from "@/lib/work-country";

/** מספר לתצוגה — חוב פתוח (לא שלילי) */
export async function getCustomerOpenDebtUsdNumber(
  customerId: string,
  scope: CustomerBalanceScope = {},
): Promise<number> {
  const r = await getCustomerOpenDebt(customerId, scope);
  return Number(r.openDebtUsd.toFixed(2));
}

/** יתרה פנימית לשמירה ב-Customer.balanceUsd */
export async function getCustomerInternalBalanceUsd(
  customerId: string,
  scope: CustomerBalanceScope = {},
): Promise<Prisma.Decimal> {
  const r = await getCustomerOpenDebt(customerId, scope);
  return r.internalSignedUsd;
}
