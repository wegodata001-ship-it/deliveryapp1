import { listIntakeLocationsForSelect } from "@/lib/intake-location";

const TTL_MS = 300_000;

let fullListCache: { rows: { id: string; name: string }[]; expires: number } | null = null;
let fullListInFlight: Promise<{ id: string; name: string }[]> | null = null;

/** רשימה מלאה (ללא q) — cache בזיכרון תהליך, ללא DDL חוזר */
export async function listIntakeLocationsForSelectCached(
  query: string,
  limit: number,
): Promise<{ id: string; name: string }[]> {
  const q = query.trim();
  const take = Math.min(500, Math.max(1, Math.floor(limit)));

  if (q) {
    return listIntakeLocationsForSelect(q, take);
  }

  const now = Date.now();
  if (fullListCache && fullListCache.expires > now) {
    return fullListCache.rows.slice(0, take);
  }

  if (fullListInFlight) {
    const rows = await fullListInFlight;
    return rows.slice(0, take);
  }

  fullListInFlight = listIntakeLocationsForSelect("", 500)
    .then((rows) => {
      fullListCache = { rows, expires: Date.now() + TTL_MS };
      fullListInFlight = null;
      return rows;
    })
    .catch((err) => {
      fullListInFlight = null;
      throw err;
    });

  const rows = await fullListInFlight;
  return rows.slice(0, take);
}

export function invalidateIntakeLocationsListCache(): void {
  fullListCache = null;
  fullListInFlight = null;
}
