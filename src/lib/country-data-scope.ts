import type { OrderSourceCountry, Prisma } from "@prisma/client";
import {
  DEFAULT_WORK_COUNTRY,
  orderSourceCountryFromWorkCountry,
  resolveWorkCountryFromSearchParams,
  type WorkCountryCode,
} from "@/lib/work-country";

export type CountryScope = {
  workCountry: WorkCountryCode;
  sourceCountry: OrderSourceCountry;
};

export function resolveCountryScope(
  sp: URLSearchParams | Record<string, string | string[] | undefined>,
): CountryScope {
  const workCountry = resolveWorkCountryFromSearchParams(sp);
  return {
    workCountry,
    sourceCountry: orderSourceCountryFromWorkCountry(workCountry),
  };
}

export function resolveCountryScopeFromCode(
  workCountry: WorkCountryCode | string | null | undefined,
): CountryScope {
  const w =
    typeof workCountry === "string" && workCountry.length === 2
      ? (workCountry.toUpperCase() as WorkCountryCode)
      : DEFAULT_WORK_COUNTRY;
  const wc = ["TR", "CN", "AE", "JO"].includes(w) ? (w as WorkCountryCode) : DEFAULT_WORK_COUNTRY;
  return {
    workCountry: wc,
    sourceCountry: orderSourceCountryFromWorkCountry(wc),
  };
}

/** סינון הזמנות — אין ערבוב בין מדינות */
export function orderWhereForCountryScope(scope: CountryScope): Prisma.OrderWhereInput {
  return {
    countryCode: scope.workCountry,
    sourceCountry: scope.sourceCountry,
  };
}

export function paymentWhereForCountryScope(scope: CountryScope): Prisma.PaymentWhereInput {
  return { countryCode: scope.workCountry };
}

export function customerWhereForCountryScope(scope: CountryScope): Prisma.CustomerWhereInput {
  return { countryCode: scope.workCountry };
}

export function mergeOrderWhere(
  base: Prisma.OrderWhereInput,
  scope: CountryScope,
): Prisma.OrderWhereInput {
  const countryPart = orderWhereForCountryScope(scope);
  if (base.AND) {
    const and = Array.isArray(base.AND) ? base.AND : [base.AND];
    return { ...base, AND: [...and, countryPart] };
  }
  return { ...base, ...countryPart };
}

export function mergePaymentWhere(
  base: Prisma.PaymentWhereInput,
  scope: CountryScope,
): Prisma.PaymentWhereInput {
  const countryPart = paymentWhereForCountryScope(scope);
  if (base.AND) {
    const and = Array.isArray(base.AND) ? base.AND : [base.AND];
    return { ...base, AND: [...and, countryPart] };
  }
  return { ...base, ...countryPart };
}

export function mergeCustomerWhere(
  base: Prisma.CustomerWhereInput,
  scope: CountryScope,
): Prisma.CustomerWhereInput {
  const countryPart = customerWhereForCountryScope(scope);
  if (base.AND) {
    const and = Array.isArray(base.AND) ? base.AND : [base.AND];
    return { ...base, AND: [...and, countryPart] };
  }
  return { ...base, ...countryPart };
}
