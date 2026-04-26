/** קישורי /admin עם שמירת week/from/to מה-searchParams של השרת */
export function adminHrefWithFilters(
  sp: Record<string, string | string[] | undefined>,
  patch: Record<string, string | null | undefined>,
): string {
  const p = new URLSearchParams();
  for (const key of ["week", "from", "to"] as const) {
    const v = sp[key];
    if (typeof v === "string" && v) p.set(key, v);
  }
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
  for (const key of ["week", "from", "to"] as const) {
    const v = sp[key];
    if (typeof v === "string" && v) p.set(key, v);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") p.delete(k);
    else p.set(k, v);
  }
  const qs = p.toString();
  return qs ? `/admin/orders?${qs}` : "/admin/orders";
}
