/**
 * Preview בלבד לקליטת תשלום — לא כותב SSOT ולא מקצה להזמנות.
 * remaining = max(0, netDebt − draftPayment)
 * חוב וזכות כבר מקוזזים ב-SSOT — אין קיזוז זכות נוסף.
 * Fees לא נכנסות לחוב.
 */
import { normalizeExclusiveCustomerBooks } from "@/lib/customer-account-balances-shared";
import { computeOrderOpenDebtUsd, resolveOrderTotalUsd, roundOrderMoney2 } from "@/lib/order-remaining-debt";

export type PaymentPreviewFinancialState = {
  openDebtUsd: number | null;
  availableCreditUsd: number;
  commissionBalanceUsd: number;
};

export type PaymentPreviewOrder = {
  totalAmountUsd?: number;
  totalUsd?: number;
  amountUsd?: number;
  commissionUsd?: number;
  dbPaidUsd?: number;
  collectibleRemainingUsd?: number;
  isDebtWithdrawal?: boolean;
  status?: string;
};

export type PaymentIntakePreview = {
  debtBefore: number;
  selectedOrdersRemaining: number;
  existingCredit: number;
  draftPaymentTotal: number;
  remainingDebt: number;
  projectedCredit: number;
  projectedOverpayment: number;
  fees: number;
};

export function sumOpenOrderRemainingUsd(orders: readonly PaymentPreviewOrder[]): number {
  let sum = 0;
  for (const order of orders) {
    if (order.isDebtWithdrawal || order.status === "DEBT_WITHDRAWAL") continue;
    if (order.collectibleRemainingUsd != null && Number.isFinite(order.collectibleRemainingUsd)) {
      sum += Math.max(0, order.collectibleRemainingUsd);
      continue;
    }
    const total = resolveOrderTotalUsd({
      totalUsd: order.totalAmountUsd ?? order.totalUsd,
      amountUsd: order.amountUsd,
      commissionUsd: order.commissionUsd,
    });
    sum += computeOrderOpenDebtUsd(total, Number(order.dbPaidUsd) || 0);
  }
  return roundOrderMoney2(sum);
}

function money2(n: number): number {
  return roundOrderMoney2(Number.isFinite(n) ? n : 0);
}

/**
 * חוב ל-preview:
 * 1. SSOT לקוח כשנטען — גם אם $0 (חוב נטו אחרי קיזוז).
 * 2. אחרת יתרות הזמנות פתוחות.
 */
export function resolvePaymentPreviewCollectibleDebt(input: {
  customerOpenDebtUsd: number | null;
  selectedOrdersRemainingUsd: number;
  ssotLoaded: boolean;
}): number {
  const ordersRemaining = money2(Math.max(0, input.selectedOrdersRemainingUsd));
  if (!input.ssotLoaded || input.customerOpenDebtUsd == null) return ordersRemaining;
  return money2(Math.max(0, input.customerOpenDebtUsd));
}

export function buildPaymentPreview(input: {
  financialState: PaymentPreviewFinancialState;
  draftPaymentUsd: number;
  selectedOrders?: readonly PaymentPreviewOrder[];
  selectedOrdersRemainingUsd?: number;
  /** קיזוז יתרת זכות קיימת — רק אם המשתמש/המנוע הפעיל זאת */
  useExistingCredit?: boolean;
}): PaymentIntakePreview {
  const ssotLoaded = input.financialState.openDebtUsd != null;
  const fees = money2(input.financialState.commissionBalanceUsd);
  const selectedOrdersRemaining =
    input.selectedOrdersRemainingUsd != null
      ? money2(Math.max(0, input.selectedOrdersRemainingUsd))
      : sumOpenOrderRemainingUsd(input.selectedOrders ?? []);
  const draftPaymentTotal = money2(Math.max(0, input.draftPaymentUsd));
  const rawDebt = ssotLoaded
    ? resolvePaymentPreviewCollectibleDebt({
        customerOpenDebtUsd: input.financialState.openDebtUsd,
        selectedOrdersRemainingUsd: selectedOrdersRemaining,
        ssotLoaded,
      })
    : selectedOrdersRemaining;
  const books = normalizeExclusiveCustomerBooks({
    openDebtUsd: rawDebt,
    availableCreditUsd: input.financialState.availableCreditUsd,
  });
  const debtBefore = books.openDebtUsd;
  const existingCredit = books.availableCreditUsd;
  const collectible = debtBefore;
  const remainingDebt = money2(Math.max(0, collectible - draftPaymentTotal));
  const leftoverDraft = money2(Math.max(0, draftPaymentTotal - collectible));
  const projectedOverpayment = leftoverDraft;
  const projectedCredit = money2(existingCredit + leftoverDraft);

  return {
    debtBefore,
    selectedOrdersRemaining,
    existingCredit,
    draftPaymentTotal,
    remainingDebt,
    projectedCredit,
    projectedOverpayment,
    fees,
  };
}
