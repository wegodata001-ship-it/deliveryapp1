import { PAYMENT_CODE_PREFIX } from "@/lib/payment-capture-code";
import { paymentCodePrefixesForWorkCountry } from "@/lib/country-document-numbering";
import { paymentCodePrefix, type WorkCountryCode } from "@/lib/work-country";

/** מדינות עם רצף קודי קליטה נפרד (לא רצף גלובלי) */
export const CAPTURE_PAYMENT_NAV_COUNTRIES = ["TR", "CN", "AE"] as const;

export type CapturePaymentNavCountry = (typeof CAPTURE_PAYMENT_NAV_COUNTRIES)[number];

export function isCapturePaymentNavCountry(
  wc: WorkCountryCode | null | undefined,
): wc is CapturePaymentNavCountry {
  return wc === "TR" || wc === "CN" || wc === "AE";
}

/** קידומות קוד לפי מדינה — TR-P / CH-P / AE-P בלבד */
export function capturePaymentPrefixesForCountry(workCountry: CapturePaymentNavCountry): string[] {
  return paymentCodePrefixesForWorkCountry(workCountry);
}

/** מדינה מתוך קידומת הקוד בלבד — TR-P-000007 → TR, לא CH/AE */
export function workCountryFromCapturePaymentCode(
  code: string | null | undefined,
): CapturePaymentNavCountry | null {
  const c = code?.trim().toUpperCase();
  if (!c) return null;
  for (const wc of CAPTURE_PAYMENT_NAV_COUNTRIES) {
    for (const prefix of capturePaymentPrefixesForCountry(wc)) {
      const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d{4,6}$`);
      if (re.test(c)) return wc;
    }
  }
  return null;
}

export function formatCapturePaymentCode(workCountry: WorkCountryCode, paymentNumber: number): string {
  const n = Math.max(1, Math.floor(paymentNumber));
  const width = workCountry === "CN" ? 4 : 6;
  return `${paymentCodePrefix(workCountry)}${String(n).padStart(width, "0")}`;
}

export function capturePaymentCodeMatchesCountry(
  code: string | null | undefined,
  workCountry: WorkCountryCode,
): boolean {
  return workCountryFromCapturePaymentCode(code) === workCountry;
}

export function legacyTurkeyPaymentPrefixes(): string[] {
  return [paymentCodePrefix("TR"), PAYMENT_CODE_PREFIX];
}
