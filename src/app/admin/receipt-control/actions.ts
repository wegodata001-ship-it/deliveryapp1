"use server";

import { Prisma } from "@prisma/client";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { endOfLocalDay, parseLocalDate } from "@/lib/work-week";

export type ReceiptBalanceFilter = "all" | "debt" | "credit" | "balanced";
export type ReceiptControlStatus = "DEBT" | "CREDIT" | "BALANCED";

export type ReceiptControlQuery = {
  page: number;
  limit: number;
  weekCode?: string;
  fromYmd?: string;
  toYmd?: string;
  balanceFilter?: ReceiptBalanceFilter;
  search?: string;
};

export type ReceiptControlRow = {
  customerId: string;
  customerName: string;
  totalInvoices: string;
  totalPayments: string;
  balance: string;
  status: ReceiptControlStatus;
};

export type ReceiptControlPayload = {
  rows: ReceiptControlRow[];
  totalRows: number;
  page: number;
  limit: number;
  totalPages: number;
  totalInvoices: string;
  totalPayments: string;
  totalBalance: string;
};

function money(n: Prisma.Decimal): string {
  return n.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
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

function toStatus(balance: Prisma.Decimal): ReceiptControlStatus {
  if (balance.gt(new Prisma.Decimal("0.01"))) return "DEBT";
  if (balance.lt(new Prisma.Decimal("-0.01"))) return "CREDIT";
  return "BALANCED";
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
      totalInvoices: "0.00",
      totalPayments: "0.00",
      totalBalance: "0.00",
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
  const search = query.search?.trim();
  if (search) {
    where.OR = [{ customerNameSnapshot: { contains: search, mode: "insensitive" } }, { customer: { displayName: { contains: search, mode: "insensitive" } } }];
  }

  const orders = await prisma.order.findMany({
    where,
    orderBy: [{ orderDate: "desc" }],
    select: {
      id: true,
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
        select: {
          amountIls: true,
          amountUsd: true,
          exchangeRate: true,
          totalIlsWithVat: true,
        },
      },
    },
  });

  const grouped = new Map<
    string,
    { customerId: string; customerName: string; invoices: Prisma.Decimal; payments: Prisma.Decimal }
  >();

  for (const o of orders) {
    const cid = o.customerId ?? `anon:${o.id}`;
    const name = o.customer?.displayName ?? o.customerNameSnapshot ?? "—";
    const current = grouped.get(cid) ?? {
      customerId: o.customerId ?? "",
      customerName: name,
      invoices: new Prisma.Decimal(0),
      payments: new Prisma.Decimal(0),
    };
    current.invoices = current.invoices.add(orderExpectedIlsValue(o));
    current.payments = current.payments.add(o.payments.reduce((sum, p) => sum.add(paymentIlsValue(p)), new Prisma.Decimal(0)));
    grouped.set(cid, current);
  }

  const rows: ReceiptControlRow[] = [...grouped.values()].map((g) => {
    const balance = g.invoices.sub(g.payments);
    return {
      customerId: g.customerId,
      customerName: g.customerName,
      totalInvoices: money(g.invoices),
      totalPayments: money(g.payments),
      balance: money(balance),
      status: toStatus(balance),
    };
  });

  const balanceFilter = query.balanceFilter || "all";
  const filtered = rows.filter((r) => {
    const b = new Prisma.Decimal(r.balance);
    if (balanceFilter === "debt") return b.gt(0);
    if (balanceFilter === "credit") return b.lt(0);
    if (balanceFilter === "balanced") return b.abs().lte(new Prisma.Decimal("0.01"));
    return true;
  });

  const totals = filtered.reduce(
    (acc, r) => {
      acc.invoices = acc.invoices.add(new Prisma.Decimal(r.totalInvoices));
      acc.payments = acc.payments.add(new Prisma.Decimal(r.totalPayments));
      acc.balance = acc.balance.add(new Prisma.Decimal(r.balance));
      return acc;
    },
    {
      invoices: new Prisma.Decimal(0),
      payments: new Prisma.Decimal(0),
      balance: new Prisma.Decimal(0),
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
    totalInvoices: money(totals.invoices),
    totalPayments: money(totals.payments),
    totalBalance: money(totals.balance),
  };
}
