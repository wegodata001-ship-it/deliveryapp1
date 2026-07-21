import type { TableFilterValues } from "@/components/admin/filters/table-filters-types";

const PREFIX = "wego.tableFilters.v1:";

function storageKey(screenKey: string): string {
  return `${PREFIX}${screenKey.trim()}`;
}

export function readTableFilters(screenKey: string): TableFilterValues | null {
  if (typeof window === "undefined" || !screenKey.trim()) return null;
  try {
    const raw = localStorage.getItem(storageKey(screenKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: TableFilterValues = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
      else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
    }
    return out;
  } catch {
    return null;
  }
}

export function writeTableFilters(screenKey: string, values: TableFilterValues): void {
  if (typeof window === "undefined" || !screenKey.trim()) return;
  try {
    const clean: TableFilterValues = {};
    for (const [k, v] of Object.entries(values)) {
      if (v != null && String(v).trim() !== "") clean[k] = String(v);
    }
    localStorage.setItem(storageKey(screenKey), JSON.stringify(clean));
  } catch {
    // ignore quota / private mode
  }
}

export function clearTableFiltersStorage(screenKey: string): void {
  if (typeof window === "undefined" || !screenKey.trim()) return;
  try {
    localStorage.removeItem(storageKey(screenKey));
  } catch {
    // ignore
  }
}

/** מיזוג ברירות מחדל עם ערכים שמורים */
export function mergeTableFilters(
  defaults: TableFilterValues,
  saved: TableFilterValues | null,
): TableFilterValues {
  if (!saved) return { ...defaults };
  return { ...defaults, ...saved };
}
