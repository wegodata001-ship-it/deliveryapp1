"use server";

import { Prisma } from "@prisma/client";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { endOfLocalDay, formatLocalYmd, parseLocalDate } from "@/lib/work-week";

export type ReceiptControlStatus = "PAID" | "PARTIAL" | "UNPAID";

export type ReceiptControlFilters = {
  week?: string;
  customerName?: string;
  expectedILS?: string;
  receivedILS?: string;
  remainingILS?: string;
};

export type ReceiptControlQuery = {
  page: number;
  limit: number;
  weekCode?: string;
  fromYmd?: string;
  toYmd?: string;
  status?: ReceiptControlStatus | "";
  filters?: ReceiptControlFilters;
};

export type ReceiptPaymentDetail = {
  id: string;
  paymentCode: string | null;
  paymentDateYmd: string;
  amountIls: string;
  paymentMethod: string | null;
  paymentPlace: string | null;
};

export type ReceiptControlRow = {
  orderId: string;
  orderNumber: string;
  week: string;
  orderDateYmd: string;
  customerId: string | null;
  customerName: string;
  expectedILS: string;
  receivedILS: string;
  difference: string;
  remainingILS: string;
  status: ReceiptControlStatus;
  payments: ReceiptPaymentDetail[];
};

export type ReceiptControlPayload = {
  rows: ReceiptControlRow[];
  totalRows: number;
  page: number;
  limit: number;
  totalPages: number;
  totalExpected: string;
  totalReceived: string;
  totalRemaining: string;
};

function money(n: Prisma.Decimal): string {
  return n.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

function includesFilter(value: string, filter?: string): boolean {
  const f = filter?.trim().toLowerCase();
  if (!f) return true;
  return value.toLowerCase().includes(f);
}

function paymentIlsValue(p: {
  totalIlsWithVat: Prisma.Decimal | null;
  amountIls: Prisma.Decimal | null;
  amountUsd: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
}): Prisma.Decimal {
  if (p.totalIlsWithVat) return p.totalIlsWithVat;
  if (p.amountIls) return p.amountIls;
  if (p.amountUsd && p.exchangeRate) return p.amountUsd.mul(p.exchangeRate);
  return new Prisma.Decimal(0);
}

function orderExpectedIlsValue(o: {
  totalIlsWithVat: Prisma.Decimal | null;
  totalIls: Prisma.Decimal | null;
  totalUsd: Prisma.Decimal | null;
  amountUsd: Prisma.Decimal | null;
  commissionUsd: Prisma.Decimal | null;
  usdRateUsed: Prisma.Decimal | null;
  snapshotFinalDollarRate: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
}): Prisma.Decimal {
  if (o.totalIlsWithVat) return o.totalIlsWithVat;
  if (o.totalIls) return o.totalIls;
  const usd = o.totalUsd ?? (o.amountUsd ?? new Prisma.Decimal(0)).add(o.commissionUsd ?? new Prisma.Decimal(0));
  const rate = o.usdRateUsed ?? o.snapshotFinalDollarRate ?? o.exchangeRate;
  return rate ? usd.mul(rate) : new Prisma.Decimal(0);
}

function receiptStatus(remaining: Prisma.Decimal, received: Prisma.Decimal): ReceiptControlStatus {
  if (remaining.lte(new Prisma.Decimal("0.01"))) return "PAID";
  if (remaining.gt(0) && received.gt(0)) return "PARTIAL";
  return "UNPAID";
}

export async function listReceiptControlAction(query: ReceiptControlQuery): Promise<ReceiptControlPayload> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_payment_control"])) {
    return {
      rows: [],
      totalRows: 0,
      page: 1,
      limit: 15,
      totalPages: 1,
      totalExpected: "0.00",
      totalReceived: "0.00",
      totalRemaining: "0.00",
    };
  }

  const limit = Math.min(50, Math.max(1, Math.floor(query.limit || 15)));
  const page = Math.max(1, Math.floor(query.page || 1));
  const where: Prisma.OrderWhereInput = { deletedAt: null };

  if (query.weekCode?.trim()) where.weekCode = { contains: query.weekCode.trim(), mode: "insensitive" };
  if (query.fromYmd?.trim() || query.toYmd?.trim()) {
    where.orderDate = {};
    if (query.fromYmd?.trim()) where.orderDate.gte = parseLocalDate(query.fromYmd.trim());
    if (query.toYmd?.trim()) where.orderDate.lte = endOfLocalDay(query.toYmd.trim());
  }
  if (query.filters?.week?.trim()) where.weekCode = { contains: query.filters.week.trim(), mode: "insensitive" };
  if (query.filters?.customerName?.trim()) {
    const q = query.filters.customerName.trim();
    where.OR = [
      { customerNameSnapshot: { contains: q, mode: "insensitive" } },
      { customer: { displayName: { contains: q, mode: "insensitive" } } },
    ];
  }

  const orders = await prisma.order.findMany({
    where,
    orderBy: [{ orderDate: "desc" }, { orderNumber: "desc" }],
    select: {
      id: true,
      orderNumber: true,
      weekCode: true,
      orderDate: true,
      customerId: true,
      customerNameSnapshot: true,
      totalIlsWithVat: true,
      totalIls: true,
      totalUsd: true,
      amountUsd: true,
      commissionUsd: true,
      usdRateUsed: true,
      snapshotFinalDollarRate: true,
      exchangeRate: true,
      customer: { select: { displayName: true } },
      payments: {
        where: { isPaid: true },
        orderBy: { paymentDate: "desc" },
        select: {
          id: true,
          paymentCode: true,
          paymentDate: true,
          amountIls: true,
          amountUsd: true,
          exchangeRate: true,
          totalIlsWithVat: true,
          paymentMethod: true,
          paymentPlace: true,
        },
      },
    },
  });

  const rows = orders.map((o): ReceiptControlRow => {
    const expected = orderExpectedIlsValue(o);
    const received = o.payments.reduce((sum, p) => sum.add(paymentIlsValue(p)), new Prisma.Decimal(0));
    const difference = expected.sub(received);
    const status = receiptStatus(difference, received);
    return {
      orderId: o.id,
      orderNumber: o.orderNumber ?? "—",
      week: o.weekCode ?? "—",
      orderDateYmd: o.orderDate ? formatLocalYmd(o.orderDate) : "—",
      customerId: o.customerId,
      customerName: o.customer?.displayName ?? o.customerNameSnapshot ?? "—",
      expectedILS: money(expected),
      receivedILS: money(received),
      difference: money(difference),
      remainingILS: money(difference),
      status,
      payments: o.payments.map((p) => ({
        id: p.id,
        paymentCode: p.paymentCode,
        paymentDateYmd: p.paymentDate ? formatLocalYmd(p.paymentDate) : "—",
        amountIls: money(paymentIlsValue(p)),
        paymentMethod: p.paymentMethod,
        paymentPlace: p.paymentPlace,
      })),
    };
  });

  const filtered = rows.filter((r) => {
    if (query.status && r.status !== query.status) return false;
    return (
      includesFilter(r.week, query.filters?.week) &&
      includesFilter(r.customerName, query.filters?.customerName) &&
      includesFilter(r.expectedILS, query.filters?.expectedILS) &&
      includesFilter(r.receivedILS, query.filters?.receivedILS) &&
      includesFilter(r.remainingILS, query.filters?.remainingILS)
    );
  });

  const totals = filtered.reduce(
    (acc, r) => {
      acc.expected = acc.expected.add(new Prisma.Decimal(r.expectedILS));
      acc.received = acc.received.add(new Prisma.Decimal(r.receivedILS));
      acc.remaining = acc.remaining.add(new Prisma.Decimal(r.remainingILS));
      return acc;
    },
    {
      expected: new Prisma.Decimal(0),
      received: new Prisma.Decimal(0),
      remaining: new Prisma.Decimal(0),
    },
  );

  const totalRows = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / limit));
  const safePage = Math.min(page, totalPages);
  const skip = (safePage - 1) * limit;

  return {
    rows: filtered.slice(skip, skip + limit),
    totalRows,
    page: safePage,
    limit,
    totalPages,
    totalExpected: money(totals.expected),
    totalReceived: money(totals.received),
    totalRemaining: money(totals.remaining),
  };
}
