/**
 * פונקציה מרכזית לשם ערבי ל-PDF שליח — תעתיק, cache, עדיפויות.
 */
import { containsArabic, extractArabicText } from "@/lib/arabic-text";
import { suggestArabicCustomerName } from "@/lib/arabic-name-suggest";
import { containsHebrew, transliterateHebrewToArabic } from "@/lib/hebrew-name-transliterate";

export type ArabicDisplayContext = "customer" | "locality";

export type ArabicDisplayCacheEntry = {
  arabicName: string;
  isManualOverride: boolean;
};

export type ArabicDisplaySource =
  | "session_override"
  | "stored_arabic"
  | "manual_cache"
  | "original_arabic"
  | "auto_cache"
  | "transliterated"
  | "fallback";

export type GetArabicDisplayNameInput = {
  context: ArabicDisplayContext;
  originalText: string | null | undefined;
  /** nameAr / displayNameAr — לא נדרס במסד */
  storedArabic?: string | null;
  /** תיקון ידני ל-PDF הנוכחי */
  sessionOverride?: string | null;
  cache?: Map<string, ArabicDisplayCacheEntry>;
};

export type GetArabicDisplayNameResult = {
  arabicName: string;
  originalText: string;
  source: ArabicDisplaySource;
  needsReview: boolean;
  /** לשמירה ב-cache — רק כשמקור transliterated */
  cacheCandidate?: { originalName: string; arabicName: string };
};

export function normalizeArabicDisplayKey(text: string): string {
  return text
    .trim()
    .normalize("NFKC")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function transliterateToArabic(
  text: string,
  context: ArabicDisplayContext,
): { suggested: string | null; complete: boolean } {
  if (containsHebrew(text)) {
    const he = transliterateHebrewToArabic(text, context);
    if (he.suggested && containsArabic(he.suggested)) {
      return { suggested: he.suggested, complete: he.complete };
    }
  }

  const latin = suggestArabicCustomerName(text);
  if (latin.suggested && containsArabic(latin.suggested)) {
    return { suggested: latin.suggested, complete: latin.complete };
  }

  return { suggested: null, complete: false };
}

export function getArabicDisplayName(input: GetArabicDisplayNameInput): GetArabicDisplayNameResult {
  const originalText = (input.originalText ?? "").trim();
  const key = originalText ? normalizeArabicDisplayKey(originalText) : "";

  const session = input.sessionOverride?.trim();
  if (session && containsArabic(session)) {
    return {
      arabicName: session,
      originalText: originalText || session,
      source: "session_override",
      needsReview: false,
    };
  }

  const stored = input.storedArabic?.trim();
  if (stored && containsArabic(stored)) {
    return {
      arabicName: stored,
      originalText: originalText || stored,
      source: "stored_arabic",
      needsReview: false,
    };
  }

  const cached = key ? input.cache?.get(key) : undefined;
  if (cached?.isManualOverride && containsArabic(cached.arabicName)) {
    return {
      arabicName: cached.arabicName,
      originalText: originalText || cached.arabicName,
      source: "manual_cache",
      needsReview: false,
    };
  }

  if (originalText && containsArabic(originalText)) {
    const extracted = extractArabicText(originalText) ?? originalText;
    return {
      arabicName: extracted,
      originalText,
      source: "original_arabic",
      needsReview: false,
    };
  }

  if (cached?.arabicName && containsArabic(cached.arabicName)) {
    return {
      arabicName: cached.arabicName,
      originalText: originalText || cached.arabicName,
      source: "auto_cache",
      needsReview: false,
    };
  }

  if (originalText) {
    const tr = transliterateToArabic(originalText, input.context);
    if (tr.suggested && containsArabic(tr.suggested)) {
      return {
        arabicName: tr.suggested,
        originalText,
        source: "transliterated",
        needsReview: !tr.complete,
        cacheCandidate: !cached ? { originalName: originalText, arabicName: tr.suggested } : undefined,
      };
    }
  }

  const fb = originalText || "—";
  return {
    arabicName: fb,
    originalText: originalText || fb,
    source: "fallback",
    needsReview: true,
  };
}

/** @deprecated השתמשו ב-getArabicDisplayName */
export function resolveCourierPdfCustomerName(params: {
  nameAr: string | null | undefined;
  latinFallback: string | null | undefined;
  sessionOverride?: string | null;
  cache?: Map<string, ArabicDisplayCacheEntry>;
}): string {
  return getArabicDisplayName({
    context: "customer",
    originalText: params.latinFallback,
    storedArabic: params.nameAr,
    sessionOverride: params.sessionOverride,
    cache: params.cache,
  }).arabicName;
}
