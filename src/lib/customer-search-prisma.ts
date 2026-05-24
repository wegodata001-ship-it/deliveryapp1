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

function exactOrConditions(q: string): Prisma.CustomerWhereInput[] {
  const isUuid = CUSTOMER_SEARCH_UUID_RE.test(q);
  const or: Prisma.CustomerWhereInput[] = [
    { customerCode: { equals: q, mode: "insensitive" } },
    { oldCustomerCode: { equals: q, mode: "insensitive" } },
    { phone: { equals: q } },
    { phone2: { equals: q } },
  ];
  if (isUuid) or.push({ id: q });
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 2 && digits !== q) {
    or.push({ phone: { equals: digits } });
    or.push({ phone2: { equals: digits } });
  }
  return or;
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

/** חיפוש קוד לקוח עם התעלמות מאפסים מובילים (17856 ↔ 017856) */
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

export type CustomerPrismaSearchOptions = {
  limit?: number;
  exactOnly?: boolean;
};

/**
 * חיפוש לקוחות — התאמה מדויקת (קוד / טלפון / UUID) ואז חלקית.
 * כולל fallback לקודים מספריים עם אפסים מובילים.
 */
export async function searchCustomersPrisma(
  raw: string,
  opts?: CustomerPrismaSearchOptions,
): Promise<CustomerSearchRow[]> {
  const q = normalizeCustomerSearchQuery(raw);
  const limit = Math.min(50, Math.max(5, Math.floor(opts?.limit ?? 20)));
  const exactOnly = opts?.exactOnly === true;

  if (!customerSearchQueryAllowed(q, exactOnly)) return [];

  const codeHit = await prisma.customer.findFirst({
    where: { ...baseWhere(), customerCode: { equals: q, mode: "insensitive" } },
    select: CUSTOMER_SEARCH_SELECT,
  });
  if (codeHit) {
    const row = toSearchRow(codeHit);
    return exactOnly ? [row] : [row];
  }

  const exactHits = await prisma.customer.findMany({
    where: { ...baseWhere(), OR: exactOrConditions(q) },
    take: exactOnly ? 1 : limit,
    orderBy: { displayName: "asc" },
    select: CUSTOMER_SEARCH_SELECT,
  });

  if (exactHits.length > 0) {
    return exactHits.map(toSearchRow);
  }

  if (exactOnly) {
    const normalized = await searchByNormalizedCodeDigits(q, 1);
    if (normalized.length > 0) return normalized;
    return [];
  }

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
