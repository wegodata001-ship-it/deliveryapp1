import type { CustomerCardSnapshot } from "@/app/admin/capture/actions";

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { expires: number; data: CustomerCardSnapshot | null }>();

function readCache(id: string): CustomerCardSnapshot | null | undefined {
  const hit = cache.get(id);
  if (!hit) return undefined;
  if (Date.now() > hit.expires) {
    cache.delete(id);
    return undefined;
  }
  return hit.data;
}

export function invalidateCustomerCardSnapshotClient(id: string): void {
  cache.delete(id.trim());
}

export async function fetchCustomerCardSnapshotClient(
  customerId: string,
  opts?: { signal?: AbortSignal },
): Promise<CustomerCardSnapshot | null> {
  const id = customerId.trim();
  if (!id) return null;

  const cached = readCache(id);
  if (cached !== undefined) return cached;

  const res = await fetch(`/api/customers/card-snapshot?id=${encodeURIComponent(id)}`, {
    credentials: "include",
    signal: opts?.signal,
  });
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) throw new Error("טעינת כרטסת נכשלה");

  const row = (await res.json()) as CustomerCardSnapshot | null;
  cache.set(id, { expires: Date.now() + CACHE_TTL_MS, data: row });
  return row;
}
