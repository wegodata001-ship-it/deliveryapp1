/**
 * נרמול שמות יישובים — SSOT לפני כל השוואה / חיפוש / ייבוא.
 * תומך בעברית, ערבית, אנגלית ו-Unicode מלא.
 * לא fuzzy — רק ניקוי דטרמיניסטי + מפתח חיפוש ללא רווחים/מקפים.
 */

const PUNCT_RE = /[.,;:!?()[\]{}|/\\@#$%^&*=+~<>]/g;
const DASHES_RE = /[\u2010-\u2015\u2212־–—―]/g;
const QUOTES_RE = /[`´'’ʻʾʿ""„«»]/g;
const WHITESPACE_RE = /\s+/g;

/** נרמול לתצוגה / השוואה רגילה — שומר מילים מופרדות ברווח יחיד */
export function normalizeLocationName(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw).normalize("NFKC");

  s = s.replace(DASHES_RE, "-").replace(QUOTES_RE, " ");
  s = s.replace(PUNCT_RE, " ");
  s = s.replace(/\s*-\s*/g, " ");
  s = s.replace(/-+/g, " ");

  s = s.replace(/[A-Za-z]+/g, (m) => m.toLowerCase());
  s = s.replace(WHITESPACE_RE, " ").trim();
  return s;
}

/**
 * מפתח חיפוש קומפקטי — אותו יישוב בכל צורת כתיבה:
 * BET-LAHEM / bet lahem / BETLAHEM / Bet Lahem / בית לחם / بيت لحم (ללא רווחים)
 */
export function aliasLookupKey(raw: string | null | undefined): string {
  const norm = normalizeLocationName(raw);
  if (!norm) return "";
  return norm.replace(/[\s\-'"`]/g, "");
}

/** האם שני שמות מצביעים על אותו יישוב (לאחר נרמול) */
export function locationNamesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ka = aliasLookupKey(a);
  const kb = aliasLookupKey(b);
  return ka.length > 0 && ka === kb;
}
