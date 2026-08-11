import { Prisma } from "@prisma/client";
import { mergeOrderWhere, resolveCountryScope } from "@/lib/country-data-scope";
import { ORDER_COUNTRY_CODES, type OrderCountryCode } from "@/lib/order-countries";
import { readMultiParam } from "@/lib/orders-list-filter-params";
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

function readMultiOrLegacy(sp: Record<string, string | string[] | undefined>, key: string): string[] {
  const multi = readMultiParam(sp, key);
  if (multi.length > 0) return multi;
  const single = readTextParam(sp, key);
  return single ? [single] : [];
}

function normalizeCountryCodes(values: string[]): OrderCountryCode[] {
  return values.filter((v): v is OrderCountryCode =>
    ORDER_COUNTRY_CODES.includes(v as OrderCountryCode),
  );
}

function buildInOrSingle<T extends string>(
  values: T[],
  field: keyof Prisma.OrderWhereInput,
): Prisma.OrderWhereInput | undefined {
  if (values.length === 0) return undefined;
  if (values.length === 1) return { [field]: values[0] } as Prisma.OrderWhereInput;
  return { [field]: { in: values } } as Prisma.OrderWhereInput;
}

function buildPaymentMethodWhere(values: string[]): Prisma.OrderWhereInput | undefined {
  if (values.length === 0) return undefined;
  const methods = values.filter((v) => v !== "NONE");
  const parts: Prisma.OrderWhereInput[] = [];
  if (methods.length === 1) parts.push({ paymentMethod: methods[0] });
  else if (methods.length > 1) parts.push({ paymentMethod: { in: methods } });
  if (values.includes("NONE")) parts.push({ paymentMethod: null });
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return { OR: parts };
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

  const openOnly = readTextParam(sp, "ordersOpenOnly") === "1";
  const readyOnly = readTextParam(sp, "ordersReadyOnly") === "1";
  const completedFilterRaw = readTextParam(sp, "ordersCompleted");
  const completedFilter =
    completedFilterRaw === "all" || completedFilterRaw === "done" || completedFilterRaw === "not_done"
      ? completedFilterRaw
      : "not_done";

  const statusValues = openOnly
    ? [OS.OPEN]
    : readyOnly
      ? [OS.COMPLETED]
      : readMultiOrLegacy(sp, "status");

  const countryValues = normalizeCountryCodes(readMultiOrLegacy(sp, "ordersCountry"));
  const createdByIds = readMultiOrLegacy(sp, "createdBy");
  const paymentTypes = readMultiOrLegacy(sp, "paymentType");

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

  const statusWhere = buildInOrSingle(statusValues, "status");
  const createdByWhere = buildInOrSingle(createdByIds, "createdById");
  const paymentMethodWhere = buildPaymentMethodWhere(paymentTypes);

  let countryWhere: Prisma.OrderWhereInput | undefined;
  if (countryValues.length === 1) {
    countryWhere = {
      sourceCountry: countryValues[0],
      countryCode: countryScope.workCountry,
    };
  } else if (countryValues.length > 1) {
    countryWhere = {
      sourceCountry: { in: countryValues },
      countryCode: countryScope.workCountry,
    };
  }

  const base: Prisma.OrderWhereInput = {
    deletedAt: null,
    orderDate: { gte: range.fromStart, lte: range.toEnd },
    ...(completedFilter === "done"
      ? { isCompleted: true }
      : completedFilter === "not_done"
        ? { isCompleted: false }
        : {}),
    ...(statusWhere ?? {}),
    ...(countryWhere ?? {}),
    ...(createdByWhere ?? {}),
    ...(paymentMethodWhere ?? {}),
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
