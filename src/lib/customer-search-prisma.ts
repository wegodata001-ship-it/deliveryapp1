import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import type { CustomerSearchRow } from "@/app/admin/capture/actions";
import {
  CUSTOMER_SEARCH_UUID_RE,
  customerSearchQueryAllowed,
  normalizeCustomerSearchQuery,
} from "@/lib/customer-search-shared";

export { CUSTOMER_SEARCH_UUID_RE, customerSearchQueryAllowed, normalizeCustomerSearchQuery };

export const CUSTOMER_SEARCH_SELECT = {
  id: true,
  displayName: true,
  customerCode: true,
  oldCustomerCode: true,
  customerType: true,
  city: true,
  phone: true,
  phone2: true,
  nameAr: true,
  nameEn: true,
  nameHe: true,
  isActive: true,
  deletedAt: true,
} as const;

type CustomerSearchDbRow = Prisma.CustomerGetPayload<{ select: typeof CUSTOMER_SEARCH_SELECT }>;

function toSearchRow(r: CustomerSearchDbRow): CustomerSearchRow {
  return {
    id: r.id,
    label: primaryCustomerDisplayName({
      nameAr: r.nameAr,
      nameEn: r.nameEn,
      nameHe: r.nameHe,
      displayName: r.displayName,
    }),
    code: r.customerCode,
    customerType: r.customerType,
    city: r.city,
    phone: r.phone,
    nameAr: r.nameAr,
    nameEn: r.nameEn,
    nameHe: r.nameHe,
    phone2: r.phone2,
    oldCustomerCode: r.oldCustomerCode,
  };
}

function baseWhere(): Prisma.CustomerWhereInput {
  return { isActive: true, deletedAt: null };
}

function partialOrConditions(q: string): Prisma.CustomerWhereInput[] {
  const or: Prisma.CustomerWhereInput[] = [
    { displayName: { contains: q, mode: "insensitive" } },
    { nameHe: { contains: q, mode: "insensitive" } },
    { nameEn: { contains: q, mode: "insensitive" } },
    { nameAr: { contains: q, mode: "insensitive" } },
    { customerCode: { contains: q, mode: "insensitive" } },
    { oldCustomerCode: { contains: q, mode: "insensitive" } },
    { phone: { contains: q } },
    { phone2: { contains: q } },
  ];
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 2) {
    or.push({ phone: { contains: digits } });
    or.push({ phone2: { contains: digits } });
  }
  return or;
}

async function fetchByIdList(ids: string[]): Promise<CustomerSearchRow[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.customer.findMany({
    where: { ...baseWhere(), id: { in: ids } },
    select: CUSTOMER_SEARCH_SELECT,
    orderBy: { displayName: "asc" },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map((r) => toSearchRow(r!));
}

/** חיפוש קוד מספרי עם אפסים מובילים — רק במצב חלקי (לא exact=1) */
async function searchByNormalizedCodeDigits(q: string, limit: number): Promise<CustomerSearchRow[]> {
  if (!/^\d+$/.test(q)) return [];
  const stripped = q.replace(/^0+/, "") || "0";
  const pattern = `%${stripped}%`;
  const ids = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Customer"
    WHERE "deletedAt" IS NULL
      AND "isActive" = true
      AND (
        regexp_replace(COALESCE("customerCode", ''), '^0+', '') ILIKE ${pattern}
        OR regexp_replace(COALESCE("oldCustomerCode", ''), '^0+', '') ILIKE ${pattern}
      )
    ORDER BY "displayName" ASC
    LIMIT ${limit}
  `;
  return fetchByIdList(ids.map((r) => r.id));
}

/**
 * exact=1 — קוד לקוח / קוד ישן / UUID בלבד.
 * ללא contains, ILIKE, טלפון, או סריקת טבלה.
 */
function isActiveCustomer(row: { deletedAt: Date | null; isActive: boolean }): boolean {
  return row.isActive && row.deletedAt == null;
}

async function searchCustomersExact(q: string): Promise<CustomerSearchRow[]> {
  if (CUSTOMER_SEARCH_UUID_RE.test(q)) {
    const byId = await prisma.customer.findUnique({
      where: { id: q },
      select: CUSTOMER_SEARCH_SELECT,
    });
    return byId && isActiveCustomer(byId) ? [toSearchRow(byId)] : [];
  }

  const byCode = await prisma.customer.findUnique({
    where: { customerCode: q },
    select: CUSTOMER_SEARCH_SELECT,
  });
  if (byCode && isActiveCustomer(byCode)) return [toSearchRow(byCode)];

  const byCodeCi = await prisma.customer.findFirst({
    where: { ...baseWhere(), customerCode: { equals: q, mode: "insensitive" } },
    select: CUSTOMER_SEARCH_SELECT,
  });
  if (byCodeCi) return [toSearchRow(byCodeCi)];

  const byOld = await prisma.customer.findFirst({
    where: { ...baseWhere(), oldCustomerCode: { equals: q, mode: "insensitive" } },
    select: CUSTOMER_SEARCH_SELECT,
  });
  if (byOld) return [toSearchRow(byOld)];

  return [];
}

export type CustomerPrismaSearchOptions = {
  limit?: number;
  exactOnly?: boolean;
};

/**
 * חיפוש לקוחות — exact=1: findFirst לפי קוד בלבד; אחרת התאמת קוד ואז חלקי.
 */
export async function searchCustomersPrisma(
  raw: string,
  opts?: CustomerPrismaSearchOptions,
): Promise<CustomerSearchRow[]> {
  const q = normalizeCustomerSearchQuery(raw);
  const limit = Math.min(50, Math.max(5, Math.floor(opts?.limit ?? 20)));
  const exactOnly = opts?.exactOnly === true;

  if (!customerSearchQueryAllowed(q, exactOnly)) return [];

  if (exactOnly) {
    return searchCustomersExact(q);
  }

  const codeHit =
    (await prisma.customer.findUnique({ where: { customerCode: q }, select: CUSTOMER_SEARCH_SELECT })) ??
    (await prisma.customer.findFirst({
      where: { ...baseWhere(), customerCode: { equals: q, mode: "insensitive" } },
      select: CUSTOMER_SEARCH_SELECT,
    }));
  if (codeHit && isActiveCustomer(codeHit)) return [toSearchRow(codeHit)];

  const partialHits = await prisma.customer.findMany({
    where: { ...baseWhere(), OR: partialOrConditions(q) },
    take: limit,
    orderBy: { displayName: "asc" },
    select: CUSTOMER_SEARCH_SELECT,
  });

  if (partialHits.length > 0) {
    return partialHits.map(toSearchRow);
  }

  return searchByNormalizedCodeDigits(q, limit);
}
