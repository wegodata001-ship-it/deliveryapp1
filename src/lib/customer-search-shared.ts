/** Pure helpers/constants shared by client search and server Prisma search — no DB imports. */

export const CUSTOMER_SEARCH_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeCustomerSearchQuery(raw: string): string {
  return raw.trim();
}

/** מינימום תווים לחיפוש חלקי — קוד מספרי בודד מותר בזיהוי מדויק (Enter) */
export function customerSearchQueryAllowed(q: string, exactOnly = false): boolean {
  if (!q) return false;
  if (CUSTOMER_SEARCH_UUID_RE.test(q)) return true;
  if (exactOnly && /^\d+$/.test(q)) return q.length >= 1;
  return q.length >= 2;
}
