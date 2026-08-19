/**
 * In-process cache — dedupes loadFlowWeek / payments / expenses / turkey within TTL.
 * Same server instance + concurrent bootstrap requests share one DB round-trip per key.
 */

import type { FlowWeekPayload } from "@/app/admin/cash-flow/flow-types";
import { loadFlowWeek } from "@/app/admin/cash-flow/week-flow-service";
import type { WorkCountryCode } from "@/lib/work-country";
import type { TurkeyTransferMovementDto } from "@/lib/flow-control/turkey-transfer-balance-types";

const TTL_MS = 45_000;

type CacheEntry<T> = { promise: Promise<T>; expiresAt: number };

function cacheKey(country: WorkCountryCode, week: string, suffix = ""): string {
  return `${country}:${week.trim()}${suffix ? `:${suffix}` : ""}`;
}

function getOrSet<T>(map: Map<string, CacheEntry<T>>, key: string, factory: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = map.get(key);
  if (hit && hit.expiresAt > now) return hit.promise;

  const promise = factory().catch((err) => {
    map.delete(key);
    throw err;
  });
  map.set(key, { promise, expiresAt: now + TTL_MS });
  return promise;
}

const flowCache = new Map<string, CacheEntry<FlowWeekPayload | null>>();
const turkeyCache = new Map<string, CacheEntry<TurkeyTransferMovementDto[]>>();

/** loadFlowWeek — cached per country+week */
export function loadFlowWeekCached(
  week: string,
  workCountry: WorkCountryCode,
): Promise<FlowWeekPayload | null> {
  const key = cacheKey(workCountry, week, "flow");
  return getOrSet(flowCache, key, () => loadFlowWeek(week, workCountry));
}

/** Turkey movements up to week — cached */
export async function loadTurkeyMovementsUpToWeekCached(
  weekCode: string,
  countryCode: WorkCountryCode,
): Promise<TurkeyTransferMovementDto[]> {
  const key = cacheKey(countryCode, weekCode, "turkey");
  return getOrSet(turkeyCache, key, async () => {
    const { loadTurkeyMovementsUpToWeek } = await import(
      "@/lib/flow-control/turkey-transfer-balance-service"
    );
    return loadTurkeyMovementsUpToWeek(weekCode, countryCode);
  });
}

export function invalidateFlowWeekLoadCache(week?: string, workCountry?: WorkCountryCode): void {
  if (!week && !workCountry) {
    flowCache.clear();
    turkeyCache.clear();
    void import("@/lib/flow-control/flow-week-payments-cache").then((m) =>
      m.invalidateFlowWeekPaymentsCache(),
    );
    return;
  }
  const prefix = workCountry && week ? cacheKey(workCountry, week) : workCountry ? `${workCountry}:` : week;
  for (const map of [flowCache, turkeyCache]) {
    for (const k of [...map.keys()]) {
      if (!prefix || k.startsWith(prefix)) map.delete(k);
    }
  }
  void import("@/lib/flow-control/flow-week-payments-cache").then((m) =>
    m.invalidateFlowWeekPaymentsCache(week, workCountry),
  );
}
