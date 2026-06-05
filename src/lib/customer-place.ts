/** הצעות למקום לקוח — נשמר ב-DB בשדה country (טקסט חופשי מותר) */
export const CUSTOMER_PLACE_PLACEHOLDER = "בחר או רשום מקום...";

/** מדינות, ערים ואזורים נפוצים — לא מגביל את מה שניתן להקליד */
export const CUSTOMER_PLACE_SUGGESTIONS: readonly string[] = [
  "ישראל",
  "טורקיה",
  "סין",
  "ארה״ב",
  "USA",
  "מצרים",
  "איחוד האמירויות",
  "דובאי",
  "גרמניה",
  "Berlin",
  "איטליה",
  "ספרד",
  "צרפת",
  "יוון",
  "איסטנבול",
  "עזה",
  "רמאללה",
  "נצרת",
  "חיפה",
  "תל אביב",
  "ירושלים",
];

export function normalizeCustomerPlaceInput(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  return t || null;
}

export function filterCustomerPlaceSuggestions(query: string, limit = 14): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...CUSTOMER_PLACE_SUGGESTIONS].slice(0, limit);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of CUSTOMER_PLACE_SUGGESTIONS) {
    if (p.toLowerCase().includes(q)) {
      const key = p.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(p);
      }
    }
    if (out.length >= limit) break;
  }
  return out;
}

/** @deprecated — שימוש ב-customer-place */
export const DEFAULT_CUSTOMER_COUNTRY = "ישראל";
export function normalizeCustomerCountryInput(raw: string | null | undefined): string | null {
  return normalizeCustomerPlaceInput(raw);
}
