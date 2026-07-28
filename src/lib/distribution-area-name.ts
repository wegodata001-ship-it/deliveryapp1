/**
 * זיהוי אזור חלוקה אמיתי מול שם יישוב.
 * אזור: "צפון 16", "דרום 1", "מרכז 11", "משולש 5"
 * גם צורה הפוכה מ־Excel/RTL: "1 דרום", "16 צפון"
 */

const WORD = "צפון|דרום|מרכז|משולש|שרון|גולן|ירושלים|חיפה|נגב|עמק|גליל|north|south|center|triangle";

/** מנרמל לצורת תצוגה אחידה: "דרום 1" */
export function normalizeDistributionAreaName(
  name: string | null | undefined,
): string | null {
  const t = (name ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;

  let m = t.match(new RegExp(`^(${WORD})\\s*[-_]?\\s*(\\d+)$`, "i"));
  if (m) return `${m[1]} ${m[2]}`;

  m = t.match(new RegExp(`^(\\d+)\\s*[-_]?\\s*(${WORD})$`, "i"));
  if (m) return `${m[2]} ${m[1]}`;

  m = t.match(new RegExp(`^(${WORD})(\\d+)$`, "i"));
  if (m) return `${m[1]} ${m[2]}`;

  return null;
}

/** דפוס אזור חלוקה לוגיסטי */
export function looksLikeDistributionArea(name: string | null | undefined): boolean {
  return normalizeDistributionAreaName(name) != null;
}

/** שם שנראה כיישוב / מקום מסירה מעודכן — לא ליצור ממנו אזור */
export function looksLikeLocalityName(name: string | null | undefined): boolean {
  const t = (name ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (looksLikeDistributionArea(t)) return false;
  if (/^\d+$/.test(t)) return false;
  const blocked = new Set([
    "אזור חלוקה",
    "מקום מסירה",
    "מקום מסירה מעודכן",
    "מקומות מסירה",
    "דרך",
    "במשרד",
    "יתרת פתיחה",
    "distribution area",
    "zone",
  ]);
  if (blocked.has(t) || blocked.has(t.toLowerCase())) return false;
  return t.length >= 2;
}
