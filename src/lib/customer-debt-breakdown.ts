import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CUSTOMER_CREDIT_SURPLUS_NOTE_PREFIX } from "@/lib/cash-control-internal-payments";
import { BALANCE_RESET_FROM_CREDIT_LEDGER_LABEL } from "@/lib/commission-debt-closure";
import { getCustomerOpenDebt, openDebtScopeForWorkCountry } from "@/lib/customer-open-debt";
import { DEBT_WITHDRAWAL_LEDGER_LABEL, orderCustomerCreditUsd } from "@/lib/debt-withdrawal-order";
import { paymentIntakeOrderDateThroughAhWeekEnd } from "@/lib/payment-intake-order-filter";
import { type PaymentIntakeOrderStatus } from "@/lib/payment-intake";
import { findActiveCustomerPayments, groupByActivePayments } from "@/lib/payment-record-status";
import { paymentRecordUsdEquivalent as paymentUsd } from "@/lib/payment-usd-equivalent";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";
import { OS } from "@/lib/order-status-slugs";
import { DEFAULT_WORK_COUNTRY, normalizeWorkCountryCode } from "@/lib/work-country";
import { formatLocalYmd } from "@/lib/work-week";

const EPS = 0.02;

function orderStatusLabel(status: PaymentIntakeOrderStatus): string {
  if (status === "paid") return "שולם";
  if (status === "partial") return "תשלום חלקי";
  return "יתרה פתוחה";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function dec(n: Prisma.Decimal | number | string | null | undefined): number {
  if (n == null) return 0;
  const v = Number(n.toString());
  return Number.isFinite(v) ? v : 0;
}

function orderTotalUsd(o: {
  totalUsd: Prisma.Decimal | null;
  amountUsd: Prisma.Decimal | null;
  commissionUsd: Prisma.Decimal | null;
}): number {
  if (o.totalUsd) return round2(dec(o.totalUsd));
  return round2(dec(o.amountUsd) + dec(o.commissionUsd));
}

function paymentMethodLabel(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "—";
  return PAYMENT_METHOD_LABELS[v] ?? v;
}

import type {
  CustomerDebtBreakdownDto,
  DebtBreakdownAdjustmentRow,
  DebtBreakdownOpenOrder,
  DebtBreakdownPaymentRow,
  DebtBreakdownSourceRow,
} from "@/lib/customer-debt-breakdown-types";
export type {
  CustomerDebtBreakdownDto as CustomerDebtBreakdownResult,
  DebtBreakdownOpenOrder,
  DebtBreakdownPaymentRow,
  DebtBreakdownAdjustmentRow,
  DebtBreakdownSourceRow,
} from "@/lib/customer-debt-breakdown-types";

export async function buildCustomerDebtBreakdown(input: {
  customerId: string;
  country?: string | null;
  weekCode?: string | null;
}): Promise<CustomerDebtBreakdownDto | { ok: false; error: string }> {
  const customerId = input.customerId.trim();
  if (!customerId) return { ok: false, error: "חסר מזהה לקוח" };

  const cust = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true, displayName: true },
  });
  if (!cust) return { ok: false, error: "לקוח לא נמצא" };

  const paymentWorkCountry = normalizeWorkCountryCode(input.country) ?? DEFAULT_WORK_COUNTRY;
  const scope = openDebtScopeForWorkCountry(paymentWorkCountry);
  const weekCode = input.weekCode?.trim() || null;
  const weekDateWhere = paymentIntakeOrderDateThroughAhWeekEnd(weekCode);

  const [debt, orders, withdrawals, payments, cancelledPayments] = await Promise.all([
    getCustomerOpenDebt(customerId, scope),
    prisma.order.findMany({
      where: {
        customerId,
        deletedAt: null,
        status: { not: OS.DEBT_WITHDRAWAL },
        countryCode: paymentWorkCountry,
        ...(scope.sourceCountry ? { sourceCountry: scope.sourceCountry } : {}),
      },
      orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        orderNumber: true,
        orderDate: true,
        weekCode: true,
        sourceCountry: true,
        amountUsd: true,
        commissionUsd: true,
        totalUsd: true,
      },
    }),
    prisma.order.findMany({
      where: {
        customerId,
        deletedAt: null,
        status: OS.DEBT_WITHDRAWAL,
        countryCode: paymentWorkCountry,
        ...(scope.sourceCountry ? { sourceCountry: scope.sourceCountry } : {}),
      },
      select: {
        id: true,
        orderNumber: true,
        orderDate: true,
        status: true,
        debtWithdrawalUsd: true,
        totalUsd: true,
        amountUsd: true,
        commissionUsd: true,
      },
    }),
    findActiveCustomerPayments({
      where: {
        customerId,
        countryCode: paymentWorkCountry,
      },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        paymentCode: true,
        paymentDate: true,
        createdAt: true,
        amountUsd: true,
        amountIls: true,
        exchangeRate: true,
        paymentMethod: true,
        usdPaymentMethod: true,
        ilsPaymentMethod: true,
        orderId: true,
        notes: true,
        status: true,
        createdBy: { select: { fullName: true } },
        order: { select: { orderNumber: true } },
      },
    }),
    prisma.payment.findMany({
      where: {
        customerId,
        countryCode: paymentWorkCountry,
        status: "CANCELLED",
      },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        paymentCode: true,
        paymentDate: true,
        createdAt: true,
        amountUsd: true,
        amountIls: true,
        exchangeRate: true,
        paymentMethod: true,
        usdPaymentMethod: true,
        ilsPaymentMethod: true,
        orderId: true,
        notes: true,
        createdBy: { select: { fullName: true } },
        order: { select: { orderNumber: true } },
      },
    }),
  ]);

  const orderIds = orders.map((o) => o.id);
  const paidByOrder = new Map<string, number>();
  const lastPaymentByOrder = new Map<string, string>();
  if (orderIds.length > 0) {
    const [sums, payRows] = await Promise.all([
      groupByActivePayments("orderId", { orderId: { in: orderIds }, amountUsd: { not: null } }, { amountUsd: true }),
      findActiveCustomerPayments({
        where: { orderId: { in: orderIds } },
        orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
        select: { orderId: true, paymentDate: true, createdAt: true },
      }),
    ]);
    for (const s of sums) {
      if (s.orderId) paidByOrder.set(s.orderId, dec(s._sum?.amountUsd));
    }
    for (const p of payRows) {
      if (!p.orderId || lastPaymentByOrder.has(p.orderId)) continue;
      const dt = p.paymentDate ?? p.createdAt;
      if (dt) lastPaymentByOrder.set(p.orderId, formatLocalYmd(new Date(dt)));
    }
  }

  const visibleOrderIds = new Set<string>();
  if (weekDateWhere) {
    const visible = await prisma.order.findMany({
      where: {
        customerId,
        deletedAt: null,
        status: { not: OS.DEBT_WITHDRAWAL },
        countryCode: paymentWorkCountry,
        ...(scope.sourceCountry ? { sourceCountry: scope.sourceCountry } : {}),
        ...weekDateWhere,
      },
      select: { id: true },
    });
    for (const o of visible) visibleOrderIds.add(o.id);
  } else {
    for (const o of orders) visibleOrderIds.add(o.id);
  }

  const openOrders: DebtBreakdownOpenOrder[] = [];
  let totalOriginal = 0;
  let totalCommission = 0;
  let totalPaidOnOpen = 0;
  let openOrdersDebtAll = 0;
  let openOrdersDebtVisible = 0;
  let openOrdersDebtHidden = 0;

  for (const o of orders) {
    const original = round2(dec(o.amountUsd));
    const commission = round2(dec(o.commissionUsd));
    const totalDue = orderTotalUsd(o);
    const paid = round2(paidByOrder.get(o.id) ?? 0);
    const remaining = round2(Math.max(0, totalDue - paid));
    if (remaining <= EPS) continue;

    let status: PaymentIntakeOrderStatus = "unpaid";
    if (paid > EPS) status = "partial";

    const visible = visibleOrderIds.has(o.id);
    openOrdersDebtAll = round2(openOrdersDebtAll + remaining);
    if (visible) openOrdersDebtVisible = round2(openOrdersDebtVisible + remaining);
    else openOrdersDebtHidden = round2(openOrdersDebtHidden + remaining);

    totalOriginal = round2(totalOriginal + original);
    totalCommission = round2(totalCommission + commission);
    totalPaidOnOpen = round2(totalPaidOnOpen + paid);

    openOrders.push({
      orderId: o.id,
      orderNumber: o.orderNumber?.trim() || "—",
      orderDateYmd: o.orderDate ? formatLocalYmd(new Date(o.orderDate)) : "—",
      weekCode: o.weekCode?.trim() || null,
      sourceCountry: o.sourceCountry != null ? String(o.sourceCountry) : null,
      originalAmount: original,
      commission,
      totalDue,
      paidAmount: paid,
      creditedAmount: 0,
      remainingBalance: remaining,
      lastPaymentDate: lastPaymentByOrder.get(o.id) ?? null,
      status,
      statusLabel: orderStatusLabel(status),
      visibleInIntakeWeek: visible,
    });
  }

  const signedBalance = round2(dec(debt.signedBalanceUsd));
  const currentDebt = round2(Math.max(0, signedBalance));
  const creditUsd = signedBalance < -EPS ? round2(Math.abs(signedBalance)) : 0;

  const adjustments: DebtBreakdownAdjustmentRow[] = [];
  const sources: DebtBreakdownSourceRow[] = [];

  let unallocatedPaymentsTotal = 0;
  let creditSurplusTotal = 0;
  let balanceResetTotal = 0;
  let debtWithdrawalsTotal = round2(dec(debt.totalWithdrawalsUsd));

  for (const w of withdrawals) {
    const amt = round2(orderCustomerCreditUsd(w));
    if (amt <= EPS) continue;
    const dateYmd = w.orderDate ? formatLocalYmd(new Date(w.orderDate)) : null;
    adjustments.push({
      id: w.id,
      kind: "DEBT_WITHDRAWAL",
      label: DEBT_WITHDRAWAL_LEDGER_LABEL,
      dateYmd,
      amountUsd: -amt,
      description: w.orderNumber ? `הזמנה ${w.orderNumber}` : null,
    });
  }
  if (debtWithdrawalsTotal > EPS) {
    sources.push({
      id: "debt-withdrawals",
      label: "משיכות מחוב",
      amountUsd: -debtWithdrawalsTotal,
      description: "מקטין את החוב הכולל",
    });
  }

  const paymentHistory: DebtBreakdownPaymentRow[] = [];
  const runningBalanceByOrder = new Map<string, number>();
  for (const o of orders) {
    runningBalanceByOrder.set(o.id, orderTotalUsd(o));
  }

  for (const p of payments) {
    const amt = round2(dec(paymentUsd(p)));
    const notes = p.notes?.trim() || "";
    const isUnallocated = !p.orderId;
    const isCreditSurplus = notes.startsWith(CUSTOMER_CREDIT_SURPLUS_NOTE_PREFIX);
    const isBalanceReset = notes.includes(BALANCE_RESET_FROM_CREDIT_LEDGER_LABEL);

    if (isUnallocated) {
      unallocatedPaymentsTotal = round2(unallocatedPaymentsTotal + amt);
      if (isCreditSurplus) {
        creditSurplusTotal = round2(creditSurplusTotal + amt);
        adjustments.push({
          id: p.id,
          kind: "CREDIT_SURPLUS",
          label: "יתרת זכות — עודף מתשלום",
          dateYmd: p.paymentDate ? formatLocalYmd(new Date(p.paymentDate)) : null,
          amountUsd: -amt,
          description: notes || null,
        });
      } else if (isBalanceReset) {
        balanceResetTotal = round2(balanceResetTotal + amt);
        adjustments.push({
          id: p.id,
          kind: "BALANCE_RESET",
          label: BALANCE_RESET_FROM_CREDIT_LEDGER_LABEL,
          dateYmd: p.paymentDate ? formatLocalYmd(new Date(p.paymentDate)) : null,
          amountUsd: -amt,
          description: notes || null,
        });
      } else {
        adjustments.push({
          id: p.id,
          kind: "UNALLOCATED_PAYMENT",
          label: "תשלום לא מוקצה להזמנה",
          dateYmd: p.paymentDate ? formatLocalYmd(new Date(p.paymentDate)) : null,
          amountUsd: -amt,
          description: p.paymentCode ? `קוד ${p.paymentCode}` : null,
        });
      }
    }

    let balanceAfter: number | null = null;
    if (p.orderId) {
      const before = runningBalanceByOrder.get(p.orderId) ?? 0;
      balanceAfter = round2(Math.max(0, before - amt));
      runningBalanceByOrder.set(p.orderId, balanceAfter);
    }

    paymentHistory.push({
      id: p.id,
      paymentDateYmd: p.paymentDate
        ? formatLocalYmd(new Date(p.paymentDate))
        : p.createdAt
          ? formatLocalYmd(new Date(p.createdAt))
          : "—",
      paymentCode: p.paymentCode?.trim() || null,
      amountUsd: amt,
      currency: p.amountUsd != null && dec(p.amountUsd) > 0 ? "USD" : "ILS",
      paymentMethodLabel: paymentMethodLabel(p.paymentMethod || p.usdPaymentMethod || p.ilsPaymentMethod),
      orderId: p.orderId,
      orderNumber: p.order?.orderNumber?.trim() || null,
      allocatedUsd: p.orderId ? amt : 0,
      balanceAfterUsd: balanceAfter,
      createdByName: p.createdBy?.fullName ?? null,
      notes: notes || null,
      isUnallocated,
      isCancelled: false,
    });
  }

  for (const p of cancelledPayments) {
    paymentHistory.push({
      id: p.id,
      paymentDateYmd: p.paymentDate
        ? formatLocalYmd(new Date(p.paymentDate))
        : p.createdAt
          ? formatLocalYmd(new Date(p.createdAt))
          : "—",
      paymentCode: p.paymentCode?.trim() || null,
      amountUsd: round2(dec(paymentUsd(p))),
      currency: p.amountUsd != null && dec(p.amountUsd) > 0 ? "USD" : "ILS",
      paymentMethodLabel: paymentMethodLabel(p.paymentMethod || p.usdPaymentMethod || p.ilsPaymentMethod),
      orderId: p.orderId,
      orderNumber: p.order?.orderNumber?.trim() || null,
      allocatedUsd: 0,
      balanceAfterUsd: null,
      createdByName: p.createdBy?.fullName ?? null,
      notes: p.notes?.trim() || null,
      isUnallocated: !p.orderId,
      isCancelled: true,
    });
    adjustments.push({
      id: `cancelled-${p.id}`,
      kind: "CANCELLED_PAYMENT",
      label: "תשלום שבוטל",
      dateYmd: p.paymentDate ? formatLocalYmd(new Date(p.paymentDate)) : null,
      amountUsd: round2(dec(paymentUsd(p))),
      description: p.paymentCode ? `קוד ${p.paymentCode}` : null,
    });
  }

  if (unallocatedPaymentsTotal > EPS) {
    sources.push({
      id: "unallocated-payments",
      label: "תשלומים לא מוקצים",
      amountUsd: -unallocatedPaymentsTotal,
      description: "מקטינים את החוב בכרטסת אך לא סוגרים הזמנה ספציפית",
    });
  }
  if (creditSurplusTotal > EPS) {
    sources.push({
      id: "credit-surplus",
      label: "יתרות זכות (עודף מתשלום)",
      amountUsd: -creditSurplusTotal,
      description: null,
    });
  }
  if (openOrdersDebtHidden > EPS) {
    sources.push({
      id: "hidden-week-orders",
      label: weekCode ? `הזמנות מחוץ לשבוע ${weekCode}` : "הזמנות מחוץ לטווח הקליטה",
      amountUsd: openOrdersDebtHidden,
      description: "יתרות פתוחות שלא מוצגות בטבלת הקליטה הנוכחית",
    });
  }
  if (creditUsd > EPS) {
    sources.push({
      id: "customer-credit",
      label: "יתרת זכות ללקוח",
      amountUsd: -creditUsd,
      description: "הלקוח שילם מעל החוב — אין חוב פתוח",
    });
  }

  const unexplainedDifference = round2(currentDebt - openOrdersDebtAll);
  if (Math.abs(unexplainedDifference) > EPS) {
    const explained = round2(
      sources.reduce((s, r) => s + r.amountUsd, 0) - openOrdersDebtVisible,
    );
    const residual = round2(currentDebt - openOrdersDebtAll - explained);
    if (Math.abs(residual) > EPS) {
      sources.push({
        id: "unexplained",
        label: "הפרש לא מוסבר",
        amountUsd: residual,
        description: "יש לבדוק יתרת פתיחה, נתוני מערכת ישנה או התאמות ידניות",
      });
    }
  }

  const otherFromDebt = round2(currentDebt - openOrdersDebtVisible);
  const mismatch =
    Math.abs(round2(openOrdersDebtVisible + otherFromDebt - currentDebt)) > EPS ||
    Math.abs(unexplainedDifference) > EPS;

  const explanationParts: string[] = [];
  if (openOrders.length === 1) {
    const o = openOrders[0]!;
    explanationParts.push(
      `החוב הפתוח של הזמנה ${o.orderNumber} נוצר מסכום כולל של $${o.totalDue.toFixed(2)}. עד היום שולמו $${o.paidAmount.toFixed(2)}, ולכן נותרו $${o.remainingBalance.toFixed(2)} לתשלום.`,
    );
  } else if (openOrders.length > 1) {
    explanationParts.push(`החוב הכולל מורכב מ-${openOrders.length} הזמנות פתוחות.`);
  }
  if (openOrdersDebtHidden > EPS && weekCode) {
    explanationParts.push(
      `$${openOrdersDebtHidden.toFixed(2)} מהחוב מגיעים מהזמנות שאינן מוצגות בטבלת קליטה לשבוע ${weekCode}.`,
    );
  }
  if (unallocatedPaymentsTotal > EPS) {
    explanationParts.push(
      `קיימים תשלומים לא מוקצים בסך $${unallocatedPaymentsTotal.toFixed(2)} שמקטינים את החוב בכרטסת.`,
    );
  }
  if (debtWithdrawalsTotal > EPS) {
    explanationParts.push(`משיכות מחוב בסך $${debtWithdrawalsTotal.toFixed(2)} מקטינות את החוב.`);
  }
  if (creditUsd > EPS) {
    explanationParts.push(`ללקוח יתרת זכות של $${creditUsd.toFixed(2)} — אין חוב פתוח בפועל.`);
  }
  if (!explanationParts.length) {
    explanationParts.push("אין חובות פתוחים ללקוח זה.");
  }

  return {
    customerId,
    currency: "USD",
    intakeWeekCode: weekCode,
    summary: {
      currentDebt,
      openOrdersCount: openOrders.length,
      totalOriginalAmount: totalOriginal,
      totalCommission: totalCommission,
      totalPaid: totalPaidOnOpen,
      openOrdersDebt: openOrdersDebtAll,
      creditUsd,
    },
    openOrders,
    paymentHistory,
    adjustments,
    sources,
    totals: {
      openOrdersDebtVisible,
      openOrdersDebtHidden,
      openOrdersDebtAll,
      otherSourcesTotal: otherFromDebt,
      currentDebt,
      unexplainedDifference,
    },
    mismatch,
    explanationText: explanationParts.join(" "),
  };
}
