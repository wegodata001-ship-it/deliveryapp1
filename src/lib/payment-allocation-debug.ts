import {
  allocatePaymentAcrossOrders,
  orderLedgerBalanceUsd,
  roundMoney2,
  type PaymentIntakeOrderBase,
} from "@/lib/payment-intake";

const ALLOC_EPS = 0.02;

export type PaymentAllocationDebugInput = {
  source: "payment-modal" | "payment-save-server" | "payment-save-matching-engine";
  customerId: string | null;
  customerLoaded: boolean;
  ordersLoading?: boolean;
  ordersCount: number;
  paymentAmountUsd: number;
  /** null = כל ההזמנות עם חוב; מערך ריק = אין סימון ידני */
  selectedOrderIds: string[] | null;
  weekCode: string | null;
  bases: PaymentIntakeOrderBase[];
  prioritizedOrderIds: Set<string> | null;
  forceCustomerCreditPayment?: boolean;
  /** חיפוש קוד לקוח ב-exact (רלוונטי רק במסך) */
  lastCustomerSearchExactOnly?: boolean;
  custSearchNoHits?: boolean;
};

export type PaymentAllocationDebugResult = {
  openOrdersCount: number;
  openBalanceUsd: number;
  allocationTargets: Array<{ orderId: string; amountUsd: number }>;
  unallocatedUsd: number;
  emptyReasons: string[];
};

function openDebtOrders(bases: PaymentIntakeOrderBase[]): PaymentIntakeOrderBase[] {
  return bases.filter((o) => orderLedgerBalanceUsd(o) > ALLOC_EPS);
}

function closedOrdersCount(bases: PaymentIntakeOrderBase[]): number {
  return bases.filter((o) => orderLedgerBalanceUsd(o) <= ALLOC_EPS).length;
}

export function diagnosePaymentAllocation(input: PaymentAllocationDebugInput): PaymentAllocationDebugResult {
  const openOrders = openDebtOrders(input.bases);
  const openBalanceUsd = roundMoney2(
    openOrders.reduce((sum, o) => sum + Math.max(0, orderLedgerBalanceUsd(o)), 0),
  );

  const alloc =
    input.forceCustomerCreditPayment && input.paymentAmountUsd > ALLOC_EPS
      ? { byOrderId: new Map<string, number>(), unallocatedUsd: input.paymentAmountUsd }
      : allocatePaymentAcrossOrders(input.bases, input.paymentAmountUsd, input.prioritizedOrderIds);

  const allocationTargets = [...alloc.byOrderId.entries()]
    .filter(([, amt]) => amt > ALLOC_EPS)
    .map(([orderId, amountUsd]) => ({ orderId, amountUsd: roundMoney2(amountUsd) }));

  const emptyReasons: string[] = [];

  if (!input.customerLoaded || !input.customerId) {
    emptyReasons.push("לקוח לא נטען");
  }
  if (input.ordersLoading) {
    emptyReasons.push("הזמנות עדיין בטעינה");
  }
  if (input.ordersCount === 0) {
    emptyReasons.push("אין הזמנות ברשימה (ריק או לא נטען)");
  }
  if (input.ordersCount > 0 && openOrders.length === 0) {
    emptyReasons.push("אין הזמנות פתוחות");
    if (closedOrdersCount(input.bases) === input.ordersCount) {
      emptyReasons.push("הזמנות סגורות (יתרה 0)");
    }
  }
  if (openBalanceUsd <= ALLOC_EPS && input.paymentAmountUsd > ALLOC_EPS) {
    emptyReasons.push("יתרה פתוחה = 0");
  }
  if (input.weekCode?.trim() && input.ordersCount > 0 && openOrders.length === 0) {
    emptyReasons.push("תאריך/שבוע עשוי לסנן הזמנות עם חוב (orderDate אחרי סוף שבוע)");
  }
  if (
    input.prioritizedOrderIds &&
    input.prioritizedOrderIds.size > 0 &&
    openOrders.every((o) => !input.prioritizedOrderIds!.has(o.id))
  ) {
    emptyReasons.push("ההזמנות המסומנות לסגירה ללא חוב פתוח");
  }
  if (input.lastCustomerSearchExactOnly && input.custSearchNoHits) {
    emptyReasons.push("exactOnly — חיפוש קוד ללא התאמה (לפני בחירה)");
  }
  if (input.forceCustomerCreditPayment) {
    emptyReasons.push("לקוח בזכות — הקצאה להזמנות מדולגת (עודף כיתרת)");
  }
  if (input.paymentAmountUsd <= ALLOC_EPS) {
    emptyReasons.push("סכום תשלום 0 או לא תקין");
  }

  return {
    openOrdersCount: openOrders.length,
    openBalanceUsd,
    allocationTargets,
    unallocatedUsd: roundMoney2(alloc.unallocatedUsd),
    emptyReasons,
  };
}

export function logPaymentAllocationPreSave(
  input: PaymentAllocationDebugInput,
): PaymentAllocationDebugResult {
  const diag = diagnosePaymentAllocation(input);

  console.log("[payment-allocation] pre-save", {
    source: input.source,
    customerId: input.customerId,
    paymentAmount: roundMoney2(input.paymentAmountUsd),
    selectedOrderIds: input.selectedOrderIds,
    openOrdersCount: diag.openOrdersCount,
    openBalance: diag.openBalanceUsd,
    allocationTargets: diag.allocationTargets,
    weekCode: input.weekCode,
    ordersCount: input.ordersCount,
    unallocatedUsd: diag.unallocatedUsd,
  });

  if (diag.allocationTargets.length === 0) {
    console.warn("[payment-allocation] אין יעד להקצאה — למה אין יעד:", diag.emptyReasons.length > 0 ? diag.emptyReasons : [
      "אין הזמנות פתוחות",
      "תאריך מסנן הכל",
      "לקוח לא נטען",
      "exactOnly חוסם תוצאות",
      "יתרה פתוחה = 0",
      "הזמנות סגורות",
    ]);
  }

  return diag;
}
