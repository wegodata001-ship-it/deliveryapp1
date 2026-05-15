"use server";

import { OrderStatus, Prisma } from "@prisma/client";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { endOfLocalDay, formatLocalYmd, parseLocalDate } from "@/lib/work-week";
import { normalizeOrderSourceCountry } from "@/lib/order-countries";
import type { ReportFilters } from "@/app/admin/reports/actions";
import { getOrderStatusLabel } from "@/constants/order-status";

/** ערכי סינון UI */
export type OpenOrdersModalStatusBucket =
  | "ALL"
  | "OPEN"
  | "PARTIAL_PAY"
  | "IN_CARE"
  | "COMPLETED"
  | "CANCELLED";

export type OpenOrdersModalQuery = {
  page: number;
  limit?: number;
  smart?: string;
  statusBucket?: OpenOrdersModalStatusBucket;
  weekCode?: string;
  fromYmd?: string;
  toYmd?: string;
  minUsd?: string;
  maxUsd?: string;
};

export type OpenOrderModalRow = {
  id: string;
  orderNumber: string;
  customerName: string;
  weekCode: string;
  totalUsd: string;
  totalIls: string;
  status: OrderStatus;
  statusLabel: string;
  paymentLabel: "ללא תשלום" | "חלקי" | "שולם";
  orderDateYmd: string;
};

export type OpenOrdersModalPayload = {
  rows: OpenOrderModalRow[];
  page: number;
  limit: number;
  totalRows: number;
  totalPages: number;
  kpis: {
    totalOrders: number;
    sumIls: string;
    sumUsd: string;
    inCareCount: number;
  };
};

const IN_CARE_STATUSES: OrderStatus[] = [
  OrderStatus.WAITING_FOR_EXECUTION,
  OrderStatus.WITHDRAWAL_FROM_SUPPLIER,
  OrderStatus.SENT,
  OrderStatus.WAITING_FOR_CHINA_EXECUTION,
  OrderStatus.DEBT_WITHDRAWAL,
];

const IN_CARE_SQL_LIST = IN_CARE_STATUSES.map((s) => `'${s}'`).join(", ");

const STATUS_LABEL: Record<OrderStatus, string> = Object.fromEntries(
  Object.values(OrderStatus).map((value) => [value, getOrderStatusLabel(value)]),
) as Record<OrderStatus, string>;

function moneyIls(v: Prisma.Decimal | number | null | undefined): string {
  const n = v instanceof Prisma.Decimal ? Number(v.toString()) : Number(v ?? 0);
  return `₪ ${n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function moneyUsd(v: Prisma.Decimal | number | null | undefined): string {
  const n = v instanceof Prisma.Decimal ? Number(v.toString()) : Number(v ?? 0);
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
}

function orderUsd(o: { totalUsd: Prisma.Decimal | null; amountUsd: Prisma.Decimal | null; commissionUsd: Prisma.Decimal | null }): Prisma.Decimal {
  return (o.totalUsd ?? (o.amountUsd ?? new Prisma.Decimal(0)).add(o.commissionUsd ?? new Prisma.Decimal(0))) as Prisma.Decimal;
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

function orderExpectedIls(o: {
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
  const usd = orderUsd(o);
  const rate = o.usdRateUsed ?? o.snapshotFinalDollarRate ?? o.exchangeRate;
  return rate ? usd.mul(rate) : new Prisma.Decimal(0);
}

function parseUsd(s: string | undefined): number | null {
  const t = s?.trim().replace(",", ".") ?? "";
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function mergedRange(report: ReportFilters, modal: OpenOrdersModalQuery) {
  const baseFrom = report.dateFrom?.trim() ? parseLocalDate(report.dateFrom.trim()) : new Date(2000, 0, 1);
  const baseTo = report.dateTo?.trim() ? endOfLocalDay(report.dateTo.trim()) : new Date(2999, 11, 31, 23, 59, 59, 999);
  const from = modal.fromYmd?.trim() ? parseLocalDate(modal.fromYmd.trim()) : baseFrom;
  const to = modal.toYmd?.trim() ? endOfLocalDay(modal.toYmd.trim()) : baseTo;
  return { from, to };
}

/** תנאי SQL לפילטור הזמנות במודאל — כולל סינון חלקי/דולר בלי לטעון את כל הטבלה */
function buildOpenOrdersModalSqlParts(report: ReportFilters, modal: OpenOrdersModalQuery): Prisma.Sql[] {
  const { from, to } = mergedRange(report, modal);
  const parts: Prisma.Sql[] = [
    Prisma.sql`o."deletedAt" IS NULL`,
    Prisma.sql`o."orderDate" >= ${from}`,
    Prisma.sql`o."orderDate" <= ${to}`,
  ];

  if (report.customerId?.trim()) {
    parts.push(Prisma.sql`o."customerId" = ${report.customerId.trim()}`);
  }

  const week = modal.weekCode?.trim() || report.workWeek?.trim();
  if (week) {
    parts.push(Prisma.sql`o."weekCode" = ${week}`);
  }

  const countryEnum = report.sourceCountry?.trim() ? normalizeOrderSourceCountry(report.sourceCountry.trim()) : null;
  if (countryEnum) {
    parts.push(Prisma.sql`o."sourceCountry" = ${countryEnum}::"OrderSourceCountry"`);
  }

  const smart = modal.smart?.trim();
  if (smart) {
    const pat = `%${smart}%`;
    parts.push(
      Prisma.sql`(o."orderNumber" ILIKE ${pat} OR o."customerNameSnapshot" ILIKE ${pat} OR o."customerCodeSnapshot" ILIKE ${pat})`,
    );
  }

  const parentStatus = report.status?.trim();
  const bucket = modal.statusBucket ?? "ALL";

  if (parentStatus) {
    parts.push(Prisma.sql`o."status" = ${parentStatus}::"OrderStatus"`);
  } else if (bucket === "PARTIAL_PAY") {
    const paidSum = Prisma.sql`
      COALESCE((
        SELECT SUM(
          COALESCE(p."totalIlsWithVat", p."amountIls",
            CASE WHEN p."amountUsd" IS NOT NULL AND p."exchangeRate" IS NOT NULL
              THEN (p."amountUsd" * p."exchangeRate")::numeric
              ELSE 0::numeric END)
        )
        FROM "Payment" p
        WHERE p."orderId" = o.id AND p."isPaid" = true
      ), 0::numeric)`;
    const expectedIls = Prisma.sql`
      COALESCE(o."totalIlsWithVat", o."totalIls",
        (COALESCE(o."totalUsd", COALESCE(o."amountUsd", 0::numeric) + COALESCE(o."commissionUsd", 0::numeric)))
        * COALESCE(o."usd_rate_used", o."snapshotFinalDollarRate", o."exchangeRate", 0::numeric)
      )`;
    parts.push(Prisma.sql`o."status" <> ${OrderStatus.CANCELLED}::"OrderStatus"`);
    parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "Payment" p0 WHERE p0."orderId" = o.id AND p0."isPaid" = true)`);
    parts.push(Prisma.sql`${paidSum} > 0.01::numeric`);
    parts.push(Prisma.sql`${paidSum} < (${expectedIls} - 0.01::numeric)`);
  } else if (bucket === "ALL") {
    parts.push(
      Prisma.sql`o."status" NOT IN (${OrderStatus.COMPLETED}::"OrderStatus", ${OrderStatus.CANCELLED}::"OrderStatus")`,
    );
  } else if (bucket === "OPEN") {
    parts.push(Prisma.sql`o."status" = ${OrderStatus.OPEN}::"OrderStatus"`);
  } else if (bucket === "COMPLETED") {
    parts.push(Prisma.sql`o."status" = ${OrderStatus.COMPLETED}::"OrderStatus"`);
  } else if (bucket === "CANCELLED") {
    parts.push(Prisma.sql`o."status" = ${OrderStatus.CANCELLED}::"OrderStatus"`);
  } else if (bucket === "IN_CARE") {
    parts.push(Prisma.raw(`o."status"::text IN (${IN_CARE_SQL_LIST})`));
  }

  const orderUsdExpr = Prisma.sql`COALESCE(o."totalUsd", COALESCE(o."amountUsd", 0::numeric) + COALESCE(o."commissionUsd", 0::numeric))`;
  const minU = parseUsd(modal.minUsd);
  const maxU = parseUsd(modal.maxUsd);
  if (minU != null) {
    parts.push(Prisma.sql`${orderUsdExpr} >= ${minU}::numeric`);
  }
  if (maxU != null) {
    parts.push(Prisma.sql`${orderUsdExpr} <= ${maxU}::numeric`);
  }

  return parts;
}

export async function listOpenOrdersReportModalAction(
  report: ReportFilters,
  modal: OpenOrdersModalQuery,
): Promise<OpenOrdersModalPayload> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_reports"])) {
    return {
      rows: [],
      page: 1,
      limit: 15,
      totalRows: 0,
      totalPages: 1,
      kpis: { totalOrders: 0, sumIls: moneyIls(0), sumUsd: moneyUsd(0), inCareCount: 0 },
    };
  }

  const limit = Math.min(50, Math.max(1, Math.floor(modal.limit ?? 15)));

  const sqlParts = buildOpenOrdersModalSqlParts(report, modal);
  const whereSql = Prisma.join(sqlParts, " AND ");

  const kpiRow = await prisma.$queryRaw<[{ cnt: bigint; in_care: bigint; s_ils: unknown; s_usd: unknown }]>(Prisma.sql`
    SELECT
      COUNT(*)::bigint AS cnt,
      COALESCE(SUM(CASE WHEN o."status"::text IN (${Prisma.raw(IN_CARE_SQL_LIST)}) THEN 1 ELSE 0 END), 0)::bigint AS in_care,
      COALESCE(SUM(COALESCE(o."totalIlsWithVat", o."totalIls", 0::numeric)), 0::numeric) AS s_ils,
      COALESCE(SUM(COALESCE(o."totalUsd", COALESCE(o."amountUsd", 0::numeric) + COALESCE(o."commissionUsd", 0::numeric))), 0::numeric) AS s_usd
    FROM "Order" o
    WHERE ${whereSql}
  `);

  const kr = kpiRow[0];
  const totalRows = Number(kr?.cnt ?? BigInt(0));
  const inCareCount = Number(kr?.in_care ?? BigInt(0));
  const sumIlsDec = new Prisma.Decimal(String(kr?.s_ils ?? 0));
  const sumUsdDec = new Prisma.Decimal(String(kr?.s_usd ?? 0));

  const totalPages = Math.max(1, Math.ceil(totalRows / limit));
  const requestedPage = Math.max(1, Math.floor(modal.page || 1));
  const page = Math.min(requestedPage, totalPages);
  const skip = (page - 1) * limit;

  const idRows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT o.id FROM "Order" o
    WHERE ${whereSql}
    ORDER BY o."orderDate" DESC NULLS LAST, o.id DESC
    LIMIT ${limit} OFFSET ${skip}
  `);

  const ids = idRows.map((r) => r.id);
  const orders =
    ids.length === 0 ?
      []
    : await prisma.order.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          orderNumber: true,
          customerNameSnapshot: true,
          weekCode: true,
          totalUsd: true,
          amountUsd: true,
          commissionUsd: true,
          totalIlsWithVat: true,
          totalIls: true,
          usdRateUsed: true,
          snapshotFinalDollarRate: true,
          exchangeRate: true,
          status: true,
          orderDate: true,
          payments: {
            where: { isPaid: true },
            select: { totalIlsWithVat: true, amountIls: true, amountUsd: true, exchangeRate: true },
          },
        },
      });

  const byId = new Map(orders.map((o) => [o.id, o]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as typeof orders;

  const rows: OpenOrderModalRow[] = ordered.map((o) => {
    const exp = orderExpectedIls(o);
    const paid = o.payments.reduce((s, p) => s.add(paymentIls(p)), new Prisma.Decimal(0));
    let paymentLabel: OpenOrderModalRow["paymentLabel"] = "ללא תשלום";
    if (paid.gt(new Prisma.Decimal("0.01"))) {
      paymentLabel = paid.lt(exp.sub(new Prisma.Decimal("0.01"))) ? "חלקי" : "שולם";
    }
    const od = o.orderDate ? formatLocalYmd(new Date(o.orderDate)) : "";
    return {
      id: o.id,
      orderNumber: o.orderNumber ?? "",
      customerName: o.customerNameSnapshot ?? "",
      weekCode: o.weekCode ?? "",
      totalUsd: moneyUsd(orderUsd(o)),
      totalIls: moneyIls(o.totalIlsWithVat ?? o.totalIls ?? 0),
      status: o.status,
      statusLabel: STATUS_LABEL[o.status] ?? o.status,
      paymentLabel,
      orderDateYmd: od,
    };
  });

  return {
    rows,
    page,
    limit,
    totalRows,
    totalPages,
    kpis: {
      totalOrders: totalRows,
      sumIls: moneyIls(sumIlsDec),
      sumUsd: moneyUsd(sumUsdDec),
      inCareCount,
    },
  };
}
