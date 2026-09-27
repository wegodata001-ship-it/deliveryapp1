import type { CustomerBalancesPayload } from "@/app/admin/balances/actions";
import { BALANCES_TIMEOUT_MESSAGE, withTimeout } from "@/lib/balances-list-load";

const TTL_MS = 120_000;
const MAX_ENTRIES = 24;

type CacheEntry = { ts: number; payload: CustomerBalancesPayload };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CustomerBalancesPayload>>();

export type BalancesListCacheQuery = {
  page?: number;
  limit?: number;
  weekCode?: string;
  toYmd?: string;
  fromYmd?: string;
  uptoWeekCode?: string;
  sourceCountry?: string;
  filters?: unknown;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stableValue(v)]),
    );
  }
  return value;
}

/** Key: country + week + filters + page — never reuse another week's payload. */
export function balancesListCacheKey(query: BalancesListCacheQuery): string {
  return JSON.stringify(
    stableValue({
      v: "v4-all-customers",
      page: Math.max(1, Math.floor(query.page || 1)),
      limit: query.limit ?? 25,
      week: query.weekCode?.trim() || "",
      to: query.toYmd?.trim() || "",
      from: query.fromYmd?.trim() || "",
      upto: query.uptoWeekCode?.trim() || "",
      country: query.sourceCountry?.trim() || "",
      filters: query.filters ?? {},
    }),
  );
}

export function getBalancesListCache(key: string): CustomerBalancesPayload | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.payload;
}

export function setBalancesListCache(key: string, payload: CustomerBalancesPayload): void {
  cache.set(key, { ts: Date.now(), payload });
  if (cache.size <= MAX_ENTRIES) return;
  const oldest = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]?.[0];
  if (oldest) cache.delete(oldest);
}

export function invalidateBalancesListCache(): void {
  cache.clear();
  inflight.clear();
}

export function balancesListCacheSize(): number {
  return cache.size;
}

export async function fetchBalancesListCached(
  key: string,
  fetcher: () => Promise<CustomerBalancesPayload>,
  opts?: { skipCache?: boolean; timeoutMs?: number },
): Promise<CustomerBalancesPayload> {
  if (!opts?.skipCache) {
    const hit = getBalancesListCache(key);
    if (hit) return hit;
    const pending = inflight.get(key);
    if (pending) return pending;
  } else {
    inflight.delete(key);
  }

  const work = fetcher().then((payload) => {
    setBalancesListCache(key, payload);
    return payload;
  });
  work.catch(() => {
    /* swallow if the caller already raced out via timeout */
  });

  const pending = (
    opts?.timeoutMs && opts.timeoutMs > 0
      ? withTimeout(work, opts.timeoutMs, BALANCES_TIMEOUT_MESSAGE)
      : work
  ).finally(() => {
    if (inflight.get(key) === pending) inflight.delete(key);
  });
  inflight.set(key, pending);
  return pending;
}
