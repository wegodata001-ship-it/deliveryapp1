/**
 * יתרה פתוחה שבועית נכון לרגע קליטה (createdAt), לפי cutoff של שבוע התשלום.
 * לא כותב ל-DB. לא משתמש ביתרה הנוכחית כחותמת היסטורית.
 */
import { normalizeExclusiveCustomerBooks } from "@/lib/customer-account-balances-shared";
import { isDebtWithdrawalOrderStatus, orderCustomerCreditUsd } from "@/lib/debt-withdrawal-order";
import { OS } from "@/lib/order-status-slugs";
import { intakeOrderEligibleForSelectedWeek } from "@/lib/payment-intake-order-filter";
import { roundMoney2 } from "@/lib/payment-intake";
import { getWeekCodeForLocalDate, normalizeAhWeekCode } from "@/lib/work-week";

const EPS = 0.02;

export type WeekScopedOrderFact = {
  id: string;
  orderDate: Date | null;
  weekCode: string | null;
  status: string;
  totalUsd: number;
  amountUsd: number;
  commissionUsd: number;
  debtWithdrawalUsd: number;
  createdAt: Date;
  deletedAt?: Date | null;
};

export type WeekScopedPaymentFact = {
  id: string;
  orderId: string | null;
  amountUsd: number;
  businessType: string | null;
  status: string | null;
  isPaid?: boolean;
  createdAt: Date;
};

function money(n: unknown): number {
  return roundMoney2(Number(n) || 0);
}

function isActive(p: WeekScopedPaymentFact): boolean {
  if (p.status === "CANCELLED") return false;
  return p.status === "ACTIVE" || p.isPaid === true;
}

function isDebtPayment(businessType: string | null | undefined): boolean {
  return businessType !== "ADJUSTMENT_FEE" && businessType !== "CUSTOMER_CREDIT" && businessType !== "BALANCE_RESET";
}

function fifoApply(remainders: number[], amount: number): number[] {
  let left = money(Math.max(0, amount));
  return remainders.map((raw) => {
    const rem = money(Math.max(0, raw));
    if (left <= EPS || rem <= EPS) return rem;
    const take = money(Math.min(rem, left));
    left = money(left - take);
    return money(rem - take);
  });
}

function applyCredit(remainders: number[], credit: number): number[] {
  const gross = money(remainders.reduce((s, n) => s + money(Math.max(0, n)), 0));
  const books = normalizeExclusiveCustomerBooks({
    openDebtUsd: gross,
    availableCreditUsd: money(Math.max(0, credit)),
  });
  const take = money(gross - books.openDebtUsd);
  return fifoApply(remainders, take);
}

function orderEligible(order: WeekScopedOrderFact, cutoffWeek: string | null): boolean {
  if (!cutoffWeek) return true;
  const orderWeek = normalizeAhWeekCode(order.weekCode) ?? (order.orderDate ? getWeekCodeForLocalDate(order.orderDate) : null);
  return intakeOrderEligibleForSelectedWeek({
    orderDate: order.orderDate,
    weekCodeRaw: cutoffWeek,
    orderWeekCode: orderWeek,
  });
}

export function reconstructWeekScopedOpenDebt(params: {
  orders: WeekScopedOrderFact[];
  payments: WeekScopedPaymentFact[];
  asOfCreatedAt: Date;
  cutoffWeek: string | null;
  excludePaymentIds: ReadonlySet<string>;
}): number {
  const asOf = params.asOfCreatedAt.getTime();
  const customerOrders = params.orders.filter(
    (o) => o.deletedAt == null && o.status !== OS.CANCELLED && o.createdAt.getTime() < asOf,
  );
  const chargeOrders = customerOrders
    .filter((o) => !isDebtWithdrawalOrderStatus(o.status) && orderEligible(o, params.cutoffWeek))
    .sort((a, b) => {
      const da = a.orderDate?.getTime() ?? a.createdAt.getTime();
      const db = b.orderDate?.getTime() ?? b.createdAt.getTime();
      if (da !== db) return da - db;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  const withdrawals = customerOrders
    .filter((o) => isDebtWithdrawalOrderStatus(o.status))
    .reduce((s, o) => s + money(orderCustomerCreditUsd(o)), 0);

  const prior = params.payments.filter(
    (p) => isActive(p) && p.createdAt.getTime() < asOf && !params.excludePaymentIds.has(p.id),
  );

  const paidByOrder = new Map<string, number>();
  let unassigned = 0;
  let credit = 0;
  const eligibleIds = new Set(chargeOrders.map((o) => o.id));
  for (const p of prior) {
    if (p.businessType === "CUSTOMER_CREDIT") {
      credit = money(credit + p.amountUsd);
      continue;
    }
    if (!isDebtPayment(p.businessType)) continue;
    if (p.orderId && eligibleIds.has(p.orderId)) {
      paidByOrder.set(p.orderId, money((paidByOrder.get(p.orderId) ?? 0) + p.amountUsd));
    } else if (!p.orderId) {
      unassigned = money(unassigned + p.amountUsd);
    }
  }

  let remainders = chargeOrders.map((o) =>
    money(Math.max(0, o.totalUsd > 0 ? o.totalUsd : o.amountUsd + o.commissionUsd) - (paidByOrder.get(o.id) ?? 0)),
  );
  remainders = fifoApply(remainders, unassigned);
  remainders = fifoApply(remainders, withdrawals);
  remainders = applyCredit(remainders, credit);
  return money(remainders.reduce((s, n) => s + money(Math.max(0, n)), 0));
}
