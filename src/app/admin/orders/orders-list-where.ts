import { PaymentMethod, Prisma } from "@prisma/client";
import { mergeOrderWhere, resolveCountryScope } from "@/lib/country-data-scope";
import { ORDER_COUNTRY_CODES, type OrderCountryCode } from "@/lib/order-countries";
import { OS } from "@/lib/order-status-slugs";
import { parseOrdersListDateFilterFromSearchParams } from "@/lib/work-week";

function readTextParam(sp: Record<string, string | string[] | undefined>, key: string): string {
  const v = sp[key];
  return typeof v === "string" ? v.trim() : "";
}

function parseAmount(raw: string): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** שדה ראשי: לקוח / קוד לקוח (תואם ordersCustomer + פרמטרים ישנים). */
export function resolveOrdersListCustomerQuery(
  sp: Record<string, string | string[] | undefined>,
): string {
  const unified = readTextParam(sp, "ordersCustomer");
  if (unified) return unified;
  const code = readTextParam(sp, "ordersCode");
  const name = readTextParam(sp, "ordersName");
  return code || name || readTextParam(sp, "q");
}

function buildOrdersListCustomerWhereFromSearchParams(
  sp: Record<string, string | string[] | undefined>,
): Prisma.OrderWhereInput | undefined {
  const unified = readTextParam(sp, "ordersCustomer");
  if (unified) return buildOrdersListCustomerWhere(unified);

  const code = readTextParam(sp, "ordersCode");
  const name = readTextParam(sp, "ordersName");
  const legacyQ = readTextParam(sp, "q");
  const parts: Prisma.OrderWhereInput[] = [];
  if (code) {
    const w = buildOrdersListCustomerWhere(code);
    if (w) parts.push(w);
  }
  if (name) {
    const w = buildOrdersListCustomerWhere(name);
    if (w) parts.push(w);
  }
  if (!code && !name && legacyQ) {
    const w = buildOrdersListCustomerWhere(legacyQ);
    if (w) parts.push(w);
  }
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return { AND: parts };
}

export function buildOrdersListCustomerWhere(q: string): Prisma.OrderWhereInput | undefined {
  const t = q.trim();
  if (!t) return undefined;
  return {
    OR: [
      { customerCodeSnapshot: { contains: t, mode: "insensitive" } },
      { customerNameSnapshot: { contains: t, mode: "insensitive" } },
      { customer: { customerCode: { contains: t, mode: "insensitive" } } },
      { customer: { displayName: { contains: t, mode: "insensitive" } } },
      { customer: { nameAr: { contains: t, mode: "insensitive" } } },
      { customer: { nameEn: { contains: t, mode: "insensitive" } } },
    ],
  };
}

function buildOrdersListOrderNumberWhere(orderNum: string): Prisma.OrderWhereInput | undefined {
  const t = orderNum.trim();
  if (!t) return undefined;
  return { orderNumber: { contains: t, mode: "insensitive" } };
}

function buildOrdersListPhoneWhere(phone: string): Prisma.OrderWhereInput | undefined {
  const t = phone.trim();
  if (!t) return undefined;
  return {
    OR: [
      { customer: { phone: { contains: t, mode: "insensitive" } } },
      { customer: { phone2: { contains: t, mode: "insensitive" } } },
    ],
  };
}

/**
 * אותו where כמו ב־`/admin/orders` — לשימוש בדף ובייצוא PDF בשרת.
 */
export function buildOrdersListWhereFromSearchParams(
  sp: Record<string, string | string[] | undefined>,
): Prisma.OrderWhereInput {
  const range = parseOrdersListDateFilterFromSearchParams(sp);
  const countryScope = resolveCountryScope(sp);

  const statusSingleRaw = readTextParam(sp, "status");
  const openOnly = readTextParam(sp, "ordersOpenOnly") === "1";
  const readyOnly = readTextParam(sp, "ordersReadyOnly") === "1";
  const statusSingle = openOnly
    ? OS.OPEN
    : readyOnly
      ? OS.COMPLETED
      : statusSingleRaw || null;

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

  const filterParts: Prisma.OrderWhereInput[] = [];
  const customerWhere = buildOrdersListCustomerWhereFromSearchParams(sp);
  if (customerWhere) filterParts.push(customerWhere);
  const orderNumWhere = buildOrdersListOrderNumberWhere(readTextParam(sp, "ordersOrderNum"));
  if (orderNumWhere) filterParts.push(orderNumWhere);
  const phoneWhere = buildOrdersListPhoneWhere(readTextParam(sp, "ordersPhone"));
  if (phoneWhere) filterParts.push(phoneWhere);

  const base: Prisma.OrderWhereInput = {
    deletedAt: null,
    orderDate: { gte: range.fromStart, lte: range.toEnd },
    ...(statusSingle ? { status: statusSingle } : {}),
    ...(countrySingle ? { sourceCountry: countrySingle, countryCode: countryScope.workCountry } : {}),
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
    ...(filterParts.length > 0 ? { AND: filterParts } : {}),
  };

  return mergeOrderWhere(base, countryScope);
}
