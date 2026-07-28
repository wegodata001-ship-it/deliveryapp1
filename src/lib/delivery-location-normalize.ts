/**
 * נרמול שמות יישובים להתאמה זהירה בין כינויים (עברית / ערבית / אנגלית).
 * לא מבצע fuzzy matching — רק ניקוי דטרמיניסטי.
 */

export function normalizeLocationName(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw).normalize("NFKC");

  // איחוד מקפים וגרשיים
  s = s
    .replace(/[\u2010-\u2015\u2212־–—―]/g, "-")
    .replace(/[`´'’ʻʾʿ]/g, "'")
    .replace(/[“”„«»]/g, '"');

  // הסרת סימני פיסוק נפוצים (שומרים על אותיות/ספרות/רווח/מקף/גרש)
  s = s.replace(/[.,;:!?()[\]{}|/\\@#$%^&*=+~<>]/g, " ");

  // קיפול אותיות לטיניות בלבד
  s = s.replace(/[A-Za-z]+/g, (m) => m.toLowerCase());

  // רווחים מרובים + trim
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** מפתח ייחודי לכינוי — מנורמל ללא מקפים/גרשיים לצורך dedupe */
export function aliasLookupKey(raw: string | null | undefined): string {
  return normalizeLocationName(raw).replace(/[-'"]/g, "").replace(/\s+/g, " ").trim();
}
