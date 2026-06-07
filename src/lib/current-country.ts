import {
  coerceOrderCountryForForm,
  ORDER_COUNTRY_CODES,
  type OrderCountryCode,
} from "@/lib/order-countries";

/** מקור אמת יחיד — localStorage */
export const LS_CURRENT_COUNTRY = "currentCountry";

/** תאימות לאחור */
export const LS_GLOBAL_COUNTRY = "globalCountry";

export function defaultOrderCountry(): OrderCountryCode {
  return ORDER_COUNTRY_CODES[0] as OrderCountryCode;
}

/** קורא מדינה שמורה — localStorage + sessionStorage */
export function readPersistedCountry(): OrderCountryCode | null {
  if (typeof window === "undefined") return null;
  try {
    for (const key of [LS_CURRENT_COUNTRY, LS_GLOBAL_COUNTRY] as const) {
      const fromLs = coerceOrderCountryForForm(localStorage.getItem(key));
      if (fromLs) return fromLs;
    }
    const fromSs = coerceOrderCountryForForm(sessionStorage.getItem(LS_CURRENT_COUNTRY));
    if (fromSs) return fromSs;
  } catch {
    // ignore
  }
  return null;
}

/** שומר מדינה — localStorage + sessionStorage */
export function persistGlobalCountry(country: OrderCountryCode): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_CURRENT_COUNTRY, country);
    localStorage.setItem(LS_GLOBAL_COUNTRY, country);
    sessionStorage.setItem(LS_CURRENT_COUNTRY, country);
  } catch {
    // ignore
  }
}

/**
 * סדר עדיפות: URL → localStorage/session → ברירת מחדל.
 * בצד שרת (ללא window): URL בלבד → ברירת מחדל.
 */
export function resolveGlobalCountry(urlRaw: string | null | undefined): OrderCountryCode {
  const fromUrl = coerceOrderCountryForForm(urlRaw);
  if (fromUrl) return fromUrl;
  const stored = readPersistedCountry();
  if (stored) return stored;
  return defaultOrderCountry();
}
