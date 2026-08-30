/**
 * פיצול תשלום: הקצאה לחוב לקוח (SSOT) + עודף ליתרת זכות/עמלה.
 * לא דורש הזמנה פתוחה עבור חלק העודף עצמו.
 */
import { computePaymentOverpayment } from "@/lib/payment-overpayment";
import { roundMoney2 } from "@/lib/payment-intake";

const EPS = 0.02;

export type DebtSurplusSplit = {
  /** סכום שיש להקצות להזמנות (סגירת חוב) */
  allocateToDebtUsd: number;
  /** עודף לתשלום כיתרת זכות / עמלות — ללא שיוך להזמנה */
  surplusUsd: number;
};

/** כמה מהתשלום סוגר חוב וכמה עודף — לפי חוב לקוח SSOT */
export function splitPaymentAgainstCustomerDebt(
  customerOpenDebtUsd: number,
  paymentUsd: number,
): DebtSurplusSplit {
  const overpay = computePaymentOverpayment(customerOpenDebtUsd, paymentUsd);
  return {
    allocateToDebtUsd: overpay.closesDebtUsd,
    surplusUsd: overpay.overpaymentUsd,
  };
}

/**
 * לאחר Matching/FIFO: מצמצם הקצאה כך שלא תעלה על חוב הלקוח,
 * ומחזיר את העודף כ-unallocated (לקרדיט/עמלה).
 */
export function alignAllocationToCustomerDebtSurplus(params: {
  allocationEntries: Array<[string, number]>;
  customerOpenDebtUsd: number;
  paymentUsd: number;
}): { allocationEntries: Array<[string, number]>; unallocatedUsd: number } {
  const split = splitPaymentAgainstCustomerDebt(params.customerOpenDebtUsd, params.paymentUsd);
  const entries: Array<[string, number]> = params.allocationEntries.map(([id, amt]) => [
    id,
    roundMoney2(amt),
  ]);

  let allocatedSum = roundMoney2(entries.reduce((s, [, a]) => s + a, 0));
  let peel = roundMoney2(Math.max(0, allocatedSum - split.allocateToDebtUsd));

  for (let i = entries.length - 1; i >= 0 && peel > EPS; i--) {
    const [oid, amt] = entries[i]!;
    const take = roundMoney2(Math.min(amt, peel));
    const next = roundMoney2(amt - take);
    if (next <= EPS) entries.splice(i, 1);
    else entries[i] = [oid, next];
    peel = roundMoney2(peel - take);
  }

  allocatedSum = roundMoney2(entries.reduce((s, [, a]) => s + a, 0));
  const unallocatedUsd = roundMoney2(Math.max(0, params.paymentUsd - allocatedSum));
  return { allocationEntries: entries, unallocatedUsd };
}

/** האם מותר לשמור בלי שורות הקצאה להזמנות (עודף טהור כקרדיט/עמלה) */
export function canSaveSurplusWithoutOrderAllocation(params: {
  surplusAsCredit: boolean;
  surplusToCommission: boolean;
  surplusForfeit?: boolean;
  unallocatedUsd: number;
  customerOpenDebtUsd: number;
}): boolean {
  const hasDisposition =
    params.surplusAsCredit || params.surplusToCommission || Boolean(params.surplusForfeit);
  return (
    hasDisposition &&
    params.unallocatedUsd > EPS &&
    params.customerOpenDebtUsd <= EPS
  );
}
