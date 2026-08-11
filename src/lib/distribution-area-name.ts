/**
 * אזור חלוקה — שם חופשי ב-Unicode (עברית / ערבית / אנגלית).
 * אין הסקה לפי מילות כיוון. Normalization רק לחיפוש ומניעת כפילויות — לא לתצוגה.
 */

const BLOCKED_AREA_HEADERS = new Set([
  "אזור חלוקה",
  "מקום מסירה",
  "מקום מסירה מעודכן",
  "מקומות מסירה",
  "דרך",
  "במשרד",
  "יתרת פתיחה",
  "distribution area",
  "zone",
  "area",
]);

/** ניקוי Unicode בלבד — לא מסיר תווים בערבית/עברית */
export function sanitizeDistributionAreaInput(name: string | null | undefined): string {
  if (!name) return "";
  return String(name).normalize("NFKC").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function isBlockedDistributionAreaHeader(name: string | null | undefined): boolean {
  const t = sanitizeDistributionAreaInput(name);
  if (!t) return false;
  return BLOCKED_AREA_HEADERS.has(t) || BLOCKED_AREA_HEADERS.has(t.toLowerCase());
}

/** הודעת validation ל-UI/API — null = תקין */
export function distributionAreaValidationError(name: string | null | undefined): string | null {
  const t = sanitizeDistributionAreaInput(name);
  if (!t) return "שם אזור חובה";
  if (t.length < 2) return "שם אזור קצר מדי (לפחות 2 תווים)";
  if (isBlockedDistributionAreaHeader(t)) return "שם שמור למערכת — בחרו שם אחר";
  return null;
}

/** שם לשמירה/תצוגה — Unicode מנוקה, ללא שינוי משמעות */
export function sanitizeDistributionAreaName(name: string | null | undefined): string | null {
  if (distributionAreaValidationError(name)) return null;
  return sanitizeDistributionAreaInput(name);
}

/** מפתח לחיפוש והתאמה — לא לתצוגה */
export function distributionAreaLookupKey(name: string | null | undefined): string {
  const t = sanitizeDistributionAreaInput(name);
  if (!t) return "";
  return t.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("und");
}

/** @deprecated — השתמשו ב-sanitizeDistributionAreaName */
export function normalizeDistributionAreaName(name: string | null | undefined): string | null {
  return sanitizeDistributionAreaName(name);
}

export function isValidDistributionAreaName(name: string | null | undefined): boolean {
  return sanitizeDistributionAreaName(name) != null;
}

/** @deprecated — alias ל-isValidDistributionAreaName */
export function looksLikeDistributionArea(name: string | null | undefined): boolean {
  return isValidDistributionAreaName(name);
}

export function isValidLocalityDisplayName(name: string | null | undefined): boolean {
  const t = sanitizeDistributionAreaInput(name);
  if (!t) return false;
  if (/^\d+$/.test(t)) return false;
  if (isBlockedDistributionAreaHeader(t)) return false;
  return t.length >= 2;
}

/** @deprecated — alias ל-isValidLocalityDisplayName */
export function looksLikeLocalityName(name: string | null | undefined): boolean {
  return isValidLocalityDisplayName(name);
}

/** חיפוש Unicode — תומך בערבית/עברית/אנגלית */
export function distributionAreaNameMatchesQuery(
  areaName: string,
  query: string,
): boolean {
  const q = query.trim();
  if (!q) return true;
  if (areaName.includes(q)) return true;
  const key = distributionAreaLookupKey(areaName);
  const qKey = distributionAreaLookupKey(q);
  return Boolean(qKey && key.includes(qKey));
}
