import type { Prisma } from "@prisma/client";
import { OS } from "@/lib/order-status-slugs";

export type OrderMoneyUsdFields = {
  status: string;
  totalUsd?: Prisma.Decimal | number | string | null;
  amountUsd?: Prisma.Decimal | number | string | null;
  commissionUsd?: Prisma.Decimal | number | string | null;
  debtWithdrawalUsd?: Prisma.Decimal | number | string | null;
};

export function isDebtWithdrawalOrderStatus(status: string): boolean {
  return status === OS.DEBT_WITHDRAWAL;
}

export function orderUsdTotalValue(o: Pick<OrderMoneyUsdFields, "totalUsd" | "amountUsd" | "commissionUsd">): number {
  if (o.totalUsd != null) {
    const n = Number(o.totalUsd);
    if (Number.isFinite(n)) return n;
  }
  const deal = Number(o.amountUsd ?? 0);
  const fee = Number(o.commissionUsd ?? 0);
  const sum = (Number.isFinite(deal) ? deal : 0) + (Number.isFinite(fee) ? fee : 0);
  return Number.isFinite(sum) ? sum : 0;
}

/** סכום USD שמגדיל חוב לקוח (הזמנה רגילה בלבד). */
export function orderCustomerChargeUsd(o: OrderMoneyUsdFields): number {
  if (isDebtWithdrawalOrderStatus(o.status)) return 0;
  return Math.max(0, orderUsdTotalValue(o));
}

/** סכום USD שמקטין חוב (משיכה מחוב — זיכוי). */
export function orderCustomerCreditUsd(o: OrderMoneyUsdFields): number {
  if (!isDebtWithdrawalOrderStatus(o.status)) return 0;
  const applied = o.debtWithdrawalUsd != null ? Number(o.debtWithdrawalUsd) : 0;
  if (Number.isFinite(applied) && applied > 0) return applied;
  return Math.max(0, orderUsdTotalValue(o));
}

/** לתצוגה: שלילי למשיכה מחוב, חיובי להזמנה רגילה. */
export function orderDisplayUsdSigned(o: OrderMoneyUsdFields): number {
  if (isDebtWithdrawalOrderStatus(o.status)) {
    const credit = orderCustomerCreditUsd(o);
    return credit > 0 ? -credit : 0;
  }
  return orderUsdTotalValue(o);
}

export function formatSignedUsdDisplay(signed: number): string {
  const abs = Math.abs(signed);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  if (signed < -0.0001) return `-${formatted}`;
  return formatted;
}

export const DEBT_WITHDRAWAL_LEDGER_LABEL = "משיכה מחוב";
