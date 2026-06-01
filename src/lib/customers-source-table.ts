import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import { customersPerfRun, customersPerfStart, customersPerfEnd } from "@/lib/customers-source-perf";
import { formatLocalYmd } from "@/lib/work-week";

export type CustomersSourceFilters = {
  search?: string;
  code?: string;
  name?: string;
  phone?: string;
  city?: string;
  /** "" | "true" | "false" */
  isActive?: string;
  fromYmd?: string;
  toYmd?: string;
};

export type CustomersSourceListQuery = {
  page?: number;
  limit?: number;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  filters?: CustomersSourceFilters;
};

export type CustomersSourceRow = {
  id: string;
  code: string;
  name: string;
  phone: string;
  city: string;
  type: string;
  created: string;
  isActive: boolean;
};

export type CustomersSourceListResult = {
  rows: CustomersSourceRow[];
  page: number;
  limit: number;
  hasMore: boolean;
};

export type CustomersSourceKpis = {
  total: number;
  active: number;
  withBalance: number;
  newThisMonth: number;
};

export type CustomersSourcePreview = {
  id: string;
  code: string;
  name: string;
  phone: string;
  city: string;
  joinedYmd: string;
  orderCount: number;
  balanceUsd: string;
};

function parseYmdStart(ymd: string): Date {
  return new Date(`${ymd.trim()}T00:00:00`);
}

function parseYmdEnd(ymd: string): Date {
  return new Date(`${ymd.trim()}T23:59:59.999`);
}

function monthStartUtc(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** בונה where ללא count — ממוקד אינדקסים */
export function buildCustomersSourceWhere(filters: CustomersSourceFilters = {}): Prisma.CustomerWhereInput {
  const search = filters.search?.trim() ?? "";
  customersPerfStart("customers.filters");
  try {
    const and: Prisma.CustomerWhereInput[] = [{ deletedAt: null }];

    const active = filters.isActive?.trim();
    if (active === "true") and.push({ isActive: true });
    else if (active === "false") and.push({ isActive: false });

    const code = filters.code?.trim();
    if (code) {
      and.push({
        OR: [
          { customerCode: { equals: code, mode: "insensitive" } },
          { oldCustomerCode: { equals: code, mode: "insensitive" } },
          { customerCode: { contains: code, mode: "insensitive" } },
        ],
      });
    }

    const name = filters.name?.trim();
    if (name) {
      and.push({
        OR: [
          { displayName: { contains: name, mode: "insensitive" } },
          { nameAr: { contains: name, mode: "insensitive" } },
          { nameEn: { contains: name, mode: "insensitive" } },
          { nameHe: { contains: name, mode: "insensitive" } },
        ],
      });
    }

    const phone = filters.phone?.trim().replace(/\D/g, "");
    if (phone && phone.length >= 2) {
      and.push({
        OR: [{ phone: { contains: phone } }, { phone2: { contains: phone } }],
      });
    }

    const city = filters.city?.trim();
    if (city) {
      and.push({ city: { contains: city, mode: "insensitive" } });
    }

    if (filters.fromYmd?.trim()) {
      and.push({ createdAt: { gte: parseYmdStart(filters.fromYmd) } });
    }
    if (filters.toYmd?.trim()) {
      and.push({ createdAt: { lte: parseYmdEnd(filters.toYmd) } });
    }

    const q = search.trim();
    if (q && !code && !name) {
      and.push({
        OR: [
          { customerCode: { contains: q, mode: "insensitive" } },
          { displayName: { contains: q, mode: "insensitive" } },
          { nameAr: { contains: q, mode: "insensitive" } },
          { nameEn: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
          { city: { contains: q, mode: "insensitive" } },
        ],
      });
    }

    return and.length === 1 ? and[0]! : { AND: and };
  } finally {
    customersPerfEnd("customers.filters");
  }
}

function orderByFromQuery(query: CustomersSourceListQuery): Prisma.CustomerOrderByWithRelationInput {
  const sortKey = query.sortKey?.trim();
  const sortDir = query.sortDir === "asc" ? "asc" : "desc";
  switch (sortKey) {
    case "name":
      return { displayName: sortDir };
    case "code":
      return { customerCode: sortDir };
    case "phone":
      return { phone: sortDir };
    case "city":
      return { city: sortDir };
    case "type":
      return { customerType: sortDir };
    case "active":
      return { isActive: sortDir };
    case "created":
      return { createdAt: sortDir };
    default:
      return { createdAt: "desc" };
  }
}

function mapRow(r: {
  id: string;
  customerCode: string | null;
  displayName: string;
  nameAr: string | null;
  nameEn: string | null;
  nameHe: string | null;
  phone: string | null;
  city: string | null;
  customerType: string | null;
  createdAt: Date;
  isActive: boolean;
}): CustomersSourceRow {
  return {
    id: r.id,
    code: r.customerCode ?? "",
    name: primaryCustomerDisplayName({
      nameAr: r.nameAr,
      nameEn: r.nameEn,
      nameHe: r.nameHe,
      displayName: r.displayName,
    }),
    phone: r.phone ?? "",
    city: r.city ?? "",
    type: r.customerType ?? "",
    created: formatLocalYmd(r.createdAt),
    isActive: r.isActive,
  };
}

const customerListSelect = {
  id: true,
  customerCode: true,
  displayName: true,
  nameAr: true,
  nameEn: true,
  nameHe: true,
  phone: true,
  city: true,
  customerType: true,
  createdAt: true,
  isActive: true,
} as const;

/** רשימה עם offset/limit — ללא count מלא */
export async function listCustomersSourceTable(
  query: CustomersSourceListQuery = {},
): Promise<CustomersSourceListResult> {
  return customersPerfRun("customers.load", async () => {
    const limit = Math.min(50, Math.max(1, Math.floor(query.limit || 25)));
    const page = Math.max(1, Math.floor(query.page || 1));
    const skip = (page - 1) * limit;
    const where = buildCustomersSourceWhere(query.filters ?? {});

    customersPerfStart("customers.query");
    const raw = await prisma.customer.findMany({
      where,
      orderBy: orderByFromQuery(query),
      skip,
      take: limit + 1,
      select: customerListSelect,
    });
    customersPerfEnd("customers.query");

    customersPerfStart("customers.pagination");
    const hasMore = raw.length > limit;
    const slice = hasMore ? raw.slice(0, limit) : raw;
    customersPerfEnd("customers.pagination");

    customersPerfStart("customers.response");
    const rows = slice.map(mapRow);
    customersPerfEnd("customers.response");

    return { rows, page, limit, hasMore };
  });
}

/** ייצוא — עד 5000 שורות לפי אותם פילטרים */
export async function listCustomersSourceForExport(
  query: CustomersSourceListQuery = {},
  maxRows = 5000,
): Promise<CustomersSourceRow[]> {
  const where = buildCustomersSourceWhere(query.filters ?? {});
  const rows = await prisma.customer.findMany({
    where,
    orderBy: orderByFromQuery(query),
    take: maxRows,
    select: customerListSelect,
  });
  return rows.map(mapRow);
}

async function loadCustomersSourceKpisUncached(): Promise<CustomersSourceKpis> {
  return customersPerfRun("customers.kpis", async () => {
    const base = { deletedAt: null } satisfies Prisma.CustomerWhereInput;
    const monthStart = monthStartUtc();

    const [total, active, newThisMonth, withBalanceRows] = await Promise.all([
      prisma.customer.count({ where: base }),
      prisma.customer.count({ where: { ...base, isActive: true } }),
      prisma.customer.count({ where: { ...base, createdAt: { gte: monthStart } } }),
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT c.id)::bigint AS count
        FROM "Customer" c
        WHERE c."deletedAt" IS NULL
          AND EXISTS (
            SELECT 1
            FROM "Order" o
            WHERE o."customerId" = c.id
              AND o."deletedAt" IS NULL
            GROUP BY o."customerId"
            HAVING COALESCE(SUM(COALESCE(o."totalUsd", o."amountUsd", 0)), 0)
              > COALESCE((
                SELECT SUM(COALESCE(p."amountUsd", 0))
                FROM "Payment" p
                WHERE p."customerId" = c.id
                  AND p."isPaid" = true
                  AND p."orderId" IS NOT NULL
              ), 0) + 0.01
          )
      `,
    ]);

    return {
      total,
      active,
      newThisMonth,
      withBalance: Number(withBalanceRows[0]?.count ?? 0),
    };
  });
}

export const CUSTOMERS_SOURCE_KPIS_TAG = "customers-source-kpis";

export const getCustomersSourceKpisCached = unstable_cache(
  () => loadCustomersSourceKpisUncached(),
  ["customers-source-kpis-v1"],
  { revalidate: 120, tags: [CUSTOMERS_SOURCE_KPIS_TAG] },
);

export async function getCustomerSourcePreview(customerId: string): Promise<CustomersSourcePreview | null> {
  return customersPerfRun("customers.preview", async () => {
    const id = customerId.trim();
    if (!id) return null;

    const cust = await prisma.customer.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        customerCode: true,
        displayName: true,
        nameAr: true,
        nameEn: true,
        nameHe: true,
        phone: true,
        city: true,
        createdAt: true,
      },
    });
    if (!cust) return null;

    const [orderCount, orderAgg, payAgg] = await Promise.all([
      prisma.order.count({ where: { customerId: id, deletedAt: null } }),
      prisma.order.aggregate({
        where: { customerId: id, deletedAt: null },
        _sum: { totalUsd: true, amountUsd: true },
      }),
      prisma.payment.aggregate({
        where: { customerId: id, isPaid: true, orderId: { not: null } },
        _sum: { amountUsd: true },
      }),
    ]);

    const charged =
      Number(orderAgg._sum.totalUsd ?? 0) > 0
        ? Number(orderAgg._sum.totalUsd)
        : Number(orderAgg._sum.amountUsd ?? 0);
    const paid = Number(payAgg._sum.amountUsd ?? 0);
    const balance = Math.max(0, charged - paid);

    return {
      id: cust.id,
      code: cust.customerCode ?? "—",
      name: primaryCustomerDisplayName({
        nameAr: cust.nameAr,
        nameEn: cust.nameEn,
        nameHe: cust.nameHe,
        displayName: cust.displayName,
      }),
      phone: cust.phone ?? "—",
      city: cust.city ?? "—",
      joinedYmd: formatLocalYmd(cust.createdAt),
      orderCount,
      balanceUsd: balance.toFixed(2),
    };
  });
}
