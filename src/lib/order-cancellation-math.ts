import {
  isDebtWithdrawalOrderStatus,
  orderCustomerChargeUsd,
  orderCustomerCreditUsd,
  type OrderMoneyUsdFields,
} from "@/lib/debt-withdrawal-order";

/** שינוי ביתרה הפנימית (Customer.balanceUsd) בעת ביטול — חיובי = יתרה עולה */
export function orderCancellationReversalInternalUsd(o: OrderMoneyUsdFields): number {
  if (isDebtWithdrawalOrderStatus(o.status)) {
    return -orderCustomerCreditUsd(o);
  }
  return orderCustomerChargeUsd(o);
}

export function expectedInternalBalanceAfterOrderCancel(
  balanceBeforeInternalUsd: number,
  orderAmountUsd: number,
): number {
  return balanceBeforeInternalUsd + orderAmountUsd;
}
