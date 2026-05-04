import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type CustomerApiSearchRow = {
  id: string;
  customerCode: string | null;
  oldCustomerCode: string | null;
  displayName: string;
  nameHe: string | null;
  nameAr: string | null;
  phone: string | null;
  city: string | null;
  customerType: string | null;
};

const selectApi = {
  id: true,
  customerCode: true,
  oldCustomerCode: true,
  displayName: true,
  nameHe: true,
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
  const q = raw.trim();
  if (!q) return [];

  const base: Prisma.CustomerWhereInput = { isActive: true, deletedAt: null };

  const exactOr: Prisma.CustomerWhereInput[] = [];
  if (UUID_RE.test(q)) {
    exactOr.push({ id: q });
  }
  exactOr.push({ customerCode: { equals: q, mode: "insensitive" } });
  if (q.length >= 2) {
    exactOr.push({ oldCustomerCode: { equals: q, mode: "insensitive" } });
  }

  const exactHits = await prisma.customer.findMany({
    where: { ...base, OR: exactOr },
    take: 50,
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
        { nameAr: { contains: q, mode: "insensitive" } },
      ],
    },
    take: 30,
    orderBy: { displayName: "asc" },
    select: selectApi,
  });

  return partialHits.map(toRow);
}
