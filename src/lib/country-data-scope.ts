import type { OrderSourceCountry, Prisma } from "@prisma/client";
import {
  DEFAULT_WORK_COUNTRY,
  normalizeWorkCountryCode,
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
  const wc = normalizeWorkCountryCode(workCountry != null ? String(workCountry) : null) ?? DEFAULT_WORK_COUNTRY;
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

/** לקוח — סביבת עבודה (TR / CN / AE) */
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

/** CashWeekFlow / CashDailyDrawerCount / CashCount — scope by work country + week */
export function cashWeekFlowWhere(scope: CountryScope, weekCode: string): Prisma.CashWeekFlowWhereUniqueInput {
  return {
    countryCode_weekCode: {
      countryCode: scope.workCountry,
      weekCode: weekCode.trim(),
    },
  };
}

export function cashWeekFlowRowWhere(
  scope: CountryScope,
  weekCode: string,
): Pick<Prisma.CashWeekFlowWhereInput, "countryCode" | "weekCode"> {
  return { countryCode: scope.workCountry, weekCode: weekCode.trim() };
}

export function cashDrawerCountWhere(
  scope: CountryScope,
  weekCode: string,
): Prisma.CashDailyDrawerCountWhereInput {
  return { countryCode: scope.workCountry, weekCode: weekCode.trim() };
}

export function cashExpenseWhereForCountryScope(
  scope: CountryScope,
): Pick<Prisma.CashExpenseWhereInput, "countryCode"> {
  return { countryCode: scope.workCountry };
}

/** Server write guard — reject cross-country payloads */
export function assertWriteCountryScope(
  active: WorkCountryCode,
  requested: WorkCountryCode | string | null | undefined,
): void {
  const req = normalizeWorkCountryCode(requested != null ? String(requested) : null);
  if (req && req !== active) {
    throw new Error(`פעולה לא שייכת למדינה הפעילה (${active}, התקבל ${req})`);
  }
}

export function resolveWorkCountryParam(
  workCountry: WorkCountryCode | string | null | undefined,
): WorkCountryCode {
  return normalizeWorkCountryCode(workCountry != null ? String(workCountry) : null) ?? DEFAULT_WORK_COUNTRY;
}
