import type { OrderSourceCountry } from "@prisma/client";
import {
  ORDER_COUNTRY_CODES,
  normalizeOrderSourceCountry,
  type OrderCountryCode,
} from "@/lib/order-countries";

/** קוד סביבת עבודה — מדינה נפרדת במערכת (ב-DB: TR / CN / AE) */
export const WORK_COUNTRY_CODES = ["TR", "CN", "AE"] as const;

export type WorkCountryCode = (typeof WORK_COUNTRY_CODES)[number];

const WORK_SET = new Set<string>(WORK_COUNTRY_CODES);

const TO_SOURCE: Record<WorkCountryCode, OrderSourceCountry> = {
  TR: "TURKEY",
  CN: "CHINA",
  AE: "UAE",
};

const FROM_SOURCE: Partial<Record<OrderSourceCountry, WorkCountryCode>> = {
  TURKEY: "TR",
  CHINA: "CN",
  UAE: "AE",
};

/** ברירת מחדל — כל הנתונים ההיסטוריים בטורקיה */
export const DEFAULT_WORK_COUNTRY: WorkCountryCode = "TR";

/** קידומת במספור הזמנות/תשלומים — סין = CH (פנימית CN) */
export function orderNumberCountryPrefix(workCountry: WorkCountryCode): "TR" | "CH" | "AE" {
  if (workCountry === "CN") return "CH";
  return workCountry;
}

export function isWorkCountryCode(raw: string | null | undefined): raw is WorkCountryCode {
  const t = (raw ?? "").trim().toUpperCase();
  if (t === "CH") return true;
  return WORK_SET.has(t);
}

export function normalizeWorkCountryCode(raw: string | null | undefined): WorkCountryCode | null {
  const t = (raw ?? "").trim().toUpperCase();
  if (t === "CH") return "CN";
  if (WORK_SET.has(t)) return t as WorkCountryCode;
  const fromOrder = normalizeOrderSourceCountry(raw);
  if (fromOrder) return workCountryFromOrderSourceCountry(fromOrder);
  if (t === "TURKEY" || t === "TURKIYE") return "TR";
  if (t === "CHINA") return "CN";
  if (t === "UAE" || t === "EMIRATES") return "AE";
  return null;
}

/** בטוח ל-client — TR / CN / AE עם ברירת מחדל */
export function resolveWorkCountryOrDefault(
  workCountry: string | null | undefined,
): WorkCountryCode {
  return normalizeWorkCountryCode(workCountry) ?? DEFAULT_WORK_COUNTRY;
}

export function workCountryFromOrderSourceCountry(
  source: OrderSourceCountry | OrderCountryCode | string | null | undefined,
): WorkCountryCode {
  if (source == null || source === "") return DEFAULT_WORK_COUNTRY;
  const norm = normalizeOrderSourceCountry(String(source));
  if (norm && FROM_SOURCE[norm as OrderSourceCountry]) {
    return FROM_SOURCE[norm as OrderSourceCountry]!;
  }
  const direct = normalizeWorkCountryCode(String(source));
  return direct ?? DEFAULT_WORK_COUNTRY;
}

export function orderSourceCountryFromWorkCountry(
  code: WorkCountryCode | string | null | undefined,
): OrderSourceCountry {
  const w = normalizeWorkCountryCode(code) ?? DEFAULT_WORK_COUNTRY;
  return TO_SOURCE[w];
}

/** פרמטר country ב-URL (TURKEY | TR | CH | …) → קוד סביבה */
export function resolveWorkCountryFromSearchParams(
  sp: URLSearchParams | Record<string, string | string[] | undefined>,
): WorkCountryCode {
  const raw =
    sp instanceof URLSearchParams
      ? sp.get("country")
      : typeof sp.country === "string"
        ? sp.country
        : undefined;
  return normalizeWorkCountryCode(raw) ?? DEFAULT_WORK_COUNTRY;
}

const LABELS_HE: Record<WorkCountryCode, string> = {
  TR: "🇹🇷 טורקיה",
  CN: "🇨🇳 סין",
  AE: "🇦🇪 אמירויות",
};

export function workCountryLabel(code: WorkCountryCode | string | null | undefined): string {
  const w = normalizeWorkCountryCode(code);
  if (!w) return "—";
  return LABELS_HE[w];
}

/** שם מדינת עבודה לכותרת PDF (ללא דגל) — כרטסת לקוח - טורקיה */
const ENV_LABEL_HE: Record<WorkCountryCode, string> = {
  TR: "טורקיה",
  CN: "סין",
  AE: "אמירויות",
};

export function workEnvironmentLabelHe(code: WorkCountryCode | string | null | undefined): string {
  const w = normalizeWorkCountryCode(code);
  if (!w) return "—";
  return ENV_LABEL_HE[w];
}

/** מפתח מונה הזמנות: TR|AH-125 (מדינה+שבוע — רצף נפרד לכל מדינה) */
export function orderCounterKey(workCountry: WorkCountryCode, weekCode: string): string {
  const wc = weekCode.trim() || "AH-1";
  return `${workCountry}|${wc}`;
}

/** מספר שבוע מתוך AH-125 → 125 */
export function weekNumericPart(weekCode: string): string {
  const m = /^AH-(\d+)$/i.exec(weekCode.trim());
  if (m?.[1]) return m[1];
  return weekCode.replace(/^AH-/i, "").trim() || "1";
}

/** TR-125-0016 / CH-125-0001 / AE-125-0001 */
export function formatOrderNumber(
  workCountry: WorkCountryCode,
  weekCode: string,
  sequence: number,
): string {
  const prefix = orderNumberCountryPrefix(workCountry);
  const wn = weekNumericPart(weekCode);
  const suffix = String(sequence).padStart(4, "0");
  return `${prefix}-${wn}-${suffix}`;
}

export function paymentCodePrefix(workCountry: WorkCountryCode): string {
  return `${orderNumberCountryPrefix(workCountry)}-P-`;
}

/** תאימות ל-ORDER_COUNTRY_CODES בטופס (ללא שינוי UI) */
export function orderCountryCodeForWorkCountry(workCountry: WorkCountryCode): OrderCountryCode {
  return orderSourceCountryFromWorkCountry(workCountry) as OrderCountryCode;
}

export function workCountryOptionsForSettings(): WorkCountryCode[] {
  return [...WORK_COUNTRY_CODES];
}

/** האם קוד הזמנה שייך למדינת עבודה (תומך AH- ו-TR- ישנים) */
export function orderNumberMatchesWorkCountry(
  orderNumber: string | null | undefined,
  workCountry: WorkCountryCode,
): boolean {
  const n = (orderNumber ?? "").trim().toUpperCase();
  if (!n) return false;
  const prefix = orderNumberCountryPrefix(workCountry);
  if (n.startsWith(`${prefix}-`)) return true;
  if (workCountry === "TR" && /^AH-\d+/.test(n)) return true;
  if (workCountry === "CN" && n.startsWith("CN-")) return true;
  return false;
}
