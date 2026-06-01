import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  DEBT_WITHDRAWAL_LEDGER_LABEL,
  isDebtWithdrawalOrderStatus,
  orderCustomerChargeUsd,
  orderCustomerCreditUsd,
} from "@/lib/debt-withdrawal-order";
import { formatLocalYmd, parseLocalDate } from "@/lib/work-week";

export type CustomerLedgerRowKind =
  | "OPENING_BALANCE"
  | "ORDER"
  | "PAYMENT"
  | "CREDIT_APPLIED";

export type CustomerLedgerRow = {
  id: string;
  dateYmd: string;
  kind: CustomerLedgerRowKind;
  /** תווית עברית: הזמנה, תשלום, יתרת פתיחה, משיכה מחוב */
  typeLabel: string;
  chargeUsd: string;
  paymentUsd: string;
  balanceUsd: string;
  document: string;
  orderId: string | null;
  paymentId: string | null;
  /** שורת משיכה מחוב — לעיצוב שלילי באדום */
  isDebtWithdrawal?: boolean;
};

export type CustomerLedgerPayload = {
  rows: CustomerLedgerRow[];
  totalChargesUsd: string;
  totalPaymentsUsd: string;
  balanceUsd: string;
};

function paymentUsdEquivalent(p: {
  amountUsd: Prisma.Decimal | null;
  amountIls: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
}): Prisma.Decimal {
  if (p.amountUsd && p.amountUsd.gt(0)) return p.amountUsd;
  if (p.amountIls && p.exchangeRate && p.exchangeRate.gt(0)) {
    return p.amountIls.div(p.exchangeRate).toDecimalPlaces(4, 4);
  }
  return new Prisma.Decimal(0);
}

function endOfLocalDay(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

type LedgerEvent = {
  id: string;
  date: Date;
  kind: Exclude<CustomerLedgerRowKind, "OPENING_BALANCE">;
  typeLabel: string;
  charge: Prisma.Decimal;
  payment: Prisma.Decimal;
  document: string;
  orderId: string | null;
  paymentId: string | null;
  isDebtWithdrawal?: boolean;
};

/** חשבון לקוח — חיובים (הזמנות), תשלומים, יתרה רצה ויתרת פתיחה */
export async function buildCustomerAccountLedger(params: {
  customerId: string;
  fromYmd?: string | null;
  toYmd?: string | null;
}): Promise<CustomerLedgerPayload> {
  const id = params.customerId.trim();
  const fromFilterSet = Boolean(params.fromYmd?.trim());
  const from = fromFilterSet ? parseLocalDate(params.fromYmd!.trim()) : new Date(2000, 0, 1);
  const to = params.toYmd?.trim() ? endOfLocalDay(params.toYmd.trim()) : new Date(2999, 11, 31, 23, 59, 59, 999);

  const [preOrders, prePayments, orders, payments] = await Promise.all([
    fromFilterSet
      ? prisma.order.findMany({
          where: { customerId: id, deletedAt: null, orderDate: { lt: from } },
          select: {
            status: true,
            totalUsd: true,
            amountUsd: true,
            commissionUsd: true,
            debtWithdrawalUsd: true,
          },
        })
      : Promise.resolve([]),
    fromFilterSet
      ? prisma.payment.findMany({
          where: { customerId: id, isPaid: true, paymentDate: { lt: from } },
          select: {
            amountUsd: true,
            amountIls: true,
            exchangeRate: true,
          },
        })
      : Promise.resolve([]),
    prisma.order.findMany({
      where: { customerId: id, deletedAt: null, orderDate: { gte: from, lte: to } },
      orderBy: { orderDate: "asc" },
      select: {
        id: true,
        orderNumber: true,
        orderDate: true,
        status: true,
        totalUsd: true,
        amountUsd: true,
        commissionUsd: true,
        debtWithdrawalUsd: true,
      },
    }),
    prisma.payment.findMany({
      where: { customerId: id, isPaid: true, paymentDate: { gte: from, lte: to } },
      orderBy: { paymentDate: "asc" },
      select: {
        id: true,
        paymentCode: true,
        paymentDate: true,
        amountUsd: true,
        amountIls: true,
        exchangeRate: true,
      },
    }),
  ]);

  let openingBalance = new Prisma.Decimal(0);
  if (fromFilterSet) {
    let preCharges = new Prisma.Decimal(0);
    let prePaid = new Prisma.Decimal(0);
    for (const o of preOrders) {
      preCharges = preCharges.add(
        new Prisma.Decimal(orderCustomerChargeUsd(o).toFixed(4)),
      );
      const credit = orderCustomerCreditUsd(o);
      if (credit > 0) prePaid = prePaid.add(new Prisma.Decimal(credit.toFixed(4)));
    }
    for (const p of prePayments) {
      prePaid = prePaid.add(paymentUsdEquivalent(p));
    }
    openingBalance = preCharges.sub(prePaid);
  }

  const events: LedgerEvent[] = [
    ...orders.map((o) => {
      if (isDebtWithdrawalOrderStatus(o.status)) {
        const credit = orderCustomerCreditUsd(o);
        const charge = new Prisma.Decimal((-credit).toFixed(4));
        return {
          id: `dw-${o.id}`,
          date: o.orderDate ?? new Date(0),
          kind: "ORDER" as const,
          typeLabel: DEBT_WITHDRAWAL_LEDGER_LABEL,
          charge,
          payment: new Prisma.Decimal(0),
          document: o.orderNumber?.trim() || DEBT_WITHDRAWAL_LEDGER_LABEL,
          orderId: o.id,
          paymentId: null,
          isDebtWithdrawal: true,
        };
      }
      const chargeUsd = orderCustomerChargeUsd(o);
      return {
        id: `o-${o.id}`,
        date: o.orderDate ?? new Date(0),
        kind: "ORDER" as const,
        typeLabel: "הזמנה",
        charge: new Prisma.Decimal(chargeUsd.toFixed(4)),
        payment: new Prisma.Decimal(0),
        document: o.orderNumber?.trim() || "הזמנה",
        orderId: o.id,
        paymentId: null,
      };
    }),
    ...payments.map((p) => {
      const payUsd = paymentUsdEquivalent(p);
      return {
        id: `p-${p.id}`,
        date: p.paymentDate ?? new Date(0),
        kind: "PAYMENT" as const,
        typeLabel: "תשלום",
        charge: new Prisma.Decimal(0),
        payment: payUsd,
        document: p.paymentCode?.trim() || "תשלום",
        orderId: null,
        paymentId: p.id,
      };
    }),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));

  const rows: CustomerLedgerRow[] = [];
  let balance = openingBalance;
  let totalCharges = new Prisma.Decimal(0);
  let totalPayments = new Prisma.Decimal(0);

  if (fromFilterSet) {
    rows.push({
      id: "opening",
      dateYmd: params.fromYmd!.trim(),
      kind: "OPENING_BALANCE",
      typeLabel: "יתרת פתיחה",
      chargeUsd: "0.00",
      paymentUsd: "0.00",
      balanceUsd: balance.toFixed(2),
      document: "יתרת פתיחה",
      orderId: null,
      paymentId: null,
    });
  }

  for (const ev of events) {
    balance = balance.add(ev.charge).sub(ev.payment);
    totalCharges = totalCharges.add(ev.charge);
    totalPayments = totalPayments.add(ev.payment);
    rows.push({
      id: ev.id,
      dateYmd: ev.date.getTime() > 0 ? formatLocalYmd(ev.date) : "—",
      kind: ev.kind,
      typeLabel: ev.typeLabel,
      chargeUsd: ev.charge.toFixed(2),
      paymentUsd: ev.payment.toFixed(2),
      balanceUsd: balance.toFixed(2),
      document: ev.document,
      orderId: ev.orderId,
      paymentId: ev.paymentId,
      isDebtWithdrawal: ev.isDebtWithdrawal,
    });
  }

  return {
    rows,
    totalChargesUsd: totalCharges.toFixed(2),
    totalPaymentsUsd: totalPayments.toFixed(2),
    balanceUsd: balance.toFixed(2),
  };
}
