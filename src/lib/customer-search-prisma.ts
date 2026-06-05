import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_WORK_COUNTRY, normalizeWorkCountryCode, type WorkCountryCode } from "@/lib/work-country";
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
  address: true,
  countryCode: true,
  balanceUsd: true,
  isActive: true,
  deletedAt: true,
} as const;

type CustomerSearchDbRow = Prisma.CustomerGetPayload<{ select: typeof CUSTOMER_SEARCH_SELECT }>;

export function mapCustomerRowsToSearchRows(rows: CustomerSearchDbRow[]): CustomerSearchRow[] {
  return rows.map(toSearchRow);
}

function toSearchRow(r: CustomerSearchDbRow): CustomerSearchRow {
  const bal = r.balanceUsd != null ? Number(r.balanceUsd) : 0;
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
    address: r.address,
    countryCode: r.countryCode,
    balanceUsd: Number.isFinite(bal) ? bal : 0,
  };
}

function resolveSearchWorkCountry(workCountry?: string | null): WorkCountryCode {
  return normalizeWorkCountryCode(workCountry) ?? DEFAULT_WORK_COUNTRY;
}

function baseWhere(workCountry?: string | null): Prisma.CustomerWhereInput {
  return {
    isActive: true,
    deletedAt: null,
    countryCode: resolveSearchWorkCountry(workCountry),
  };
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

async function fetchByIdList(ids: string[], workCountry?: string | null): Promise<CustomerSearchRow[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.customer.findMany({
    where: { ...baseWhere(workCountry), id: { in: ids } },
    select: CUSTOMER_SEARCH_SELECT,
    orderBy: { displayName: "asc" },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map((r) => toSearchRow(r!));
}

/** חיפוש קוד מספרי עם אפסים מובילים — רק במצב חלקי (לא exact=1) */
async function searchByNormalizedCodeDigits(
  q: string,
  limit: number,
  workCountry?: string | null,
): Promise<CustomerSearchRow[]> {
  if (!/^\d+$/.test(q)) return [];
  const wc = resolveSearchWorkCountry(workCountry);
  const stripped = q.replace(/^0+/, "") || "0";
  const pattern = `%${stripped}%`;
  const ids = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Customer"
    WHERE "deletedAt" IS NULL
      AND "isActive" = true
      AND "countryCode" = ${wc}::"WorkCountryCode"
      AND (
        regexp_replace(COALESCE("customerCode", ''), '^0+', '') ILIKE ${pattern}
        OR regexp_replace(COALESCE("oldCustomerCode", ''), '^0+', '') ILIKE ${pattern}
      )
    ORDER BY "displayName" ASC
    LIMIT ${limit}
  `;
  return fetchByIdList(
    ids.map((r) => r.id),
    workCountry,
  );
}

/**
 * exact=1 — קוד לקוח / קוד ישן / UUID בלבד.
 * ללא contains, ILIKE, טלפון, או סריקת טבלה.
 */
function isActiveCustomer(row: { deletedAt: Date | null; isActive: boolean }): boolean {
  return row.isActive && row.deletedAt == null;
}

async function searchCustomersExact(q: string, workCountry?: string | null): Promise<CustomerSearchRow[]> {
  const wc = resolveSearchWorkCountry(workCountry);
  if (CUSTOMER_SEARCH_UUID_RE.test(q)) {
    const byId = await prisma.customer.findFirst({
      where: { ...baseWhere(workCountry), id: q },
      select: CUSTOMER_SEARCH_SELECT,
    });
    return byId ? [toSearchRow(byId)] : [];
  }

  const byCode = await prisma.customer.findFirst({
    where: { ...baseWhere(workCountry), customerCode: { equals: q, mode: "insensitive" } },
    select: CUSTOMER_SEARCH_SELECT,
  });
  if (byCode) return [toSearchRow(byCode)];

  const byOld = await prisma.customer.findFirst({
    where: { ...baseWhere(workCountry), oldCustomerCode: { equals: q, mode: "insensitive" } },
    select: CUSTOMER_SEARCH_SELECT,
  });
  if (byOld) return [toSearchRow(byOld)];

  return [];
}

export type CustomerPrismaSearchOptions = {
  limit?: number;
  exactOnly?: boolean;
  /** TR / CN / AE — חובה לסינון סביבה */
  workCountry?: string | null;
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

  const workCountry = opts?.workCountry;

  if (exactOnly) {
    return searchCustomersExact(q, workCountry);
  }

  const codeHit = await prisma.customer.findFirst({
    where: { ...baseWhere(workCountry), customerCode: { equals: q, mode: "insensitive" } },
    select: CUSTOMER_SEARCH_SELECT,
  });
  if (codeHit) return [toSearchRow(codeHit)];

  const partialHits = await prisma.customer.findMany({
    where: { ...baseWhere(workCountry), OR: partialOrConditions(q) },
    take: limit,
    orderBy: { displayName: "asc" },
    select: CUSTOMER_SEARCH_SELECT,
  });

  if (partialHits.length > 0) {
    return partialHits.map(toSearchRow);
  }

  return searchByNormalizedCodeDigits(q, limit, workCountry);
}
