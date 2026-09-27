/**
 * חוזה פיננסי אחיד — כל מסך חייב להצהיר CURRENT או HISTORICAL.
 * netPosition הוא מידע בלבד; לא מקזז זכות מחוב.
 */
import type { OrderSourceCountry } from "@prisma/client";
import {
  endOfLocalDay,
  formatLocalYmd,
  getAhWeekRange,
  getWeekCodeForLocalDate,
  normalizeAhWeekCode,
  parseLocalDate,
} from "@/lib/work-week";
import {
  DEFAULT_WORK_COUNTRY,
  normalizeWorkCountryCode,
  orderSourceCountryFromWorkCountry,
} from "@/lib/work-country";

/** תואם CustomerBalanceScope — בלי לייבא את מנוע החישוב (server-only). */
export type CustomerFinancialCalcScope = {
  from?: Date | null;
  to?: Date | null;
  sourceCountry?: OrderSourceCountry | null;
  orderStatuses?: string[] | null;
  metrics?: {
    onQuery?: (kind: "orders" | "payments", ms: number) => void;
    onTransform?: (kind: "orders" | "payments", ms: number) => void;
  };
};

export type CustomerFinancialScopeKind = "CURRENT" | "HISTORICAL";

export type CustomerFinancialScope = {
  kind: CustomerFinancialScopeKind;
  /** YYYY-MM-DD — חובה ל-HISTORICAL */
  cutoffYmd?: string | null;
  fromYmd?: string | null;
  sourceCountry?: OrderSourceCountry | null;
  orderStatuses?: string[] | null;
  metrics?: CustomerFinancialCalcScope["metrics"];
};

export function currentCustomerFinancialScope(
  sourceCountry?: OrderSourceCountry | null,
): CustomerFinancialScope {
  return { kind: "CURRENT", sourceCountry: sourceCountry ?? null };
}

export function currentCustomerFinancialScopeForWorkCountry(
  workCountry?: string | null,
): CustomerFinancialScope {
  return {
    kind: "CURRENT",
    sourceCountry: orderSourceCountryFromWorkCountry(
      normalizeWorkCountryCode(workCountry) ?? DEFAULT_WORK_COUNTRY,
    ),
  };
}

export function historicalCustomerFinancialScope(input: {
  cutoffYmd: string;
  fromYmd?: string | null;
  sourceCountry?: OrderSourceCountry | null;
  orderStatuses?: string[] | null;
  metrics?: CustomerFinancialCalcScope["metrics"];
}): CustomerFinancialScope {
  return {
    kind: "HISTORICAL",
    cutoffYmd: input.cutoffYmd.trim(),
    fromYmd: input.fromYmd?.trim() || null,
    sourceCountry: input.sourceCountry ?? null,
    orderStatuses: input.orderStatuses ?? null,
    metrics: input.metrics,
  };
}

export type BalancesWeekFinancialScope = {
  weekCode: string;
  cutoffYmd: string;
  cutoffWeekCode: string;
  financial: CustomerFinancialScope;
};

/**
 * חוזה שבוע יתרות: בחירת AH-N => cutoff שבת של N.
 * שבוע נוכחי/עתידי = CURRENT. שבוע שעבר = HISTORICAL עד 23:59:59 של השבת.
 */
export function resolveBalancesWeekFinancialScope(input: {
  selectedWeekCode: string;
  sourceCountry?: OrderSourceCountry | null;
  orderStatuses?: string[] | null;
  metrics?: CustomerFinancialCalcScope["metrics"];
  now?: Date;
}): BalancesWeekFinancialScope {
  const weekCode = normalizeAhWeekCode(input.selectedWeekCode) ?? "";
  const cutoffYmd = weekCode ? (getAhWeekRange(weekCode)?.to ?? "") : "";
  const now = input.now ?? new Date();
  const today = formatLocalYmd(now);
  const currentWeek = getWeekCodeForLocalDate(now);
  const isLive = !weekCode || !cutoffYmd || cutoffYmd >= today || weekCode === currentWeek;
  const financial = isLive
    ? {
        ...currentCustomerFinancialScope(input.sourceCountry),
        orderStatuses: input.orderStatuses ?? null,
        metrics: input.metrics,
      }
    : historicalCustomerFinancialScope({
        cutoffYmd,
        sourceCountry: input.sourceCountry ?? null,
        orderStatuses: input.orderStatuses ?? null,
        metrics: input.metrics,
      });
  return {
    weekCode,
    cutoffYmd,
    cutoffWeekCode: weekCode,
    financial,
  };
}

export function informationalNetPositionUsd(openDebtUsd: number, availableCreditUsd: number): number {
  const debt = Number.isFinite(openDebtUsd) ? openDebtUsd : 0;
  const credit = Number.isFinite(availableCreditUsd) ? availableCreditUsd : 0;
  return Math.round((debt - credit + Number.EPSILON) * 100) / 100;
}

export function isCustomerFinancialScope(
  scope: CustomerFinancialScope | CustomerFinancialCalcScope | null | undefined,
): scope is CustomerFinancialScope {
  return Boolean(scope && typeof scope === "object" && "kind" in scope);
}

/** המרת חוזה פיננסי ל-scope של מנוע החישוב (אותם כללים). */
export function toCustomerBalanceCalcScope(scope: CustomerFinancialScope): CustomerFinancialCalcScope {
  if (scope.kind === "CURRENT") {
    return {
      sourceCountry: scope.sourceCountry ?? null,
      orderStatuses: scope.orderStatuses ?? null,
      metrics: scope.metrics,
    };
  }
  const cutoff = (scope.cutoffYmd ?? "").trim();
  const from = (scope.fromYmd ?? "").trim();
  return {
    from: from ? parseLocalDate(from) : null,
    to: cutoff ? endOfLocalDay(cutoff) : null,
    sourceCountry: scope.sourceCountry ?? null,
    orderStatuses: scope.orderStatuses ?? null,
    metrics: scope.metrics,
  };
}

/**
 * קלט ציבורי: חוזה מפורש, או legacy calc-scope.
 * `to` בלי kind → HISTORICAL. בלי תאריך → CURRENT.
 */
export function normalizeCustomerAccountBalanceQuery(
  scope?: CustomerFinancialScope | CustomerFinancialCalcScope | null,
): { financial: CustomerFinancialScope; calc: CustomerFinancialCalcScope } {
  if (!scope) {
    const financial = currentCustomerFinancialScope();
    return { financial, calc: toCustomerBalanceCalcScope(financial) };
  }
  if (isCustomerFinancialScope(scope)) {
    return { financial: scope, calc: toCustomerBalanceCalcScope(scope) };
  }
  const toYmd = scope.to ? formatLocalYmd(scope.to) : "";
  const fromYmd = scope.from ? formatLocalYmd(scope.from) : "";
  const looksUnbounded = Boolean(scope.to && scope.to.getFullYear() >= 2900);
  const financial: CustomerFinancialScope =
    toYmd && !looksUnbounded
      ? historicalCustomerFinancialScope({
          cutoffYmd: toYmd,
          fromYmd: fromYmd || null,
          sourceCountry: scope.sourceCountry ?? null,
          orderStatuses: scope.orderStatuses ?? null,
          metrics: scope.metrics,
        })
      : {
          kind: "CURRENT",
          sourceCountry: scope.sourceCountry ?? null,
          orderStatuses: scope.orderStatuses ?? null,
          metrics: scope.metrics,
        };
  return { financial, calc: scope };
}
