/**
 * זיהוי שפה/כתב לשדות שם לקוח (ערבית / עברית ישנה / לטינית).
 */
export type DetectedLanguage = "ar" | "he" | "en";

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const HEBREW_RE = /[\u0590-\u05FF]/;

export function detectLanguage(value: string): DetectedLanguage {
  const s = value.trim();
  if (!s) return "en";
  if (ARABIC_RE.test(s)) return "ar";
  if (HEBREW_RE.test(s)) return "he";
  return "en";
}

export type CustomerNameFields = {
  nameAr: string | null;
  nameEn: string | null;
};

/**
 * תצוגה: עדיפות nameAr → nameEn → שם בעברית ישן (nameHe) → displayName
 */
export function primaryCustomerDisplayName(c: {
  nameAr?: string | null;
  nameEn?: string | null;
  nameHe?: string | null;
  displayName: string;
}): string {
  const ar = c.nameAr?.trim();
  const en = c.nameEn?.trim();
  const he = c.nameHe?.trim();
  if (ar) return ar;
  if (en) return en;
  if (he) return he;
  const d = c.displayName?.trim();
  return d || "—";
}

/**
 * מילוי חכם רק בשדות ריקים במסד — ללא מחיקת displayName / IDs.
 * שדה "ערבית" ו"אנגלית" בטופס + זיהוי כתב לטיפול בהקלדה לא נכונה לשדה.
 */
export function computeCustomerNamePatches(
  existing: CustomerNameFields,
  arabicFieldInput: string,
  englishFieldInput: string,
): Partial<Pick<CustomerNameFields, "nameAr" | "nameEn">> {
  const patches: Partial<Pick<CustomerNameFields, "nameAr" | "nameEn">> = {};
  const arIn = arabicFieldInput.trim();
  const enIn = englishFieldInput.trim();

  if (arIn && !existing.nameAr?.trim()) {
    const d = detectLanguage(arIn);
    if (d === "ar") patches.nameAr = arIn;
    else if (d === "en" && !existing.nameEn?.trim()) patches.nameEn = arIn;
  }

  if (enIn && !existing.nameEn?.trim()) {
    const d = detectLanguage(enIn);
    if (d === "en") patches.nameEn = enIn;
    else if (d === "ar" && !existing.nameAr?.trim()) patches.nameAr = enIn;
  }

  return patches;
}
