import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_WORK_COUNTRY, normalizeWorkCountryCode, type WorkCountryCode } from "@/lib/work-country";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import type { CustomerSearchRow } from "@/app/admin/capture/actions";
import {
  CUSTOMER_SEARCH_UUID_RE,
  customerSearchQueryAllowed,
  normalizeCustomerCodeDigits,
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

function baseWhere(workCountry?: string | null, countryScoped = true): Prisma.CustomerWhereInput {
  const where: Prisma.CustomerWhereInput = {
    isActive: true,
    deletedAt: null,
  };
  if (countryScoped) {
    where.countryCode = resolveSearchWorkCountry(workCountry);
  }
  return where;
}

function logFoundCustomer(row: CustomerSearchRow): void {
  console.log("FOUND CUSTOMER:", {
    id: row.id,
    customerCode: row.code,
    externalCode: row.oldCustomerCode,
    name: row.label,
    country: row.countryCode,
  });
}

function exactCodeEqualsConditions(q: string): Prisma.CustomerWhereInput[] {
  const variants = new Set<string>([q]);
  const digitsNorm = normalizeCustomerCodeDigits(q);
  if (digitsNorm && digitsNorm !== q) variants.add(digitsNorm);
  if (/^\d+$/.test(digitsNorm)) {
    variants.add(digitsNorm.padStart(3, "0"));
    variants.add(digitsNorm.padStart(4, "0"));
    variants.add(digitsNorm.padStart(5, "0"));
    variants.add(digitsNorm.padStart(6, "0"));
  }
  const or: Prisma.CustomerWhereInput[] = [];
  for (const v of variants) {
    or.push({ customerCode: { equals: v, mode: "insensitive" } });
    or.push({ oldCustomerCode: { equals: v, mode: "insensitive" } });
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
  const digitsNorm = normalizeCustomerCodeDigits(q);
  if (digitsNorm && digitsNorm !== q) {
    or.push({ customerCode: { contains: digitsNorm, mode: "insensitive" } });
    or.push({ oldCustomerCode: { contains: digitsNorm, mode: "insensitive" } });
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
  const stripped = normalizeCustomerCodeDigits(q);
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

async function findExactCustomerRow(
  q: string,
  workCountry?: string | null,
  countryScoped = true,
): Promise<CustomerSearchDbRow | null> {
  if (CUSTOMER_SEARCH_UUID_RE.test(q)) {
    return prisma.customer.findFirst({
      where: { ...baseWhere(workCountry, countryScoped), id: q },
      select: CUSTOMER_SEARCH_SELECT,
    });
  }

  return prisma.customer.findFirst({
    where: {
      ...baseWhere(workCountry, countryScoped),
      OR: exactCodeEqualsConditions(q),
    },
    select: CUSTOMER_SEARCH_SELECT,
  });
}

async function findPartialCustomers(
  q: string,
  limit: number,
  workCountry?: string | null,
): Promise<CustomerSearchRow[]> {
  const partialHits = await prisma.customer.findMany({
    where: { ...baseWhere(workCountry), OR: partialOrConditions(q) },
    take: limit,
    orderBy: { displayName: "asc" },
    select: CUSTOMER_SEARCH_SELECT,
  });
  return partialHits.map(toSearchRow);
}

/**
 * exact=1 — customerCode + oldCustomerCode (external) + UUID.
 * Fallback: contains → cross-country exact → normalized digits.
 */
async function searchCustomersExact(
  q: string,
  workCountry?: string | null,
  limit = 1,
): Promise<CustomerSearchRow[]> {
  const country = resolveSearchWorkCountry(workCountry);
  console.log({ q, country, exact: true });

  let row = await findExactCustomerRow(q, workCountry, true);
  if (row) {
    const mapped = toSearchRow(row);
    console.log({ customersFound: 1 });
    logFoundCustomer(mapped);
    return [mapped];
  }

  const partial = await findPartialCustomers(q, Math.max(limit, 5), workCountry);
  if (partial.length > 0) {
    console.log({ customersFound: partial.length, fallback: "contains" });
    logFoundCustomer(partial[0]!);
    return partial.slice(0, limit);
  }

  row = await findExactCustomerRow(q, workCountry, false);
  if (row) {
    const mapped = toSearchRow(row);
    console.log({
      customersFound: 1,
      fallback: "cross-country",
      requestedCountry: country,
      foundCountry: mapped.countryCode,
    });
    logFoundCustomer(mapped);
    return [mapped];
  }

  const digitHits = await searchByNormalizedCodeDigits(q, limit, workCountry);
  console.log({ customersFound: digitHits.length, fallback: digitHits.length ? "digits" : "none" });
  if (digitHits[0]) logFoundCustomer(digitHits[0]);
  return digitHits.slice(0, limit);
}

export type CustomerPrismaSearchOptions = {
  limit?: number;
  exactOnly?: boolean;
  /** TR / CN / AE — חובה לסינון סביבה */
  workCountry?: string | null;
};

/**
 * חיפוש לקוחות — exact=1: קוד מדויק + fallback; אחרת התאמת קוד ואז חלקי.
 */
export async function searchCustomersPrisma(
  raw: string | number | null | undefined,
  opts?: CustomerPrismaSearchOptions,
): Promise<CustomerSearchRow[]> {
  const q = normalizeCustomerSearchQuery(raw);
  const limit = Math.min(50, Math.max(5, Math.floor(opts?.limit ?? 20)));
  const exactOnly = opts?.exactOnly === true;
  const workCountry = opts?.workCountry;
  const country = resolveSearchWorkCountry(workCountry);

  if (!customerSearchQueryAllowed(q, exactOnly)) return [];

  if (exactOnly) {
    return searchCustomersExact(q, workCountry, limit);
  }

  console.log({ q, country, exact: false });

  const codeHit = await findExactCustomerRow(q, workCountry, true);
  if (codeHit) {
    const mapped = toSearchRow(codeHit);
    console.log({ customersFound: 1 });
    logFoundCustomer(mapped);
    return [mapped];
  }

  const partialHits = await findPartialCustomers(q, limit, workCountry);
  if (partialHits.length > 0) {
    console.log({ customersFound: partialHits.length });
    logFoundCustomer(partialHits[0]!);
    return partialHits;
  }

  const digitHits = await searchByNormalizedCodeDigits(q, limit, workCountry);
  console.log({ customersFound: digitHits.length });
  if (digitHits[0]) logFoundCustomer(digitHits[0]);
  return digitHits;
}
