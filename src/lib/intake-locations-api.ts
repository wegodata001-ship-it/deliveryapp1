import {
  getIntakeLocationsClientCache,
  setIntakeLocationsClientCache,
} from "@/lib/intake-locations-client-cache";

export type IntakeLocationOption = { id: string; label: string; active?: boolean };

type IntakeLocationApiRow = { id: string; name: string; active: boolean };

export async function fetchIntakeLocationsApi(query: string): Promise<IntakeLocationOption[]> {
  const q = query.trim();
  if (!q) {
    const cached = getIntakeLocationsClientCache();
    if (cached) return cached;
  }
  const sp = new URLSearchParams();
  if (q) {
    sp.set("q", q);
    sp.set("limit", "120");
  }
  const res = await fetch(`/api/intake-locations?${sp.toString()}`, { credentials: "include" });
  if (!res.ok) throw new Error("intake-locations");
  const rows = (await res.json()) as IntakeLocationApiRow[];
  const mapped = rows.map((r) => ({
    id: r.id,
    label: r.name,
    active: r.active !== false,
  }));
  if (!q) setIntakeLocationsClientCache(mapped);
  return mapped;
}

export async function createIntakeLocationApi(name: string): Promise<IntakeLocationOption> {
  const trimmed = name.trim();
  const res = await fetch("/api/intake-locations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name: trimmed }),
  });
  const data = (await res.json().catch(() => null)) as
    | { id?: string; name?: string; active?: boolean; error?: string }
    | null;
  if (!res.ok || !data?.id || !data?.name) {
    throw new Error(data?.error || "שמירת מקום תשלום נכשלה");
  }
  const row = { id: data.id, label: data.name, active: data.active !== false };
  const cached = getIntakeLocationsClientCache() ?? [];
  const map = new Map(cached.map((r) => [r.id, r]));
  map.set(row.id, row);
  setIntakeLocationsClientCache([...map.values()].sort((a, b) => a.label.localeCompare(b.label, "he")));
  return row;
}

export function normalizeLookupKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}
