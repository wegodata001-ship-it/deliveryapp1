import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withPerfTimer } from "@/lib/perf-log";

export type CustomerApiSearchRow = {
  id: string;
  customerCode: string | null;
  oldCustomerCode: string | null;
  displayName: string;
  nameHe: string | null;
  nameEn: string | null;
  nameAr: string | null;
  phone: string | null;
  city: string | null;
  customerType: string | null;
};

export type CustomerApiSearchParams = {
  query: string;
  limit?: number;
  page?: number;
};

const selectApi = {
  id: true,
  customerCode: true,
  oldCustomerCode: true,
  displayName: true,
  nameHe: true,
  nameEn: true,
  nameAr: true,
  phone: true,
  city: true,
  customerType: true,
} as const;

function toRow(r: {
  id: string;
  customerCode: string | null;
  oldCustomerCode: string | null;
  displayName: string;
  nameHe: string | null;
  nameEn: string | null;
  nameAr: string | null;
  phone: string | null;
  city: string | null;
  customerType: string | null;
}): CustomerApiSearchRow {
  return {
    id: r.id,
    customerCode: r.customerCode,
    oldCustomerCode: r.oldCustomerCode,
    displayName: r.displayName,
    nameHe: r.nameHe,
    nameEn: r.nameEn,
    nameAr: r.nameAr,
    phone: r.phone,
    city: r.city,
    customerType: r.customerType,
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * חיפוש לקוחות ל-API: קודם התאמות מדויקות (מזהה / קוד / אינדקס),
 * אחר כך חלקיות בשם בעברית / שם תצוגה / שם בערבית.
 */
export async function searchCustomersByQuery(raw: string): Promise<CustomerApiSearchRow[]> {
  return searchCustomersByQueryPaged({ query: raw });
}

export async function searchCustomersByQueryPaged(params: CustomerApiSearchParams): Promise<CustomerApiSearchRow[]> {
  return withPerfTimer("search.customers.api", async () => {
    const q = params.query.trim();
    const limit = Math.min(50, Math.max(5, Math.floor(params.limit ?? 20)));
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const skip = (page - 1) * limit;

    if (!q) return [];
    const isUuid = UUID_RE.test(q);
    if (!isUuid && q.length < 2) return [];

    const base: Prisma.CustomerWhereInput = { isActive: true, deletedAt: null };

    const exactOr: Prisma.CustomerWhereInput[] = [];
    if (isUuid) {
      exactOr.push({ id: q });
    }
    exactOr.push({ customerCode: { equals: q, mode: "insensitive" } });
    exactOr.push({ oldCustomerCode: { equals: q, mode: "insensitive" } });
    exactOr.push({ phone: { equals: q } });
    exactOr.push({ secondPhone: { equals: q } });

    const exactHits = await prisma.customer.findMany({
      where: { ...base, OR: exactOr },
      skip,
      take: limit,
      select: selectApi,
      orderBy: { displayName: "asc" },
    });

    if (exactHits.length > 0) {
      return exactHits.map(toRow);
    }

    const partialHits = await prisma.customer.findMany({
      where: {
        ...base,
        OR: [
          { displayName: { contains: q, mode: "insensitive" } },
          { nameHe: { contains: q, mode: "insensitive" } },
          { nameEn: { contains: q, mode: "insensitive" } },
          { nameAr: { contains: q, mode: "insensitive" } },
          { customerCode: { contains: q, mode: "insensitive" } },
          { oldCustomerCode: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
          { secondPhone: { contains: q } },
        ],
      },
      skip,
      take: limit,
      orderBy: { displayName: "asc" },
      select: selectApi,
    });

    return partialHits.map(toRow);
  });
}
