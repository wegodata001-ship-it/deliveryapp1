import {
  formatCapturePaymentCode,
  isCapturePaymentNavCountry,
  workCountryFromCapturePaymentCode,
} from "@/lib/payment-code-navigation-shared";
import type { WorkCountryCode } from "@/lib/work-country";

/** מנרמל קלט חיפוש: 7 | 0007 | TR-P-000007 */
export function normalizeCapturePaymentCodeQuery(
  raw: string,
  fallbackWorkCountry: WorkCountryCode,
): string | null {
  const t = raw.trim().toUpperCase();
  if (!t) return null;

  const countryFromFullCode = workCountryFromCapturePaymentCode(t);
  if (countryFromFullCode && t.includes("-")) {
    return t;
  }

  const wc =
    countryFromFullCode ??
    (isCapturePaymentNavCountry(fallbackWorkCountry) ? fallbackWorkCountry : "TR");

  const digits = t.replace(/\D/g, "");
  if (!digits) return null;

  const num = Number.parseInt(digits, 10);
  if (!Number.isFinite(num) || num < 1) return null;

  return formatCapturePaymentCode(wc, num);
}
