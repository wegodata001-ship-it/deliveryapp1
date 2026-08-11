/** פרמטרי סינון מרובי ב-URL (מופרדים בפסיק) — רשימת הזמנות */

export function readMultiParam(
  sp: Record<string, string | string[] | undefined>,
  key: string,
): string[] {
  const raw = sp[key];
  if (Array.isArray(raw)) {
    return [...new Set(raw.flatMap((v) => v.split(",").map((s) => s.trim()).filter(Boolean)))];
  }
  if (typeof raw === "string" && raw.trim()) {
    return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  }
  return [];
}

export function setMultiParam(params: URLSearchParams, key: string, values: string[]) {
  params.delete(key);
  const uniq = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  if (uniq.length > 0) params.set(key, uniq.join(","));
}
