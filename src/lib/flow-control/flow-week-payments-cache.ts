/**
 * Shared payment fetch for loadFlowWeek + drill — deduped per country+week.
 */

import { prisma } from "@/lib/prisma";
import { cashControlWeekReconciliationPaymentsWhere } from "@/lib/cash-control-week-payments";
import { mergePaymentWhere, type CountryScope } from "@/lib/country-data-scope";

const TTL_MS = 45_000;

export const FLOW_WEEK_PAYMENT_SELECT = {
  id: true,
  paymentCode: true,
  amountIls: true,
  amountUsd: true,
  paymentMethod: true,
  usdPaymentMethod: true,
  ilsPaymentMethod: true,
  exchangeRate: true,
  methodAllocations: { select: { method: true, currency: true, sourceAmount: true } },
  amountWithoutVat: true,
  totalIlsWithoutVat: true,
  totalIlsWithVat: true,
  intakeDate: true,
  paymentDate: true,
  createdAt: true,
  customer: { select: { displayName: true } },
  order: { select: { orderNumber: true } },
} as const;

export type FlowWeekPaymentRow = {
  id: string;
  paymentCode: string | null;
  amountIls: import("@prisma/client").Prisma.Decimal | null;
  amountUsd: import("@prisma/client").Prisma.Decimal | null;
  paymentMethod: string | null;
  usdPaymentMethod: string | null;
  ilsPaymentMethod: string | null;
  exchangeRate: import("@prisma/client").Prisma.Decimal | null;
  methodAllocations: Array<{
    method: string;
    currency: string;
    sourceAmount: import("@prisma/client").Prisma.Decimal;
  }>;
  amountWithoutVat: import("@prisma/client").Prisma.Decimal | null;
  totalIlsWithoutVat: import("@prisma/client").Prisma.Decimal | null;
  totalIlsWithVat: import("@prisma/client").Prisma.Decimal | null;
  intakeDate: Date | null;
  paymentDate: Date | null;
  createdAt: Date;
  customer: { displayName: string | null } | null;
  order: { orderNumber: string | null } | null;
};

type CacheEntry = { promise: Promise<FlowWeekPaymentRow[]>; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function cacheKey(country: string, week: string): string {
  return `${country}:${week.trim()}:payments`;
}

export function getFlowWeekPaymentsCached(
  week: string,
  scope: CountryScope,
): Promise<FlowWeekPaymentRow[]> {
  const wk = week.trim();
  const key = cacheKey(scope.workCountry, wk);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.promise;

  const promise = prisma.payment
    .findMany({
      where: mergePaymentWhere(cashControlWeekReconciliationPaymentsWhere(wk), scope),
      select: FLOW_WEEK_PAYMENT_SELECT,
    })
    .catch((err) => {
      cache.delete(key);
      throw err;
    });

  cache.set(key, { promise, expiresAt: now + TTL_MS });
  return promise;
}

export function invalidateFlowWeekPaymentsCache(week?: string, workCountry?: string): void {
  if (!week && !workCountry) {
    cache.clear();
    return;
  }
  const prefix =
    workCountry && week
      ? cacheKey(workCountry, week)
      : workCountry
        ? `${workCountry}:`
        : week
          ? `:${week.trim()}:payments`
          : "";
  for (const k of [...cache.keys()]) {
    if (!prefix || k.startsWith(prefix) || k.includes(`:${week?.trim()}:`)) cache.delete(k);
  }
}
