/**
 * FlowWeeksOverviewService — סיכום שבועי לבקרת תזרים.
 * הזמנות/יתרות: Order + Payment ledger.
 * ספירת מנהל (מזומן/העברות/אשראי/צ'קים): CashWeekFlow.counted* בלבד.
 */

import { prisma } from "@/lib/prisma";
import { loadFlowWeek } from "@/app/admin/cash-flow/week-flow-service";
import type { FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import type { CashDailyMethodId } from "@/lib/cash-control-daily";
import { allCashControlChannels } from "@/lib/cash-control-channel";
import { formatAhWeekLabel } from "@/lib/weeks/ah-week";
import type { CashWeekFlowLineId } from "@/lib/cash-control-week-flow";
import { groupByActivePayments } from "@/lib/payment-record-status";
import { computeOrderLedgerView, resolveOrderTotalUsd } from "@/lib/order-remaining-debt";
import { OrderStatus as OS } from "@prisma/client";
import {
  mergeOrderWhere,
  resolveCountryScopeFromCode,
  type CountryScope,
} from "@/lib/country-data-scope";
import type { WorkCountryCode } from "@/lib/work-country";
import { DEFAULT_WORK_COUNTRY } from "@/lib/work-country";

function money(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function loadOneWeekOverview(
  weekCode: string,
  scope: CountryScope,
): Promise<FlowWeekOverviewRow | null> {
  const wk = weekCode.trim();
  const [flow, orderRows] = await Promise.all([
    loadFlowWeek(wk, scope.workCountry),
    prisma.order.findMany({
      where: mergeOrderWhere({ weekCode: wk, deletedAt: null }, scope),
      select: {
        id: true,
        totalUsd: true,
        amountUsd: true,
        commissionUsd: true,
        status: true,
      },
    }),
  ]);
  if (!flow) return null;

  const paymentWeekTotal = flow.weekPaymentIntake;
  const paymentIntakeIls = flow.kpis.totalReceivedIls;
  const totalReceivedIls = paymentIntakeIls;

  const orderIds = orderRows.map((o) => o.id);
  const paySums =
    orderIds.length > 0
      ? ((await groupByActivePayments(
          "orderId",
          { orderId: { in: orderIds }, amountUsd: { not: null } },
          { amountUsd: true },
        )) as Array<{ orderId: string | null; _sum: { amountUsd: unknown } }>)
      : [];
  const paidByOrder = new Map<string, number>();
  for (const p of paySums) {
    if (p.orderId) paidByOrder.set(p.orderId, Number(p._sum.amountUsd ?? 0));
  }

  let totalOrdersUsd = 0;
  let remainingToPayUsd = 0;
  for (const o of orderRows) {
    const orderTotal = resolveOrderTotalUsd({
      totalUsd: o.totalUsd,
      amountUsd: o.amountUsd,
      commissionUsd: o.commissionUsd,
    });
    totalOrdersUsd += orderTotal;
    if (o.status === OS.DEBT_WITHDRAWAL) continue;
    const ledger = computeOrderLedgerView({
      orderId: o.id,
      totalUsd: o.totalUsd,
      amountUsd: o.amountUsd,
      commissionUsd: o.commissionUsd,
      paidUsd: paidByOrder.get(o.id) ?? 0,
    });
    remainingToPayUsd += ledger.remainingUsd;
  }
  remainingToPayUsd = round2(remainingToPayUsd);
  totalOrdersUsd = round2(totalOrdersUsd);

  const drawerDto = Object.fromEntries(
    allCashControlChannels().map((k) => [k, money(flow.drawerChannelTotals[k])]),
  ) as Record<CashDailyMethodId, string>;

  let maxDays = 0;
  for (const line of Object.values(flow.received)) {
    if (line.paymentCount > maxDays) maxDays = line.paymentCount;
  }

  const lastFx = flow.fxPurchases.length > 0 ? flow.fxPurchases[flow.fxPurchases.length - 1] : null;
  const hasPaymentData = Object.values(flow.weekPaymentIntake).some((v) => v > 0);
  const hasManagerCount = (["CASH_ILS", "CASH_USD", "CREDIT", "CHECK", "BANK_TRANSFER"] as CashWeekFlowLineId[]).some(
    (id) => flow.counted[id] != null,
  );
  const turkeyBalance = flow.turkeyBalance;

  return {
    week: wk,
    weekLabel: formatAhWeekLabel(wk),
    hasData: orderRows.length > 0 || hasPaymentData || maxDays > 0 || hasManagerCount,
    totalOrders: orderRows.length,
    totalOrdersUsd: money(totalOrdersUsd),
    remainingToPayUsd: money(remainingToPayUsd),
    receivedCashUsd: money(Number(paymentWeekTotal.CASH_USD ?? 0)),
    receivedCashIls: money(Number(paymentWeekTotal.CASH_ILS ?? 0)),
    receivedBankTransferIls: money(Number(paymentWeekTotal.BANK_TRANSFER_ILS ?? 0)),
    receivedCreditCardIls: money(Number(paymentWeekTotal.CREDIT_CARD_ILS ?? 0)),
    receivedChecksIls: money(Number(paymentWeekTotal.CHECK_ILS ?? 0)),
    paymentIntakeIls,
    receivedOtherIls: money(Number(paymentWeekTotal.OTHER_ILS ?? 0)),
    receivedOtherUsd: money(Number(paymentWeekTotal.OTHER_USD ?? 0)),
    drawer: drawerDto,
    totalReceivedIls,
    daysCounted: maxDays,
    manager: flow.counted,
    commissionUsd: flow.commissionUsd,
    commissionIls: flow.commissionIls,
    turkeyTransferUsd: flow.turkeyTransferUsd,
    turkeyTransferIls: flow.turkeyTransferIls,
    turkeyOpeningUsd: money(turkeyBalance.usd.openingBalance),
    turkeyAddedUsd: money(turkeyBalance.usd.addedFromCashCount + turkeyBalance.usd.adjusted),
    turkeyTransferredUsd: money(turkeyBalance.usd.transferred - turkeyBalance.usd.reversed),
    turkeyClosingUsd: money(turkeyBalance.usd.closingBalance),
    turkeyBalanceStatus: turkeyBalance.usd.status,
    fxPurchaseIls: flow.fxPurchaseIls,
    fxPurchaseUsd: flow.fxPurchaseUsd,
    fxRemainderCashIls: lastFx ? money(lastFx.remainderCashIls) : flow.fxRemainderCashIls,
    fxRemainderBankIls: lastFx ? money(lastFx.remainderBankIls) : flow.fxRemainderBankIls,
    fxPurchaseCount: flow.fxPurchases.length,
    expensesIls: flow.expensesIls,
    expensesUsd: flow.expensesUsd,
    drawerRemainingIls: flow.drawerRemainingIls,
    drawerRemainingUsd: flow.drawerRemainingUsd,
    bankBalanceIls: flow.bankBalanceIls,
    fxProfitIls: flow.kpis.fxProfitIls,
    fxLossIls: flow.kpis.fxLossIls,
  };
}

export async function loadFlowWeeksOverview(
  weekCodes: string[],
  workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
): Promise<FlowWeekOverviewRow[]> {
  const scope = resolveCountryScopeFromCode(workCountry);
  const unique = [...new Set(weekCodes.map((w) => w.trim()).filter(Boolean))];
  const results = await Promise.all(unique.map((w) => loadOneWeekOverview(w, scope)));
  return results.filter((r): r is FlowWeekOverviewRow => r != null);
}
