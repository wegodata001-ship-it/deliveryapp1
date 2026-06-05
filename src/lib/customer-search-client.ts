import type { CustomerSearchRow } from "@/app/admin/capture/actions";
import { CUSTOMER_SEARCH_UUID_RE } from "@/lib/customer-search-shared";

export const CUSTOMER_SEARCH_DEBOUNCE_MS = 200;
export const CUSTOMER_CODE_SEARCH_DEBOUNCE_MS = 150;
export const CUSTOMER_NAME_SEARCH_DEBOUNCE_MS = 220;
export const CUSTOMER_SEARCH_CACHE_TTL_MS = 30_000;

type CacheEntry = { expires: number; data: CustomerSearchRow[] };

const cache = new Map<string, CacheEntry>();
let activeAbort: AbortController | null = null;

function cacheKey(q: string, exact: boolean, workCountry?: string | null): string {
  const wc = (workCountry ?? "").trim().toUpperCase() || "TR";
  return `${wc}|${exact ? "e:" : "s:"}${q.toLowerCase()}`;
}

function readCache(key: string): CustomerSearchRow[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function writeCache(key: string, rows: CustomerSearchRow[]): void {
  cache.set(key, { expires: Date.now() + CUSTOMER_SEARCH_CACHE_TTL_MS, data: rows });
}

export function cancelCustomerSearch(): void {
  activeAbort?.abort();
  activeAbort = null;
}

/** אחרי יצירת לקוח — מנע תוצאות חיפוש ישנות בלי הלקוח החדש */
export function invalidateCustomerSearchClientCache(): void {
  cache.clear();
}

export function customerSearchMinQueryLength(q: string, exact = false): boolean {
  const t = q.trim();
  if (!t) return false;
  if (CUSTOMER_SEARCH_UUID_RE.test(t)) return true;
  if (exact && /^\d+$/.test(t)) return t.length >= 1;
  return t.length >= 2;
}

async function fetchSearchFast(
  q: string,
  opts: { exact?: boolean; signal?: AbortSignal; workCountry?: string | null },
): Promise<CustomerSearchRow[]> {
  const key = cacheKey(q, !!opts.exact, opts.workCountry);
  const cached = readCache(key);
  if (cached) return cached;

  let signal = opts.signal;
  if (!signal) {
    activeAbort?.abort();
    const ac = new AbortController();
    activeAbort = ac;
    signal = ac.signal;
  }

  const params = new URLSearchParams({ q });
  if (opts.exact) params.set("exact", "1");
  if (opts.workCountry?.trim()) params.set("country", opts.workCountry.trim());

  const useConsoleTimer = typeof console !== "undefined" && typeof console.time === "function";
  if (useConsoleTimer) console.time("customer-search");

  try {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const res = await fetch(`/api/customers/search-fast?${params.toString()}`, {
      credentials: "include",
      cache: "no-store",
      signal,
    });
    const fetchMs = Math.round(
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0,
    );

    if (typeof window !== "undefined" && (process.env.NODE_ENV === "development" || fetchMs > 300)) {
      console.log("[searchFast.client]", {
        q,
        exact: !!opts.exact,
        status: res.status,
        fetchMs,
        hint: fetchMs > 300 ? "Check Network: waiting=TTFB/server; content=JSON parse" : undefined,
      });
    }

    if (res.status === 401) throw new Error("Unauthorized");
    if (!res.ok) throw new Error("טעינת נתונים נכשלה");

    let rows: CustomerSearchRow[];
    if (opts.exact) {
      const row = (await res.json()) as CustomerSearchRow | null;
      rows = row ? [row] : [];
    } else {
      rows = (await res.json()) as CustomerSearchRow[];
    }

    if (rows.length > 0) writeCache(key, rows);
    return rows;
  } finally {
    if (useConsoleTimer) console.timeEnd("customer-search");
  }
}

export async function searchCustomersFastClient(
  query: string,
  opts?: { signal?: AbortSignal; workCountry?: string | null },
): Promise<CustomerSearchRow[]> {
  const q = query.trim();
  if (!customerSearchMinQueryLength(q)) return [];
  return fetchSearchFast(q, { signal: opts?.signal, workCountry: opts?.workCountry });
}

/** חיפוש מדויק לפי קוד — exact=1 בלבד (שדה קוד במסך קליטת תשלום) */
export async function searchCustomerCodeExactClient(
  query: string,
  opts?: { signal?: AbortSignal; workCountry?: string | null },
): Promise<CustomerSearchRow[]> {
  const q = query.trim();
  if (!customerSearchMinQueryLength(q, true)) return [];
  return fetchSearchFast(q, { exact: true, signal: opts?.signal, workCountry: opts?.workCountry });
}

export async function resolveCustomerFastClient(
  query: string,
  opts?: { signal?: AbortSignal; workCountry?: string | null },
): Promise<CustomerSearchRow | null> {
  const q = query.trim();
  if (!customerSearchMinQueryLength(q, true)) return null;
  const rows = await fetchSearchFast(q, {
    exact: true,
    signal: opts?.signal,
    workCountry: opts?.workCountry,
  });
  if (rows.length > 0) return rows[0]!;
  if (CUSTOMER_SEARCH_UUID_RE.test(q)) return null;
  const partial = await fetchSearchFast(q, {
    signal: opts?.signal,
    workCountry: opts?.workCountry,
  });
  if (partial.length === 0) return null;
  const lower = q.toLowerCase();
  return (
    partial.find((h) => (h.code ?? "").trim().toLowerCase() === lower) ??
    partial.find((h) => (h.oldCustomerCode ?? "").trim().toLowerCase() === lower) ??
    partial.find((h) => h.label.trim().toLowerCase() === lower) ??
    (partial.length === 1 ? partial[0]! : null)
  );
}

/** בחירה אוטומטית כשיש תוצאה יחידה או התאמת קוד מדויקת */
export function pickAutoCustomerHit(
  rows: CustomerSearchRow[],
  query: string,
): CustomerSearchRow | null {
  const q = query.trim();
  if (!q) return null;
  if (rows.length === 1) return rows[0]!;
  const lower = q.toLowerCase();
  const exactCode = rows.find((r) => (r.code ?? "").trim().toLowerCase() === lower);
  if (exactCode) return exactCode;
  const exactIndex = rows.find((r) => (r.oldCustomerCode ?? "").trim().toLowerCase() === lower);
  if (exactIndex) return exactIndex;
  if (rows.length === 1 && CUSTOMER_SEARCH_UUID_RE.test(q) && rows[0]!.id === q) return rows[0]!;
  return null;
}
