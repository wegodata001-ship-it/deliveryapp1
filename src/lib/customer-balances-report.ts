import { PaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import { normalizeOrderSourceCountry } from "@/lib/order-countries";
import { endOfLocalDay, parseLocalDate } from "@/lib/work-week";

/** פילטרים משותפים ל־KPI דוחות + דוח יתרות לקוחות + ייצוא */
export type CustomerBalancesReportFilters = {
  dateFrom?: string;
  dateTo?: string;
  customerId?: string;
  status?: string;
  paymentMethod?: string;
  workWeek?: string;
  /** TURKEY | CHINA | UAE — כמו Order.sourceCountry */
  sourceCountry?: string;
};

export type CustomerBalanceReportRow = {
  customerId: string | null;
  label: string;
  customerCode: string | null;
  expected: Prisma.Decimal;
  received: Prisma.Decimal;
  remaining: Prisma.Decimal;
  remainingUsd: Prisma.Decimal;
  /** תווית לייצוא */
  paymentStatus: string;
};

function dateRange(filters: CustomerBalancesReportFilters) {
  const from = filters.dateFrom?.trim() ? parseLocalDate(filters.dateFrom.trim()) : new Date(2000, 0, 1);
  const to = filters.dateTo?.trim() ? endOfLocalDay(filters.dateTo.trim()) : new Date(2999, 11, 31, 23, 59, 59, 999);
  return { from, to };
}

/** תנאי Prisma זהים לחישוב דוח יתרות לקוחות (הזמנות + תשלומים קשורים) */
export function getCustomerBalancesReportWhereClauses(filters: CustomerBalancesReportFilters): {
  from: Date;
  to: Date;
  orderWhere: Prisma.OrderWhereInput;
  paymentWhereLinked: Prisma.PaymentWhereInput;
} {
  const { from, to } = dateRange(filters);
  const countryEnum = filters.sourceCountry?.trim()
    ? normalizeOrderSourceCountry(filters.sourceCountry.trim())
    : null;

  const orderWhere: Prisma.OrderWhereInput = {
    deletedAt: null,
    orderDate: { gte: from, lte: to },
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.workWeek ? { weekCode: filters.workWeek } : {}),
    ...(countryEnum ? { sourceCountry: countryEnum } : {}),
  };

  const paymentWhereLinked: Prisma.PaymentWhereInput = {
    isPaid: true,
    orderId: { not: null },
    paymentDate: { gte: from, lte: to },
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.workWeek ? { weekCode: filters.workWeek } : {}),
    ...(filters.paymentMethod ? { paymentMethod: filters.paymentMethod as PaymentMethod } : {}),
  };

  return { from, to, orderWhere, paymentWhereLinked };
}

function paymentIls(p: {
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

function orderUsd(o: {
  totalUsd: Prisma.Decimal | null;
  amountUsd: Prisma.Decimal | null;
  commissionUsd: Prisma.Decimal | null;
}): Prisma.Decimal {
  return (o.totalUsd ?? (o.amountUsd ?? new Prisma.Decimal(0)).add(o.commissionUsd ?? new Prisma.Decimal(0))) as Prisma.Decimal;
}

function paymentUsd(p: { amountUsd: Prisma.Decimal | null }): Prisma.Decimal {
  return p.amountUsd ?? new Prisma.Decimal(0);
}

function orderIls(o: { totalIlsWithVat: Prisma.Decimal | null; totalIls: Prisma.Decimal | null }): Prisma.Decimal {
  return (o.totalIlsWithVat ?? o.totalIls ?? new Prisma.Decimal(0)) as Prisma.Decimal;
}

function autoPayStatus(expected: Prisma.Decimal, received: Prisma.Decimal): "NOT_PAID" | "PARTIAL" | "PAID" {
  if (expected.lte(new Prisma.Decimal("0.01"))) return "PAID";
  if (received.lte(new Prisma.Decimal("0.01"))) return "NOT_PAID";
  if (received.lt(expected.sub(new Prisma.Decimal("0.01")))) return "PARTIAL";
  return "PAID";
}

function paymentStatusLabel(auto: "NOT_PAID" | "PARTIAL" | "PAID", debtUsd: Prisma.Decimal): string {
  const u = Number(debtUsd.toFixed(2));
  if (u > 0 && u < 5) return "יתרה נמוכה";
  if (auto === "PAID") return "שולם במלואו";
  if (auto === "PARTIAL") return "שולם חלקית";
  return "ללא תשלום";
}

/**
 * מקור אמת יחיד: שורות לקוח עם יתרה חיובית (סכום הזמנות בטווח − תשלומים קשורים בטווח),
 * כולל הזמנות ללא customerId (שורה סינתטית).
 */
export async function getCustomerBalancesReport(filters: CustomerBalancesReportFilters): Promise<{
  rows: CustomerBalanceReportRow[];
  /** סכום יתרות חיוביות בלבד — חייב להתאים לסכום עמודת "יתרה" בדוח */
  totalDebt: Prisma.Decimal;
  totalExpectedOnRows: Prisma.Decimal;
  totalReceivedOnRows: Prisma.Decimal;
}> {
  const { orderWhere, paymentWhereLinked } = getCustomerBalancesReportWhereClauses(filters);

  const customers = await prisma.customer.findMany({
    where: { deletedAt: null, isActive: true, ...(filters.customerId ? { id: filters.customerId } : {}) },
    orderBy: { displayName: "asc" },
    select: {
      id: true,
      displayName: true,
      nameAr: true,
      nameEn: true,
      nameHe: true,
      customerCode: true,
      orders: {
        where: orderWhere,
        select: { totalIlsWithVat: true, totalIls: true, totalUsd: true, amountUsd: true, commissionUsd: true },
      },
      payments: {
        where: paymentWhereLinked,
        select: { totalIlsWithVat: true, amountIls: true, amountUsd: true, exchangeRate: true },
      },
    },
  });

  const rows: CustomerBalanceReportRow[] = [];

  for (const c of customers) {
    const expected = c.orders.reduce((sum, o) => sum.add(orderIls(o)), new Prisma.Decimal(0));
    const received = c.payments.reduce((sum, p) => sum.add(paymentIls(p)), new Prisma.Decimal(0));
    const remaining = expected.sub(received);
    const expectedUsd = c.orders.reduce((sum, o) => sum.add(orderUsd(o)), new Prisma.Decimal(0));
    const receivedUsd = c.payments.reduce((sum, p) => sum.add(paymentUsd(p)), new Prisma.Decimal(0));
    const remainingUsd = expectedUsd.sub(receivedUsd);
    const auto = autoPayStatus(expected, received);
    const paymentStatus = paymentStatusLabel(auto, remainingUsd.gt(0) ? remainingUsd : new Prisma.Decimal(0));
    if (remaining.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).lte(0)) continue;

    rows.push({
      customerId: c.id,
      label: primaryCustomerDisplayName({
        nameAr: c.nameAr,
        nameEn: c.nameEn,
        nameHe: c.nameHe,
        displayName: c.displayName,
      }),
      customerCode: c.customerCode,
      expected,
      received,
      remaining,
      remainingUsd,
      paymentStatus,
    });
  }

  const orphanOrderWhere: Prisma.OrderWhereInput = {
    ...orderWhere,
    customerId: null,
  };

  const orphanOrders = await prisma.order.findMany({
    where: orphanOrderWhere,
    select: { id: true, totalIlsWithVat: true, totalIls: true, totalUsd: true, amountUsd: true, commissionUsd: true },
  });

  if (orphanOrders.length > 0) {
    const ids = orphanOrders.map((o) => o.id);
    const orphanPayments = await prisma.payment.findMany({
      where: {
        ...paymentWhereLinked,
        orderId: { in: ids },
      },
      select: { totalIlsWithVat: true, amountIls: true, amountUsd: true, exchangeRate: true },
    });

    const expectedOrphan = orphanOrders.reduce((s, o) => s.add(orderIls(o)), new Prisma.Decimal(0));
    const receivedOrphan = orphanPayments.reduce((s, p) => s.add(paymentIls(p)), new Prisma.Decimal(0));
    const remainingOrphan = expectedOrphan.sub(receivedOrphan);
    const expectedOrphanUsd = orphanOrders.reduce((s, o) => s.add(orderUsd(o)), new Prisma.Decimal(0));
    const receivedOrphanUsd = orphanPayments.reduce((s, p) => s.add(paymentUsd(p)), new Prisma.Decimal(0));
    const remainingOrphanUsd = expectedOrphanUsd.sub(receivedOrphanUsd);
    const autoOrphan = autoPayStatus(expectedOrphan, receivedOrphan);
    const paymentStatusOrphan = paymentStatusLabel(autoOrphan, remainingOrphanUsd.gt(0) ? remainingOrphanUsd : new Prisma.Decimal(0));
    if (remainingOrphan.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).gt(0)) {
      rows.push({
        customerId: null,
        label: "הזמנות ללא שיוך לקוח",
        customerCode: null,
        expected: expectedOrphan,
        received: receivedOrphan,
        remaining: remainingOrphan,
        remainingUsd: remainingOrphanUsd,
        paymentStatus: paymentStatusOrphan,
      });
    }
  }

  const totalDebt = rows.reduce((s, r) => s.add(r.remaining), new Prisma.Decimal(0));
  const totalExpectedOnRows = rows.reduce((s, r) => s.add(r.expected), new Prisma.Decimal(0));
  const totalReceivedOnRows = rows.reduce((s, r) => s.add(r.received), new Prisma.Decimal(0));

  console.log("[getCustomerBalancesReport]", {
    filters,
    totalDebt: totalDebt.toString(),
    rowsCount: rows.length,
    totalExpectedOnRows: totalExpectedOnRows.toString(),
    totalReceivedOnRows: totalReceivedOnRows.toString(),
  });

  return {
    rows,
    totalDebt,
    totalExpectedOnRows,
    totalReceivedOnRows,
  };
}
