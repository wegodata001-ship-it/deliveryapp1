"use server";

import { OrderStatus, PaymentMethod, Prisma } from "@prisma/client";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { endOfLocalDay, formatLocalYmd, parseLocalDate } from "@/lib/work-week";

export type ReportKind =
  | "openOrdersReport"
  | "paymentsByLocationReport"
  | "weeklySummaryReport"
  | "customerBalanceReport"
  | "paymentsByMethodReport";

export type ReportFilters = {
  dateFrom?: string;
  dateTo?: string;
  customerId?: string;
  status?: string;
  paymentMethod?: string;
  workWeek?: string;
};

export type ReportCard = {
  id: ReportKind;
  title: string;
  description: string;
  icon: string;
  preview: string;
};

export type ReportKpis = {
  totalOrders: string;
  totalPaymentsLinked: string;
  totalDebt: string;
  totalCredit: string;
};

export type ReportPayload = {
  kpis: ReportKpis;
  reports: ReportCard[];
  customers: Array<{ id: string; label: string }>;
  statusOptions: Array<{ value: string; label: string }>;
  paymentMethodOptions: Array<{ value: string; label: string }>;
};

export type ReportTable = {
  id: ReportKind;
  title: string;
  columns: string[];
  rows: string[][];
  totals: {
    total: string;
    paid: string;
    remaining: string;
  };
};

const STATUS_HE: Record<string, string> = {
  OPEN: "פתוח",
  CANCELLED: "בוטל",
  WAITING_FOR_EXECUTION: "ממתין",
  WITHDRAWAL_FROM_SUPPLIER: "משיכה מספק",
  SENT: "נשלח",
  WAITING_FOR_CHINA_EXECUTION: "ממתין לסין",
  COMPLETED: "הושלם",
};

const METHOD_HE: Record<string, string> = {
  POINT: "נקודת תשלום",
  BANK_TRANSFER: "העברה בנקאית",
  BANK_TRANSFER_DONE: "העברה בוצעה",
  ORDERED: "הוזמן",
  WITHDRAWAL: "משיכה",
  WITHDRAWAL_DONE: "משיכה בוצעה",
  RECEIVED_AT_POINT: "התקבל בנקודה",
  WITH_GOODS: "עם הסחורה",
  CHECK: "צ'ק",
  CASH: "מזומן",
  CREDIT: "אשראי",
  OTHER: "אחר",
};

function dateRange(filters: ReportFilters) {
  const from = filters.dateFrom?.trim() ? parseLocalDate(filters.dateFrom.trim()) : new Date(2000, 0, 1);
  const to = filters.dateTo?.trim() ? endOfLocalDay(filters.dateTo.trim()) : new Date(2999, 11, 31, 23, 59, 59, 999);
  return { from, to };
}

function moneyIls(v: Prisma.Decimal | number | string | null | undefined): string {
  const n = v instanceof Prisma.Decimal ? Number(v.toString()) : Number(v ?? 0);
  return `₪ ${n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function moneyUsd(v: Prisma.Decimal | number | string | null | undefined): string {
  const n = v instanceof Prisma.Decimal ? Number(v.toString()) : Number(v ?? 0);
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
}

function dec(v: Prisma.Decimal | number | string | null | undefined): Prisma.Decimal {
  if (v instanceof Prisma.Decimal) return v;
  return new Prisma.Decimal(v ?? 0);
}

function paymentIls(p: { totalIlsWithVat: Prisma.Decimal | null; amountIls: Prisma.Decimal | null; amountUsd: Prisma.Decimal | null; exchangeRate: Prisma.Decimal | null }) {
  if (p.totalIlsWithVat) return p.totalIlsWithVat;
  if (p.amountIls) return p.amountIls;
  if (p.amountUsd && p.exchangeRate) return p.amountUsd.mul(p.exchangeRate);
  return new Prisma.Decimal(0);
}

async function ensureAllowed() {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_reports"])) throw new Error("אין הרשאה");
}

async function computeKpis(filters: ReportFilters): Promise<ReportKpis> {
  const { from, to } = dateRange(filters);
  const orderWhere: Prisma.OrderWhereInput = {
    deletedAt: null,
    orderDate: { gte: from, lte: to },
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.status ? { status: filters.status as OrderStatus } : {}),
    ...(filters.workWeek ? { weekCode: filters.workWeek } : {}),
  };
  const paymentWhereBase: Prisma.PaymentWhereInput = {
    isPaid: true,
    paymentDate: { gte: from, lte: to },
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.paymentMethod ? { paymentMethod: filters.paymentMethod as PaymentMethod } : {}),
    ...(filters.workWeek ? { weekCode: filters.workWeek } : {}),
  };
  const [orders, payments] = await Promise.all([
    prisma.order.findMany({ where: orderWhere, select: { totalIlsWithVat: true, totalIls: true } }),
    prisma.payment.findMany({
      where: paymentWhereBase,
      select: { orderId: true, totalIlsWithVat: true, amountIls: true, amountUsd: true, exchangeRate: true },
    }),
  ]);
  const expected = orders.reduce((sum, o) => sum.add(o.totalIlsWithVat ?? o.totalIls ?? 0), new Prisma.Decimal(0));
  const paidLinked = payments
    .filter((p) => !!p.orderId)
    .reduce((sum, p) => sum.add(paymentIls(p)), new Prisma.Decimal(0));
  const credits = payments
    .filter((p) => !p.orderId)
    .reduce((sum, p) => sum.add(paymentIls(p)), new Prisma.Decimal(0));
  const open = expected.sub(paidLinked);
  const debt = open.gt(0) ? open : new Prisma.Decimal(0);
  return {
    totalOrders: String(orders.length),
    totalPaymentsLinked: moneyIls(paidLinked),
    totalDebt: moneyIls(debt),
    totalCredit: moneyIls(credits),
  };
}

export async function getReportsDashboardAction(filters: ReportFilters): Promise<ReportPayload> {
  await ensureAllowed();
  const [kpis, customers] = await Promise.all([
    computeKpis(filters),
    prisma.customer.findMany({
      where: { deletedAt: null, isActive: true },
      take: 200,
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true, customerCode: true },
    }),
  ]);
  const reports: ReportCard[] = [
    { id: "openOrdersReport", title: "דוח הזמנות פתוחות", description: "הזמנות שעדיין לא נסגרו, לפי לקוח ושבוע.", icon: "📦", preview: `${kpis.totalOrders} הזמנות בטווח` },
    { id: "paymentsByLocationReport", title: "תשלומים לפי מקום", description: "סיכום תשלומים לפי מקום קליטת התשלום.", icon: "📍", preview: `תשלומים קשורים ${kpis.totalPaymentsLinked}` },
    { id: "weeklySummaryReport", title: "סיכום שבועי", description: "סיכום הזמנות, תשלומים ויתרות לפי שבוע עבודה.", icon: "📅", preview: filters.workWeek ? `שבוע ${filters.workWeek}` : "כל השבועות בטווח" },
    { id: "customerBalanceReport", title: "יתרות לקוחות", description: "לקוחות, שולם, יתרה פתוחה וסכומים לתשלום.", icon: "⚖️", preview: `יתרת חוב ${kpis.totalDebt}` },
    { id: "paymentsByMethodReport", title: "תשלומים לפי אמצעי", description: "חלוקת תשלומים לפי מזומן, אשראי, העברה ועוד.", icon: "💳", preview: `סה\"כ זיכויים ${kpis.totalCredit}` },
  ];
  return {
    kpis,
    reports,
    customers: customers.map((c) => ({ id: c.id, label: c.customerCode ? `${c.displayName} (${c.customerCode})` : c.displayName })),
    statusOptions: Object.values(OrderStatus).map((value) => ({ value, label: STATUS_HE[value] ?? value })),
    paymentMethodOptions: Object.values(PaymentMethod).map((value) => ({ value, label: METHOD_HE[value] ?? value })),
  };
}

export async function getReportTableAction(kind: ReportKind, filters: ReportFilters): Promise<ReportTable> {
  await ensureAllowed();
  const { from, to } = dateRange(filters);

  if (kind === "openOrdersReport") {
    const rows = await prisma.order.findMany({
      where: {
        deletedAt: null,
        orderDate: { gte: from, lte: to },
        status: filters.status ? (filters.status as OrderStatus) : { notIn: [OrderStatus.COMPLETED, OrderStatus.CANCELLED] },
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(filters.workWeek ? { weekCode: filters.workWeek } : {}),
      },
      orderBy: { orderDate: "desc" },
      select: { orderNumber: true, customerNameSnapshot: true, weekCode: true, totalUsd: true, totalIlsWithVat: true, status: true },
    });
    const total = rows.reduce((sum, r) => sum.add(r.totalIlsWithVat ?? 0), new Prisma.Decimal(0));
    return {
      id: kind,
      title: "דוח הזמנות פתוחות",
      columns: ["מספר הזמנה", "לקוח", "שבוע", "סכום דולר", "סכום ש\"ח", "סטטוס"],
      rows: rows.map((r) => [r.orderNumber ?? "", r.customerNameSnapshot ?? "", r.weekCode ?? "", moneyUsd(r.totalUsd), moneyIls(r.totalIlsWithVat), STATUS_HE[r.status] ?? r.status]),
      totals: { total: moneyIls(total), paid: moneyIls(0), remaining: moneyIls(total) },
    };
  }

  if (kind === "paymentsByLocationReport") {
    const rows = await prisma.payment.findMany({
      where: {
        isPaid: true,
        orderId: { not: null },
        paymentDate: { gte: from, lte: to },
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(filters.paymentMethod ? { paymentMethod: filters.paymentMethod as PaymentMethod } : {}),
      },
      select: { paymentPlace: true, totalIlsWithVat: true, amountIls: true, amountUsd: true, exchangeRate: true },
    });
    const map = new Map<string, { count: number; sum: Prisma.Decimal }>();
    for (const p of rows) {
      const key = p.paymentPlace || "ללא מקום";
      const cur = map.get(key) ?? { count: 0, sum: new Prisma.Decimal(0) };
      cur.count += 1;
      cur.sum = cur.sum.add(paymentIls(p));
      map.set(key, cur);
    }
    const total = [...map.values()].reduce((sum, x) => sum.add(x.sum), new Prisma.Decimal(0));
    return {
      id: kind,
      title: "תשלומים לפי מקום",
      columns: ["מקום תשלום", "כמות תשלומים", "סכום ש\"ח"],
      rows: [...map.entries()].map(([place, v]) => [place, String(v.count), moneyIls(v.sum)]),
      totals: { total: moneyIls(total), paid: moneyIls(total), remaining: moneyIls(0) },
    };
  }

  if (kind === "paymentsByMethodReport") {
    const [ordersInRange, rows] = await Promise.all([
      prisma.order.count({
        where: {
          deletedAt: null,
          orderDate: { gte: from, lte: to },
          ...(filters.customerId ? { customerId: filters.customerId } : {}),
          ...(filters.workWeek ? { weekCode: filters.workWeek } : {}),
        },
      }),
      prisma.payment.findMany({
        where: {
          isPaid: true,
          paymentDate: { gte: from, lte: to },
          ...(filters.customerId ? { customerId: filters.customerId } : {}),
          ...(filters.paymentMethod ? { paymentMethod: filters.paymentMethod as PaymentMethod } : {}),
          ...(filters.workWeek ? { weekCode: filters.workWeek } : {}),
        },
        select: { orderId: true, paymentMethod: true, totalIlsWithVat: true, amountIls: true, amountUsd: true, exchangeRate: true },
      }),
    ]);
    const linkedRows = rows.filter((r) => !!r.orderId);
    const generalRows = rows.filter((r) => !r.orderId);
    const map = new Map<string, { count: number; sum: Prisma.Decimal }>();
    for (const p of linkedRows) {
      const key = p.paymentMethod ? METHOD_HE[p.paymentMethod] ?? p.paymentMethod : "ללא אמצעי";
      const cur = map.get(key) ?? { count: 0, sum: new Prisma.Decimal(0) };
      cur.count += 1;
      cur.sum = cur.sum.add(paymentIls(p));
      map.set(key, cur);
    }
    const total = [...map.values()].reduce((sum, x) => sum.add(x.sum), new Prisma.Decimal(0));
    const generalTotal = generalRows.reduce((sum, r) => sum.add(paymentIls(r)), new Prisma.Decimal(0));
    return {
      id: kind,
      title: ordersInRange === 0 ? "תשלומים לפי אמצעי (תשלומים כלליים בלבד)" : "תשלומים לפי אמצעי",
      columns: ["אמצעי תשלום", "כמות תשלומים", "סכום ש\"ח"],
      rows:
        ordersInRange === 0
          ? [["תשלומים כלליים בלבד", String(generalRows.length), moneyIls(generalTotal)]]
          : [...map.entries()].map(([method, v]) => [method, String(v.count), moneyIls(v.sum)]),
      totals: {
        total: moneyIls(total),
        paid: moneyIls(total),
        remaining: ordersInRange === 0 ? "תשלומים כלליים בלבד" : moneyIls(0),
      },
    };
  }

  if (kind === "weeklySummaryReport") {
    const [orders, payments] = await Promise.all([
      prisma.order.findMany({ where: { deletedAt: null, orderDate: { gte: from, lte: to }, ...(filters.customerId ? { customerId: filters.customerId } : {}) }, select: { weekCode: true, totalIlsWithVat: true, totalIls: true } }),
      prisma.payment.findMany({
        where: { isPaid: true, orderId: { not: null }, paymentDate: { gte: from, lte: to }, ...(filters.customerId ? { customerId: filters.customerId } : {}) },
        select: { weekCode: true, totalIlsWithVat: true, amountIls: true, amountUsd: true, exchangeRate: true },
      }),
    ]);
    const map = new Map<string, { orders: number; total: Prisma.Decimal; paid: Prisma.Decimal }>();
    for (const o of orders) {
      const key = o.weekCode || "ללא שבוע";
      const cur = map.get(key) ?? { orders: 0, total: new Prisma.Decimal(0), paid: new Prisma.Decimal(0) };
      cur.orders += 1;
      cur.total = cur.total.add(o.totalIlsWithVat ?? o.totalIls ?? 0);
      map.set(key, cur);
    }
    for (const p of payments) {
      const key = p.weekCode || "ללא שבוע";
      const cur = map.get(key) ?? { orders: 0, total: new Prisma.Decimal(0), paid: new Prisma.Decimal(0) };
      cur.paid = cur.paid.add(paymentIls(p));
      map.set(key, cur);
    }
    const total = [...map.values()].reduce((sum, x) => sum.add(x.total), new Prisma.Decimal(0));
    const paid = [...map.values()].reduce((sum, x) => sum.add(x.paid), new Prisma.Decimal(0));
    return {
      id: kind,
      title: "סיכום שבועי",
      columns: ["שבוע", "כמות הזמנות", "סכום כולל", "שולם", "פתוח"],
      rows: [...map.entries()].map(([week, v]) => [week, String(v.orders), moneyIls(v.total), moneyIls(v.paid), moneyIls(v.total.sub(v.paid))]),
      totals: { total: moneyIls(total), paid: moneyIls(paid), remaining: moneyIls(total.sub(paid)) },
    };
  }

  const customers = await prisma.customer.findMany({
    where: { deletedAt: null, isActive: true, ...(filters.customerId ? { id: filters.customerId } : {}) },
    orderBy: { displayName: "asc" },
    select: {
      displayName: true,
      customerCode: true,
      orders: {
        where: {
          deletedAt: null,
          orderDate: { gte: from, lte: to },
          ...(filters.workWeek ? { weekCode: filters.workWeek } : {}),
          ...(filters.status ? { status: filters.status as OrderStatus } : {}),
        },
        select: { totalIlsWithVat: true, totalIls: true },
      },
      payments: {
        where: {
          isPaid: true,
          orderId: { not: null },
          paymentDate: { gte: from, lte: to },
          ...(filters.workWeek ? { weekCode: filters.workWeek } : {}),
          ...(filters.paymentMethod ? { paymentMethod: filters.paymentMethod as PaymentMethod } : {}),
        },
        select: { totalIlsWithVat: true, amountIls: true, amountUsd: true, exchangeRate: true },
      },
    },
  });
  let total = new Prisma.Decimal(0);
  let paid = new Prisma.Decimal(0);
  const tableRows = customers.map((c) => {
    const expected = c.orders.reduce((sum, o) => sum.add(o.totalIlsWithVat ?? o.totalIls ?? 0), new Prisma.Decimal(0));
    const received = c.payments.reduce((sum, p) => sum.add(paymentIls(p)), new Prisma.Decimal(0));
    total = total.add(expected);
    paid = paid.add(received);
    return [c.displayName, c.customerCode ?? "", moneyIls(expected), moneyIls(received), moneyIls(expected.sub(received))];
  });
  return {
    id: kind,
    title: "יתרות לקוחות",
    columns: ["לקוח", "קוד לקוח", "סה\"כ הזמנות", "סה\"כ תשלומים", "יתרה"],
    rows: tableRows,
    totals: { total: moneyIls(total), paid: moneyIls(paid), remaining: moneyIls(total.sub(paid)) },
  };
}
