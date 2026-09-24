/**
 * חוזה פיננסי אחיד — כל מסך חייב להצהיר CURRENT או HISTORICAL.
 * netPosition הוא מידע בלבד; לא מקזז זכות מחוב.
 */
import type { OrderSourceCountry } from "@prisma/client";
import type { CustomerBalanceScope } from "@/lib/customer-balance-calculator";
import { endOfLocalDay, formatLocalYmd, parseLocalDate } from "@/lib/work-week";
import { openDebtScopeForWorkCountry } from "@/lib/customer-open-debt";

export type CustomerFinancialScopeKind = "CURRENT" | "HISTORICAL";

export type CustomerFinancialScope = {
  kind: CustomerFinancialScopeKind;
  /** YYYY-MM-DD — חובה ל-HISTORICAL */
  cutoffYmd?: string | null;
  fromYmd?: string | null;
  sourceCountry?: OrderSourceCountry | null;
  orderStatuses?: string[] | null;
  metrics?: CustomerBalanceScope["metrics"];
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
    sourceCountry: openDebtScopeForWorkCountry(workCountry).sourceCountry ?? null,
  };
}

export function historicalCustomerFinancialScope(input: {
  cutoffYmd: string;
  fromYmd?: string | null;
  sourceCountry?: OrderSourceCountry | null;
  orderStatuses?: string[] | null;
  metrics?: CustomerBalanceScope["metrics"];
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

export function informationalNetPositionUsd(openDebtUsd: number, availableCreditUsd: number): number {
  const debt = Number.isFinite(openDebtUsd) ? openDebtUsd : 0;
  const credit = Number.isFinite(availableCreditUsd) ? availableCreditUsd : 0;
  return Math.round((debt - credit + Number.EPSILON) * 100) / 100;
}

export function isCustomerFinancialScope(
  scope: CustomerFinancialScope | CustomerBalanceScope | null | undefined,
): scope is CustomerFinancialScope {
  return Boolean(scope && typeof scope === "object" && "kind" in scope);
}

/** המרת חוזה פיננסי ל-scope של מנוע החישוב (אותם כללים). */
export function toCustomerBalanceCalcScope(scope: CustomerFinancialScope): CustomerBalanceScope {
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
  scope?: CustomerFinancialScope | CustomerBalanceScope | null,
): { financial: CustomerFinancialScope; calc: CustomerBalanceScope } {
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
