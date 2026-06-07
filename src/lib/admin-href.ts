import { resolveGlobalCountry } from "@/lib/current-country";

const GLOBAL_FILTER_KEYS = ["week", "from", "to", "country"] as const;

function copyGlobalFilterParams(
  p: URLSearchParams,
  sp: Record<string, string | string[] | undefined>,
): void {
  for (const key of GLOBAL_FILTER_KEYS) {
    const v = sp[key];
    if (typeof v === "string" && v) p.set(key, v);
  }
  if (!p.get("country")) {
    const fromSp = typeof sp.country === "string" ? sp.country : undefined;
    p.set("country", resolveGlobalCountry(fromSp));
  }
}

/** קישורי /admin עם שמירת week/from/to/country מה-searchParams של השרת */
export function adminHrefWithFilters(
  sp: Record<string, string | string[] | undefined>,
  patch: Record<string, string | null | undefined>,
): string {
  const p = new URLSearchParams();
  copyGlobalFilterParams(p, sp);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") p.delete(k);
    else p.set(k, v);
  }
  const qs = p.toString();
  return qs ? `/admin?${qs}` : "/admin";
}

/** קישורי `/admin/orders` עם week/from/to (חלונות קליטה ללא שינוי route). */
export function adminOrdersHrefWithFilters(
  sp: Record<string, string | string[] | undefined>,
  patch: Record<string, string | null | undefined>,
): string {
  const p = new URLSearchParams();
  copyGlobalFilterParams(p, sp);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") p.delete(k);
    else p.set(k, v);
  }
  const qs = p.toString();
  return qs ? `/admin/orders?${qs}` : "/admin/orders";
}

/** קישור לטבלת מקור עם שמירת country (וגם week/from/to אם קיימים). */
export function adminSourceTableHref(
  tableId: string,
  sp: Record<string, string | string[] | undefined>,
  patch: Record<string, string | null | undefined> = {},
): string {
  const p = new URLSearchParams();
  copyGlobalFilterParams(p, sp);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") p.delete(k);
    else p.set(k, v);
  }
  const qs = p.toString();
  const base = `/admin/source-tables/${tableId}`;
  return qs ? `${base}?${qs}` : base;
}
