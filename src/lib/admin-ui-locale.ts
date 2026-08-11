export type AdminUiLocale = "he" | "ar" | "en";

export const ADMIN_UI_LOCALE_DIR: Record<AdminUiLocale, "rtl" | "ltr"> = {
  he: "rtl",
  ar: "rtl",
  en: "ltr",
};

export type MultiSelectUiStrings = {
  placeholder: string;
  searchPlaceholder: string;
  selectAll: string;
  clearAll: string;
  empty: string;
  done: string;
  selectedCount: (n: number) => string;
  removeTitle: (label: string) => string;
};

const MS_STRINGS: Record<AdminUiLocale, MultiSelectUiStrings> = {
  he: {
    placeholder: "הכל",
    searchPlaceholder: "חיפוש…",
    selectAll: "בחר הכל",
    clearAll: "נקה הכל",
    empty: "אין אפשרויות",
    done: "סיום",
    selectedCount: (n) => `${n} נבחרו`,
    removeTitle: (label) => `הסר: ${label}`,
  },
  ar: {
    placeholder: "الكل",
    searchPlaceholder: "بحث…",
    selectAll: "تحديد الكل",
    clearAll: "مسح الكل",
    empty: "لا خيارات",
    done: "تم",
    selectedCount: (n) => `${n} محددة`,
    removeTitle: (label) => `إزالة: ${label}`,
  },
  en: {
    placeholder: "All",
    searchPlaceholder: "Search…",
    selectAll: "Select all",
    clearAll: "Clear all",
    empty: "No options",
    done: "Done",
    selectedCount: (n) => `${n} selected`,
    removeTitle: (label) => `Remove: ${label}`,
  },
};

export function normalizeAdminUiLocale(raw: string | null | undefined): AdminUiLocale {
  const t = (raw ?? "").trim().toLowerCase();
  if (t === "ar" || t.startsWith("ar")) return "ar";
  if (t === "en" || t.startsWith("en")) return "en";
  return "he";
}

export function getMultiSelectUiStrings(locale: AdminUiLocale): MultiSelectUiStrings {
  return MS_STRINGS[locale];
}

/** קורא שפת ממשק מ-html lang (client only) */
export function readDocumentUiLocale(): AdminUiLocale {
  if (typeof document === "undefined") return "he";
  return normalizeAdminUiLocale(document.documentElement.lang);
}
