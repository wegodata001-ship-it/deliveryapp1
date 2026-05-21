import { PaymentMethod, Prisma } from "@prisma/client";
import { ORDER_COUNTRY_CODES, orderCountryCodesMatchingHeSearch, type OrderCountryCode } from "@/lib/order-countries";
import { normalizeAhWeekCode, parseOrdersListDateFilterFromSearchParams } from "@/lib/work-week";


function readTextParam(sp: Record<string, string | string[] | undefined>, key: string): string {
  const v = sp[key];
  return typeof v === "string" ? v.trim() : "";
}

function parseAmount(raw: string): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function buildOrdersListSearchWhere(q: string): Prisma.OrderWhereInput | undefined {
  const t = q.trim();
  if (!t) return undefined;
  const amt = parseAmount(t);
  const countryHits = orderCountryCodesMatchingHeSearch(t);
  const compactAh = t.replace(/\s+/g, "").toUpperCase();
  const bareWeek = /^AH-\d{1,6}$/i.test(compactAh) ? normalizeAhWeekCode(compactAh) : null;

  const ors: Prisma.OrderWhereInput[] = [
    { orderNumber: { contains: t, mode: "insensitive" } },
    { customerCodeSnapshot: { contains: t, mode: "insensitive" } },
    { customerNameSnapshot: { contains: t, mode: "insensitive" } },
    { createdBy: { fullName: { contains: t, mode: "insensitive" } } },
    { createdBy: { username: { contains: t, mode: "insensitive" } } },
    { weekCode: { contains: t, mode: "insensitive" } },
    { customer: { phone: { contains: t, mode: "insensitive" } } },
    { customer: { phone2: { contains: t, mode: "insensitive" } } },
    { customer: { country: { contains: t, mode: "insensitive" } } },
  ];
  if (countryHits.length > 0) {
    ors.push({ sourceCountry: { in: countryHits } });
  }
  if (bareWeek) {
    ors.push({ weekCode: { equals: bareWeek, mode: "insensitive" } });
  }
  if (amt != null) {
    const d = new Prisma.Decimal(amt);
    ors.push(
      { amountUsd: { equals: d } },
      { commissionUsd: { equals: d } },
      { totalUsd: { equals: d } },
    );
  }
  return { OR: ors };
}

/**
 * אותו where כמו ב־`/admin/orders` — לשימוש בדף ובייצוא PDF בשרת.
 */
export function buildOrdersListWhereFromSearchParams(
  sp: Record<string, string | string[] | undefined>,
): Prisma.OrderWhereInput {
  const range = parseOrdersListDateFilterFromSearchParams(sp);

  const q = readTextParam(sp, "q");
  const statusSingleRaw = readTextParam(sp, "status");
  const statusSingle = statusSingleRaw || null;

  const ordersCountryRaw = readTextParam(sp, "ordersCountry");
  const countrySingle =
    ordersCountryRaw && ORDER_COUNTRY_CODES.includes(ordersCountryRaw as OrderCountryCode)
      ? (ordersCountryRaw as OrderCountryCode)
      : null;

  const createdById = readTextParam(sp, "createdBy");
  const rawPaymentType = readTextParam(sp, "paymentType");
  const paymentType =
    rawPaymentType === "NONE"
      ? rawPaymentType
      : Object.values(PaymentMethod).includes(rawPaymentType as PaymentMethod)
        ? (rawPaymentType as PaymentMethod)
        : "";
  const paymentLocationRaw = readTextParam(sp, "paymentLocation");
  const amountMinRaw = readTextParam(sp, "amountMin");
  const amountMaxRaw = readTextParam(sp, "amountMax");
  const amountMin = parseAmount(amountMinRaw);
  const amountMax = parseAmount(amountMaxRaw);

  const searchWhere = buildOrdersListSearchWhere(q);

  return {
    deletedAt: null,
    orderDate: { gte: range.fromStart, lte: range.toEnd },
    ...(statusSingle ? { status: statusSingle } : {}),
    ...(countrySingle ? { sourceCountry: countrySingle } : {}),
    ...(createdById ? { createdById } : {}),
    ...(paymentType === "NONE"
      ? { paymentMethod: null }
      : paymentType
        ? { paymentMethod: paymentType as PaymentMethod }
        : {}),
    ...(paymentLocationRaw === "NONE"
      ? { AND: [{ paymentPointId: null }, { locationId: null }] }
      : paymentLocationRaw
        ? { OR: [{ paymentPointId: paymentLocationRaw }, { locationId: paymentLocationRaw }] }
        : {}),
    ...(amountMin != null || amountMax != null
      ? {
          amountUsd: {
            ...(amountMin != null ? { gte: new Prisma.Decimal(amountMin) } : {}),
            ...(amountMax != null ? { lte: new Prisma.Decimal(amountMax) } : {}),
          },
        }
      : {}),
    ...(searchWhere ? searchWhere : {}),
  };
}
