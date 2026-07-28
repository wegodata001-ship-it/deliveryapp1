/**
 * עזרי טקסט ערבי — לחילוץ שמות ערביים מכינויים מעורבים.
 */

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const ARABIC_SEGMENT_RE =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF][\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\s\u0640\-־']*/g;

export function containsArabic(text: string | null | undefined): boolean {
  return Boolean(text && ARABIC_RE.test(text));
}

/** מחלץ את המקטע הערבי הארוך ביותר ממחרוזת מעורבת */
export function extractArabicText(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  const matches = text.match(ARABIC_SEGMENT_RE);
  if (!matches?.length) return null;
  const best = [...matches]
    .map((m) => m.replace(/\s+/g, " ").trim())
    .filter((m) => m.length >= 2)
    .sort((a, b) => b.length - a.length)[0];
  return best || null;
}

/** שם לתצוגה ב־PDF: מעדיף ערבית אמיתית, אחרת fallback זמני */
export function preferArabicName(
  arabicCandidate: string | null | undefined,
  fallback: string | null | undefined,
): string {
  const ar = arabicCandidate?.trim();
  if (ar && containsArabic(ar)) return ar;
  const extracted = extractArabicText(fallback);
  if (extracted) return extracted;
  const fb = fallback?.trim();
  return fb || "—";
}

/**
 * מנקה שם יישוב ערבי משדות כתובת ארוכים (למשל "ام الفحم ، الشارع…").
 * לא מתרגם — רק חיתוך/נרמול של טקסט ערבי קיים.
 */
export function cleanArabicLocalityName(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  const extracted = extractArabicText(text) ?? (containsArabic(text) ? text.trim() : null);
  if (!extracted) return null;
  const head = extracted
    .split(/[،,;|\/]/)[0]
    ?.replace(/\s+/g, " ")
    .trim();
  if (!head || !containsArabic(head)) return null;
  // עד ~4 מילים — שם יישוב; לא כתובת מלאה
  const words = head.split(" ").filter(Boolean);
  return words.slice(0, 4).join(" ") || null;
}
