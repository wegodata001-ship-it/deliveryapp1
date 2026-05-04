export const ORDER_COUNTRY_CODES = ["TURKEY", "CHINA", "UAE"] as const;

export type OrderCountryCode = (typeof ORDER_COUNTRY_CODES)[number];

const ORDER_COUNTRY_SET = new Set<string>(ORDER_COUNTRY_CODES);

/** ממפה ערך ממסד / legacy לקוד סטנדרטי (TURKEY | CHINA | UAE) */
export function normalizeOrderSourceCountry(raw: string | null | undefined): OrderCountryCode | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  const up = t.toUpperCase();
  if (ORDER_COUNTRY_SET.has(up)) return up as OrderCountryCode;
  const compact = up.replace(/\s+/g, "_");
  if (ORDER_COUNTRY_SET.has(compact)) return compact as OrderCountryCode;
  const alnum = up.replace(/[^A-Z0-9]/g, "");
  if (alnum === "TURKEY" || alnum === "TURKIYE") return "TURKEY";
  if (alnum === "CHINA" || alnum === "CN") return "CHINA";
  if (alnum === "UAE" || alnum === "ARE" || alnum === "EMIRATES") return "UAE";
  return null;
}

/** ערך לטופס — תמיד מחרוזת קוד אחת מהרשימה או "" */
export function coerceOrderCountryForForm(raw: unknown): OrderCountryCode | "" {
  const n = normalizeOrderSourceCountry(raw == null || raw === "" ? null : String(raw));
  if (n) return n;
  if (raw == null || raw === "") return "";
  const s = String(raw).trim().toUpperCase();
  if (ORDER_COUNTRY_SET.has(s)) return s as OrderCountryCode;
  return "";
}

const LABELS_HE: Record<OrderCountryCode, string> = {
  TURKEY: "🇹🇷 טורקיה",
  CHINA: "🇨🇳 סין",
  UAE: "🇦🇪 אמירויות",
};

export function orderCountryLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return LABELS_HE[code as OrderCountryCode] ?? String(code);
}

/** מחלקות תצוגה ל-badge — תכלית אדום / זהב / ירוק */
export function orderCountryBadgeClass(code: string | null | undefined): string {
  switch (code) {
    case "TURKEY":
      return "adm-oc-badge adm-oc-badge--turkey";
    case "CHINA":
      return "adm-oc-badge adm-oc-badge--china";
    case "UAE":
      return "adm-oc-badge adm-oc-badge--uae";
    default:
      return "adm-oc-badge adm-oc-badge--muted";
  }
}

export function parseSelectedCountriesJson(raw: string | undefined | null): OrderCountryCode[] {
  if (!raw?.trim()) return [...ORDER_COUNTRY_CODES];
  try {
    const a = JSON.parse(raw) as unknown;
    if (!Array.isArray(a)) return [...ORDER_COUNTRY_CODES];
    const set = new Set<OrderCountryCode>();
    for (const x of a) {
      if (typeof x === "string" && ORDER_COUNTRY_CODES.includes(x as OrderCountryCode)) {
        set.add(x as OrderCountryCode);
      }
    }
    return set.size > 0 ? [...set] : [...ORDER_COUNTRY_CODES];
  } catch {
    return [...ORDER_COUNTRY_CODES];
  }
}
