"use server";

import { OrderSourceCountry, Prisma } from "@prisma/client";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import { endOfLocalDay, parseLocalDate } from "@/lib/work-week";
import { ORDER_COUNTRY_CODES, normalizeOrderSourceCountry, type OrderCountryCode } from "@/lib/order-countries";

export type CustomerBalanceStatus = "NOT_PAID" | "PARTIAL" | "PAID" | "PROBLEM" | "PAUSED";

/** סינון לפי מצב יתרה (חישוב), לא לפי סטטוס גבייה */
export type CustomerBalanceDebtFilter = "ALL" | "OWES" | "PAID_FULL" | "PARTIAL";

export type CustomerBalanceSort = "balance_desc" | "balance_asc" | "name" | "orders_total";

export type CustomerBalanceFilters = {
  name?: string;
  code?: string;
  phone?: string;
  balanceDebtStatus?: CustomerBalanceDebtFilter;
  minBalanceIls?: string;
  maxBalanceIls?: string;
  sort?: CustomerBalanceSort;
};

export type CustomerBalanceQuery = {
  page: number;
  limit: number;
  fromYmd?: string;
  toYmd?: string;
  weekCode?: string;
  /** מדינת מקור הזמנה — ריק = כל המדינות */
  sourceCountry?: OrderCountryCode | "";
  filters?: CustomerBalanceFilters;
};

export type CustomerBalanceRow = {
  customerId: string;
  customerName: string;
  customerCode: string | null;
  /** מספר הזמנות שנכנסו לחישוב בטווח */
  ordersCount: number;
  totalOrdersILS: string;
  totalPaymentsILS: string;
  totalCreditsILS: string;
  noOrdersInRange: boolean;
  balanceILS: string;
  balanceUSD: string;
  expectedILS: string;
  receivedILS: string;
  status: CustomerBalanceStatus;
  autoStatus: CustomerBalanceStatus;
  statusOverride: CustomerBalanceStatus | null;
};

export type CustomerBalancesPayload = {
  rows: CustomerBalanceRow[];
  page: number;
  limit: number;
  totalRows: number;
  totalPages: number;
};

const STATUS_VALUES = new Set<CustomerBalanceStatus>(["NOT_PAID", "PARTIAL", "PAID", "PROBLEM", "PAUSED"]);

const DEBT_FILTER_VALUES = new Set<CustomerBalanceDebtFilter>(["ALL", "OWES", "PAID_FULL", "PARTIAL"]);

const SORT_VALUES = new Set<CustomerBalanceSort>(["balance_desc", "balance_asc", "name", "orders_total"]);

async function ensureStatusOverrideTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "CustomerBalanceStatusOverride" (
      "customerId" TEXT PRIMARY KEY,
      "statusOverride" TEXT,
      "note" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
  await prisma.$executeRaw`ALTER TABLE "CustomerBalanceStatusOverride" ALTER COLUMN "statusOverride" DROP NOT NULL`;
  await prisma.$executeRaw`ALTER TABLE "CustomerBalanceStatusOverride" ADD COLUMN IF NOT EXISTS "note" TEXT`;
}

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

function autoStatus(expected: Prisma.Decimal, received: Prisma.Decimal): CustomerBalanceStatus {
  if (expected.lte(new Prisma.Decimal("0.01"))) return "PAID";
  if (received.lte(new Prisma.Decimal("0.01"))) return "NOT_PAID";
  if (received.lt(expected.sub(new Prisma.Decimal("0.01")))) return "PARTIAL";
  return "PAID";
}

function parseIlsFilter(raw: string | undefined): number | null {
  const t = raw?.trim().replace(",", ".") ?? "";
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function rowBalanceNumber(balanceIls: string): number {
  const n = Number(balanceIls.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function rowOrdersTotalNumber(totalOrdersILS: string): number {
  const n = Number(totalOrdersILS.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function matchesDebtFilter(row: CustomerBalanceRow, filter: CustomerBalanceDebtFilter): boolean {
  if (filter === "ALL") return true;
  const bal = rowBalanceNumber(row.balanceILS);
  const auto = row.autoStatus;
  const eps = 0.01;
  if (filter === "OWES") return bal > eps;
  if (filter === "PAID_FULL") return auto === "PAID" && Math.abs(bal) <= eps;
  if (filter === "PARTIAL") return auto === "PARTIAL";
  return true;
}

export async function listCustomerBalancesAction(query: CustomerBalanceQuery): Promise<CustomerBalancesPayload> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_reports"])) {
    return { rows: [], page: 1, limit: 15, totalRows: 0, totalPages: 1 };
  }

  await ensureStatusOverrideTable();

  const orderDateWhere: Prisma.DateTimeFilter | undefined =
    query.fromYmd?.trim() || query.toYmd?.trim()
      ? {
          ...(query.fromYmd?.trim() ? { gte: parseLocalDate(query.fromYmd.trim()) } : {}),
          ...(query.toYmd?.trim() ? { lte: endOfLocalDay(query.toYmd.trim()) } : {}),
        }
      : undefined;
  const paymentDateWhere: Prisma.DateTimeFilter | undefined =
    query.fromYmd?.trim() || query.toYmd?.trim()
      ? {
          ...(query.fromYmd?.trim() ? { gte: parseLocalDate(query.fromYmd.trim()) } : {}),
          ...(query.toYmd?.trim() ? { lte: endOfLocalDay(query.toYmd.trim()) } : {}),
        }
      : undefined;

  const countryNorm = normalizeOrderSourceCountry(query.sourceCountry || null);
  const orderCountryPrisma: OrderSourceCountry | undefined =
    countryNorm && (ORDER_COUNTRY_CODES as readonly string[]).includes(countryNorm) ? (countryNorm as OrderSourceCountry) : undefined;

  const orderNestedWhere: Prisma.OrderWhereInput = {
    deletedAt: null,
    ...(query.weekCode?.trim() ? { weekCode: query.weekCode.trim() } : {}),
    ...(orderDateWhere ? { orderDate: orderDateWhere } : {}),
    ...(orderCountryPrisma ? { sourceCountry: orderCountryPrisma } : {}),
  };

  const paymentLinkedWhere: Prisma.PaymentWhereInput = {
    isPaid: true,
    orderId: { not: null },
    ...(query.weekCode?.trim() ? { weekCode: query.weekCode.trim() } : {}),
    ...(paymentDateWhere ? { paymentDate: paymentDateWhere } : {}),
    ...(orderCountryPrisma
      ? {
          order: {
            deletedAt: null,
            sourceCountry: orderCountryPrisma,
          },
        }
      : {}),
  };

  const customers = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      ...(query.filters?.name?.trim()
        ? {
            OR: [
              { displayName: { contains: query.filters.name.trim(), mode: "insensitive" as const } },
              { nameAr: { contains: query.filters.name.trim(), mode: "insensitive" as const } },
              { nameEn: { contains: query.filters.name.trim(), mode: "insensitive" as const } },
              { nameHe: { contains: query.filters.name.trim(), mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(query.filters?.code?.trim()
        ? { customerCode: { contains: query.filters.code.trim(), mode: "insensitive" as const } }
        : {}),
      ...(query.filters?.phone?.trim()
        ? {
            OR: [
              { phone: { contains: query.filters.phone.trim(), mode: "insensitive" as const } },
              { secondPhone: { contains: query.filters.phone.trim(), mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { displayName: "asc" },
    select: {
      id: true,
      displayName: true,
      nameAr: true,
      nameEn: true,
      nameHe: true,
      customerCode: true,
      orders: {
        where: orderNestedWhere,
        select: {
          totalIlsWithVat: true,
          totalIls: true,
          totalUsd: true,
          amountUsd: true,
          commissionUsd: true,
          usdRateUsed: true,
          snapshotFinalDollarRate: true,
          exchangeRate: true,
        },
      },
      payments: {
        where: paymentLinkedWhere,
        select: {
          totalIlsWithVat: true,
          amountIls: true,
          amountUsd: true,
          exchangeRate: true,
        },
      },
    },
  });

  const customerIds = customers.map((c) => c.id);
  const generalCreditRows =
    customerIds.length > 0
      ? await prisma.payment.findMany({
          where: {
            isPaid: true,
            orderId: null,
            customerId: { in: customerIds },
            ...(query.weekCode?.trim() ? { weekCode: query.weekCode.trim() } : {}),
            ...(paymentDateWhere ? { paymentDate: paymentDateWhere } : {}),
          },
          select: {
            customerId: true,
            totalIlsWithVat: true,
            amountIls: true,
            amountUsd: true,
            exchangeRate: true,
          },
        })
      : [];
  const creditByCustomer = new Map<string, Prisma.Decimal>();
  for (const p of generalCreditRows) {
    const cid = p.customerId ?? "";
    if (!cid) continue;
    const cur = creditByCustomer.get(cid) ?? new Prisma.Decimal(0);
    creditByCustomer.set(cid, cur.add(paymentIlsValue(p)));
  }

  const overrides = await prisma.$queryRaw<Array<{ customerId: string; statusOverride: string | null }>>`
    SELECT "customerId", "statusOverride"
    FROM "CustomerBalanceStatusOverride"
  `;
  const overrideMap = new Map(
    overrides
      .filter((r) => r.statusOverride && STATUS_VALUES.has(r.statusOverride as CustomerBalanceStatus))
      .map((r) => [r.customerId, r.statusOverride as CustomerBalanceStatus]),
  );

  const rows = customers.map((c): CustomerBalanceRow => {
    const expectedIls = c.orders.reduce((sum, o) => sum.add(orderExpectedIlsValue(o)), new Prisma.Decimal(0));
    const receivedIls = c.payments.reduce((sum, p) => sum.add(paymentIlsValue(p)), new Prisma.Decimal(0));
    const creditsIls = creditByCustomer.get(c.id) ?? new Prisma.Decimal(0);
    const balanceIls = expectedIls.sub(receivedIls);
    const expectedUsd = c.orders.reduce(
      (sum, o) => sum.add(o.totalUsd ?? (o.amountUsd ?? new Prisma.Decimal(0)).add(o.commissionUsd ?? new Prisma.Decimal(0))),
      new Prisma.Decimal(0),
    );
    const receivedUsd = c.payments.reduce((sum, p) => sum.add(p.amountUsd ?? new Prisma.Decimal(0)), new Prisma.Decimal(0));
    const calculated = autoStatus(expectedIls, receivedIls);
    const override = overrideMap.get(c.id) ?? null;
    return {
      customerId: c.id,
      customerName: primaryCustomerDisplayName({
        nameAr: c.nameAr,
        nameEn: c.nameEn,
        nameHe: c.nameHe,
        displayName: c.displayName,
      }),
      customerCode: c.customerCode,
      ordersCount: c.orders.length,
      totalOrdersILS: money(expectedIls),
      totalPaymentsILS: money(receivedIls),
      totalCreditsILS: money(creditsIls),
      noOrdersInRange: c.orders.length === 0,
      balanceILS: money(balanceIls),
      balanceUSD: money(expectedUsd.sub(receivedUsd)),
      expectedILS: money(expectedIls),
      receivedILS: money(receivedIls),
      status: override ?? calculated,
      autoStatus: calculated,
      statusOverride: override,
    };
  });

  const debtFilter: CustomerBalanceDebtFilter =
    query.filters?.balanceDebtStatus && DEBT_FILTER_VALUES.has(query.filters.balanceDebtStatus)
      ? query.filters.balanceDebtStatus
      : "ALL";

  const minB = parseIlsFilter(query.filters?.minBalanceIls);
  const maxB = parseIlsFilter(query.filters?.maxBalanceIls);

  let filtered = rows.filter((r) => matchesDebtFilter(r, debtFilter));

  if (minB != null) filtered = filtered.filter((r) => rowBalanceNumber(r.balanceILS) >= minB);
  if (maxB != null) filtered = filtered.filter((r) => rowBalanceNumber(r.balanceILS) <= maxB);

  const sort: CustomerBalanceSort =
    query.filters?.sort && SORT_VALUES.has(query.filters.sort) ? query.filters.sort : "balance_desc";

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "balance_desc") return rowBalanceNumber(b.balanceILS) - rowBalanceNumber(a.balanceILS);
    if (sort === "balance_asc") return rowBalanceNumber(a.balanceILS) - rowBalanceNumber(b.balanceILS);
    if (sort === "orders_total") return rowOrdersTotalNumber(b.totalOrdersILS) - rowOrdersTotalNumber(a.totalOrdersILS);
    return a.customerName.localeCompare(b.customerName, "he");
  });

  const limit = Math.min(50, Math.max(1, Math.floor(query.limit || 15)));
  const requestedPage = Math.max(1, Math.floor(query.page || 1));
  const totalRows = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / limit));
  const page = Math.min(requestedPage, totalPages);
  const skip = (page - 1) * limit;

  return {
    rows: sorted.slice(skip, skip + limit),
    page,
    limit,
    totalRows,
    totalPages,
  };
}

export async function updateCustomerBalanceStatusAction(
  customerId: string,
  status: CustomerBalanceStatus,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_reports"])) return { ok: false, error: "אין הרשאה" };

  const id = customerId.trim();
  if (!id) return { ok: false, error: "לקוח לא נמצא" };
  if (!STATUS_VALUES.has(status)) return { ok: false, error: "סטטוס לא תקין" };

  await ensureStatusOverrideTable();
  await prisma.$executeRaw`
    INSERT INTO "CustomerBalanceStatusOverride" ("customerId", "statusOverride", "updatedAt")
    VALUES (${id}, ${status}, CURRENT_TIMESTAMP)
    ON CONFLICT ("customerId")
    DO UPDATE SET "statusOverride" = EXCLUDED."statusOverride", "updatedAt" = CURRENT_TIMESTAMP
  `;

  return { ok: true };
}

export async function updateCustomerBalanceNoteAction(
  customerId: string,
  note: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_reports"])) return { ok: false, error: "אין הרשאה" };

  const id = customerId.trim();
  if (!id) return { ok: false, error: "לקוח לא נמצא" };
  const clean = note.trim() || null;

  await ensureStatusOverrideTable();
  await prisma.$executeRaw`
    INSERT INTO "CustomerBalanceStatusOverride" ("customerId", "note", "updatedAt")
    VALUES (${id}, ${clean}, CURRENT_TIMESTAMP)
    ON CONFLICT ("customerId")
    DO UPDATE SET "note" = EXCLUDED."note", "updatedAt" = CURRENT_TIMESTAMP
  `;

  return { ok: true };
}
