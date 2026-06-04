import "server-only";

import { Prisma } from "@prisma/client";
import { ORDER_STATUS_META } from "@/constants/order-status";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import { isDebtWithdrawalOrderStatus } from "@/lib/debt-withdrawal-order";
import type {
  CustomerProfileOrderRow,
  CustomerProfilePaymentRow,
  CustomersModuleListRow,
  CustomersModuleListResult,
  CustomerWorkspaceOrderRow,
  CustomerWorkspacePaymentRow,
} from "@/lib/customers-module-types";
import { CUSTOMER_WORKSPACE_ROW_LIMIT } from "@/lib/customers-module-types";
import { prisma } from "@/lib/prisma";
import { activePaidPaymentWhere } from "@/lib/payment-record-status-shared";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";
import { paymentRecordUsdEquivalent } from "@/lib/payment-usd-equivalent";
import { DEFAULT_WORK_COUNTRY, type WorkCountryCode } from "@/lib/work-country";
import { formatLocalYmd } from "@/lib/work-week";

export type {
  CustomerProfileDetails,
  CustomerProfileKpis,
  CustomerProfileOrderRow,
  CustomerProfilePaymentRow,
  CustomerProfilePayload,
  CustomersModuleListRow,
  CustomersModuleListResult,
  CustomerWorkspaceOrderRow,
  CustomerWorkspacePaymentRow,
} from "@/lib/customers-module-types";

export { CUSTOMER_WORKSPACE_ROW_LIMIT } from "@/lib/customers-module-types";

type AggRow = {
  customerId: string;
  ordersUsd: Prisma.Decimal;
  withdrawalsUsd: Prisma.Decimal;
  paymentsUsd: Prisma.Decimal;
  balanceUsd: Prisma.Decimal;
};

const customerSelect = {
  id: true,
  customerCode: true,
  oldCustomerCode: true,
  displayName: true,
  nameAr: true,
  nameEn: true,
  nameHe: true,
  phone: true,
  country: true,
} as const;

function dec2(d: Prisma.Decimal | number | string): string {
  const n = d instanceof Prisma.Decimal ? d : new Prisma.Decimal(d);
  return n.toDecimalPlaces(2, 4).toFixed(2);
}

function mapCustomerRow(
  c: Prisma.CustomerGetPayload<{ select: typeof customerSelect }>,
  agg: { ordersUsd: Prisma.Decimal; paymentsUsd: Prisma.Decimal; balanceUsd: Prisma.Decimal },
): CustomersModuleListRow {
  const code = (c.customerCode ?? c.oldCustomerCode ?? "").trim() || "—";
  return {
    id: c.id,
    code,
    name: primaryCustomerDisplayName(c) || c.displayName || "—",
    phone: (c.phone ?? "").trim() || "—",
    country: (c.country ?? "").trim() || "—",
    ordersTotalUsd: dec2(agg.ordersUsd),
    paymentsTotalUsd: dec2(agg.paymentsUsd),
    balanceUsd: dec2(agg.balanceUsd),
  };
}

/** רשימת לקוחות + סכומי הזמנות/תשלומים/יתרה — שאילתת אגרגציה אחת + שליפת פרטים */
export async function listCustomersModule(
  opts: { page?: number; limit?: number; search?: string; workCountry?: WorkCountryCode } = {},
): Promise<CustomersModuleListResult> {
  const limit = Math.min(50, Math.max(1, Math.floor(opts.limit ?? 25)));
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const skip = (page - 1) * limit;
  const search = (opts.search ?? "").trim();
  const workCountry = opts.workCountry ?? DEFAULT_WORK_COUNTRY;

  const searchSql = search
    ? Prisma.sql`(
        c."displayName" ILIKE ${`%${search}%`}
        OR c."nameAr" ILIKE ${`%${search}%`}
        OR c."nameEn" ILIKE ${`%${search}%`}
        OR c."nameHe" ILIKE ${`%${search}%`}
        OR c."customerCode" ILIKE ${`%${search}%`}
        OR c."oldCustomerCode" ILIKE ${`%${search}%`}
        OR c."phone" ILIKE ${`%${search}%`}
      )`
    : Prisma.sql`TRUE`;

  const aggRows = await prisma.$queryRaw<AggRow[]>(Prisma.sql`
    SELECT
      c.id AS "customerId",
      COALESCE(o.orders_usd, 0) AS "ordersUsd",
      COALESCE(w.withdrawals_usd, 0) AS "withdrawalsUsd",
      COALESCE(p.payments_usd, 0) AS "paymentsUsd",
      (COALESCE(o.orders_usd, 0) - COALESCE(p.payments_usd, 0) - COALESCE(w.withdrawals_usd, 0)) AS "balanceUsd"
    FROM "Customer" c
    LEFT JOIN (
      SELECT "customerId", SUM(COALESCE("totalUsd", 0)) AS orders_usd
      FROM "Order"
      WHERE "deletedAt" IS NULL AND "status" <> 'DEBT_WITHDRAWAL' AND "countryCode" = ${workCountry}::"WorkCountryCode"
      GROUP BY "customerId"
    ) o ON o."customerId" = c.id
    LEFT JOIN (
      SELECT "customerId", SUM(COALESCE("debtWithdrawalUsd", 0)) AS withdrawals_usd
      FROM "Order"
      WHERE "deletedAt" IS NULL AND "status" = 'DEBT_WITHDRAWAL' AND "countryCode" = ${workCountry}::"WorkCountryCode"
      GROUP BY "customerId"
    ) w ON w."customerId" = c.id
    LEFT JOIN (
      SELECT "customerId", SUM(COALESCE("amountUsd", 0)) AS payments_usd
      FROM "Payment"
      WHERE "isPaid" = TRUE AND ("status" IS NULL OR "status" <> 'CANCELLED') AND "countryCode" = ${workCountry}::"WorkCountryCode"
      GROUP BY "customerId"
    ) p ON p."customerId" = c.id
    WHERE c."deletedAt" IS NULL AND ${searchSql}
    ORDER BY c."displayName" ASC
    OFFSET ${skip}
    LIMIT ${limit + 1}
  `);

  const hasMore = aggRows.length > limit;
  const slice = hasMore ? aggRows.slice(0, limit) : aggRows;
  const ids = slice.map((r) => r.customerId).filter(Boolean);
  if (ids.length === 0) return { rows: [], page, limit, hasMore: false };

  const customers = await prisma.customer.findMany({
    where: { id: { in: ids } },
    select: customerSelect,
  });
  const byId = new Map(customers.map((c) => [c.id, c]));
  const aggById = new Map(slice.map((r) => [r.customerId, r]));

  const rows = ids
    .map((id) => {
      const c = byId.get(id);
      const a = aggById.get(id);
      if (!c || !a) return null;
      return mapCustomerRow(c, {
        ordersUsd: a.ordersUsd,
        paymentsUsd: a.paymentsUsd,
        balanceUsd: a.balanceUsd,
      });
    })
    .filter((r): r is CustomersModuleListRow => r != null);

  return { rows, page, limit, hasMore };
}

export function customerDisplayCode(c: {
  customerCode: string | null;
  oldCustomerCode: string | null;
}): string {
  return (c.customerCode ?? c.oldCustomerCode ?? "").trim() || "—";
}

export function customerDisplayName(c: {
  displayName: string;
  nameAr: string | null;
  nameEn: string | null;
  nameHe: string | null;
}): string {
  return primaryCustomerDisplayName(c) || c.displayName || "—";
}

/** הזמנות ל-Customer Workspace — כל הלקוחות או לפי לקוח */
export async function listCustomerWorkspaceOrders(
  customerId?: string | null,
  workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
): Promise<CustomerWorkspaceOrderRow[]> {
  const cid = customerId?.trim() || null;
  const orders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      countryCode: workCountry,
      ...(cid ? { customerId: cid } : { customerId: { not: null } }),
    },
    orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
    take: CUSTOMER_WORKSPACE_ROW_LIMIT,
    select: {
      id: true,
      customerId: true,
      orderNumber: true,
      orderDate: true,
      amountUsd: true,
      commissionUsd: true,
      status: true,
      totalUsd: true,
      customer: { select: customerSelect },
    },
  });

  const orderIds = orders.map((o) => o.id);
  const paidByOrder = new Map<string, Prisma.Decimal>();
  if (orderIds.length > 0) {
    const paySums = await prisma.payment.groupBy({
      by: ["orderId"],
      where: {
        orderId: { in: orderIds },
        amountUsd: { not: null },
        countryCode: workCountry,
        ...activePaidPaymentWhere,
      },
      _sum: { amountUsd: true },
    });
    for (const s of paySums) {
      if (s.orderId) paidByOrder.set(s.orderId, s._sum.amountUsd ?? new Prisma.Decimal(0));
    }
  }

  return orders
    .filter((o) => o.customerId && o.customer)
    .map((o) => {
      const c = o.customer!;
      const deal = o.amountUsd ?? new Prisma.Decimal(0);
      const com = o.commissionUsd ?? new Prisma.Decimal(0);
      const total = o.totalUsd ?? deal.add(com);
      const paid = paidByOrder.get(o.id) ?? new Prisma.Decimal(0);
      const remaining = total.sub(paid).toDecimalPlaces(2, 4);
      const meta = ORDER_STATUS_META[o.status];
      return {
        id: o.id,
        customerId: o.customerId!,
        customerCode: customerDisplayCode(c),
        customerName: customerDisplayName(c),
        orderNumber: o.orderNumber?.trim() || "—",
        dateYmd: o.orderDate ? formatLocalYmd(new Date(o.orderDate)) : "—",
        amountUsd: deal.toDecimalPlaces(2, 4).toFixed(2),
        commissionUsd: com.toDecimalPlaces(2, 4).toFixed(2),
        balanceUsd: remaining.toFixed(2),
        status: o.status,
        statusLabel: meta?.label ?? o.status,
      };
    });
}

/** תשלומים ל-Customer Workspace */
export async function listCustomerWorkspacePayments(
  customerId?: string | null,
  workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
): Promise<CustomerWorkspacePaymentRow[]> {
  const cid = customerId?.trim() || null;
  const payments = await prisma.payment.findMany({
    where: {
      ...activePaidPaymentWhere,
      countryCode: workCountry,
      ...(cid ? { customerId: cid } : { customerId: { not: null } }),
    },
    orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
    take: CUSTOMER_WORKSPACE_ROW_LIMIT,
    select: {
      id: true,
      customerId: true,
      paymentCode: true,
      paymentDate: true,
      amountUsd: true,
      amountIls: true,
      paymentMethod: true,
      notes: true,
      usdNote: true,
      ilsNote: true,
      customer: { select: { ...customerSelect, email: true } },
    },
  });

  return payments
    .filter((p) => p.customerId && p.customer)
    .map((p) => {
      const c = p.customer!;
      const hasUsd = p.amountUsd != null && p.amountUsd.gt(0);
      const hasIls = p.amountIls != null && p.amountIls.gt(0);
      const method = p.paymentMethod;
      return {
        id: p.id,
        customerId: p.customerId!,
        customerCode: customerDisplayCode(c),
        customerName: customerDisplayName(c),
        paymentCode: p.paymentCode?.trim() || "—",
        dateYmd: p.paymentDate ? formatLocalYmd(new Date(p.paymentDate)) : "—",
        amountUsd: hasUsd ? p.amountUsd!.toDecimalPlaces(2, 4).toFixed(2) : "0.00",
        amountIls: hasIls ? p.amountIls!.toDecimalPlaces(2, 4).toFixed(2) : "0.00",
        currencyLabel: hasUsd && hasIls ? "USD+ILS" : hasIls ? "ILS" : "USD",
        paymentMethod: method ?? null,
        methodLabel: method ? PAYMENT_METHOD_LABELS[method] ?? method : "—",
        note: (p.notes ?? p.usdNote ?? p.ilsNote ?? "").trim() || "—",
      };
    });
}
