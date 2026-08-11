import { escapeRegExp } from "@/lib/order-number";

/** קידומת לקוחות ישנים — נשמרים כפי שהם, לא נוצרים חדשים */
export const LEGACY_CUSTOMER_CODE_PREFIX = "WGP-C-";

/** מספר ראשון כשאין עדיין קודים מספריים (פרודקשן / seed) */
export const DEFAULT_FIRST_CUSTOMER_NUMBER = 24001;

/** מספר התחלה ללקוח ראשון — לדוגמה 100 ב-DEMO: CUSTOMER_CODE_FIRST_NUMBER=100 */
export function getFirstCustomerNumber(): number {
  const raw = process.env.CUSTOMER_CODE_FIRST_NUMBER?.trim();
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return DEFAULT_FIRST_CUSTOMER_NUMBER;
}

function legacyCustomerCodePattern(): RegExp {
  return new RegExp(`^${escapeRegExp(LEGACY_CUSTOMER_CODE_PREFIX)}(\\d+)$`, "i");
}

/** מפרק מספר מקוד WGP-C-##### או מקוד מספרי נקי (24001) */
export function parseCustomerNumberFromCode(code: string | null | undefined): number | null {
  const c = code?.trim();
  if (!c) return null;
  const legacy = c.match(legacyCustomerCodePattern());
  if (legacy?.[1]) {
    const n = parseInt(legacy[1], 10);
    return Number.isFinite(n) ? n : null;
  }
  if (/^\d+$/.test(c)) {
    const n = parseInt(c, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** קוד לקוח חדש — מספר בלבד, עם padding ל-5 ספרות */
export function formatNewCustomerCode(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(5, "0");
}

export function normalizeCustomerCodeInput(raw: string): string {
  return raw.trim();
}

export function isNumericCustomerCode(code: string): boolean {
  return /^\d+$/.test(normalizeCustomerCodeInput(code));
}
