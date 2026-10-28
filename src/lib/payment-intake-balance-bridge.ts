/**
 * Payment intake — bridge between CURRENT customer debt and week-scoped order remainings.
 * Read-only facts; no DB writes.
 */

import "server-only";

import { prisma } from "@/lib/prisma";
import { roundMoney2 } from "@/lib/payment-intake";
import { sumPaymentIntakeWeekScopedRemainingUsd } from "@/lib/payment-intake-order-filter";
import { loadPaymentIntakeOrdersForCustomer } from "@/lib/payment-intake-load";
import {
  computeOrderOpenDebtUsd,
  resolveOrderTotalUsd,
} from "@/lib/order-remaining-debt";
import { paymentRecordUsdEquivalent } from "@/lib/payment-usd-equivalent";
import { getCustomerCreditBalanceUsd } from "@/lib/customer-credit-balance";
import {
  getCustomerAccountBalances,
  currentCustomerFinancialScopeForWorkCountry,
} from "@/lib/customer-account-balances";
import { normalizeWorkCountryCode, DEFAULT_WORK_COUNTRY, type WorkCountryCode } from "@/lib/work-country";
import type {
  PaymentIntakeBalanceBridge,
  PaymentIntakeBalanceBridgeRow,
} from "@/lib/payment-intake-balance-bridge-shared";

export type { PaymentIntakeBalanceBridge, PaymentIntakeBalanceBridgeRow } from "@/lib/payment-intake-balance-bridge-shared";

function intakeOrderBaseWhere(customerId: string, workCountry: WorkCountryCode) {
  return {
    customerId,
    deletedAt: null,
    countryCode: workCountry,
    status: { notIn: ["DEBT_WITHDRAWAL", "CANCELLED"] },
  };
}

export async function loadPaymentIntakeBalanceBridge(
  params: {
    customerId: string;
    weekCodeForOpenBalances?: string | null;
    paymentWorkCountryRaw?: string | null;
  },
): Promise<{ ok: true; bridge: PaymentIntakeBalanceBridge } | { ok: false; error: string }> {
  const cid = params.customerId.trim();
  if (!cid) return { ok: false, error: "חסר לקוח" };

  const workCountry = normalizeWorkCountryCode(params.paymentWorkCountryRaw) ?? DEFAULT_WORK_COUNTRY;
  const weekCode = params.weekCodeForOpenBalances?.trim() || null;
  const currentScope = currentCustomerFinancialScopeForWorkCountry(workCountry);

  const [intakeRes, currentBooks, grossCreditUsd, orders] = await Promise.all([
    loadPaymentIntakeOrdersForCustomer(params),
    getCustomerAccountBalances(cid, currentScope),
    getCustomerCreditBalanceUsd(cid, currentScope),
    prisma.order.findMany({
      where: intakeOrderBaseWhere(cid, workCountry),
      orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        orderNumber: true,
        weekCode: true,
        orderDate: true,
        status: true,
        amountUsd: true,
        commissionUsd: true,
        totalUsd: true,
      },
    }),
  ]);

  if (!intakeRes.ok) return { ok: false, error: intakeRes.error };

  const payments = await prisma.payment.findMany({
    where: { customerId: cid, status: { not: "CANCELLED" } },
    select: { orderId: true, businessType: true, amountUsd: true, amountIls: true, exchangeRate: true },
  });
  const paidByOrder = new Map<string, number>();
  for (const p of payments) {
    if (p.businessType === "CUSTOMER_CREDIT" || p.businessType === "ADJUSTMENT_FEE") continue;
    const amt = Number(paymentRecordUsdEquivalent(p));
    if (!Number.isFinite(amt) || amt <= 0) continue;
    if (!p.orderId) continue;
    paidByOrder.set(p.orderId, roundMoney2((paidByOrder.get(p.orderId) ?? 0) + amt));
  }

  const intakeIds = new Set(intakeRes.orders.map((o) => o.id));
  let grossOpen = 0;
  const outsideOrders: string[] = [];
  let outsideRem = 0;

  for (const o of orders) {
    const total = resolveOrderTotalUsd(o);
    const paid = paidByOrder.get(o.id) ?? 0;
    const rem = computeOrderOpenDebtUsd(total, paid);
    if (rem <= 0.005) continue;
    grossOpen = roundMoney2(grossOpen + rem);
    if (!intakeIds.has(o.id)) {
      outsideRem = roundMoney2(outsideRem + rem);
      outsideOrders.push(o.orderNumber?.trim() || o.id.slice(0, 8));
    }
  }

  const weekScoped = sumPaymentIntakeWeekScopedRemainingUsd(intakeRes.orders);
  const currentDebt = currentBooks.openDebtUsd;
  const creditGross = roundMoney2(grossCreditUsd);

  const rows: PaymentIntakeBalanceBridgeRow[] = [
    {
      key: "gross-open",
      label: "יתרות הזמנות פתוחות",
      amountUsd: grossOpen,
    },
    {
      key: "outside-week",
      label: "הזמנות מחוץ לטווח שבוע הגבייה",
      amountUsd: outsideRem > 0.005 ? -outsideRem : outsideRem === 0 ? 0 : null,
      detail: outsideOrders.length > 0 ? outsideOrders.join(", ") : undefined,
      unverified: outsideOrders.length === 0 && grossOpen - weekScoped > 0.02,
    },
    {
      key: "week-scoped",
      label: "יתרות הזמנות בטווח שבוע הגבייה",
      amountUsd: weekScoped,
    },
    {
      key: "credit-offset",
      label: "קיזוז יתרות זכות ברמת הלקוח",
      amountUsd: creditGross > 0.005 ? -creditGross : 0,
    },
    {
      key: "current-debt",
      label: "חוב CURRENT מכלל ההזמנות",
      amountUsd: currentDebt,
    },
  ];

  return {
    ok: true,
    bridge: {
      currentOpenDebtUsd: currentDebt,
      weekScopedOrderRemainingUsd: weekScoped,
      outsideWeekOrderRemainingUsd: outsideRem,
      grossOpenOrderRemainingUsd: grossOpen,
      creditGrossUsd: creditGross,
      outsideWeekOrderNumbers: outsideOrders,
      rows,
    },
  };
}
