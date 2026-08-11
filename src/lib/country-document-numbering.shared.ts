import type { OrderSourceCountry } from "@prisma/client";
import { escapeRegExp } from "@/lib/order-number";
import {
  DEFAULT_WORK_COUNTRY,
  orderSourceCountryFromWorkCountry,
  paymentCodePrefix,
  type WorkCountryCode,
} from "@/lib/work-country";

/** תאימות לאחור — תשלומי טורקיה ישנים */
export const PAYMENT_CODE_PREFIX = "WGP-P-";

/** תאימות לאחור — קודי סין (CH-P-) */
export const CHINA_CAPTURE_LEGACY_PREFIX = "CH-P-";

/** קידומות קוד תשלום לפי מדינה — סין = CH-P- בלבד (לא TR / CN-P חדש) */
export function paymentCodePrefixesForWorkCountry(workCountry: WorkCountryCode): string[] {
  if (workCountry === "TR") return [paymentCodePrefix("TR"), PAYMENT_CODE_PREFIX];
  if (workCountry === "CN") return [paymentCodePrefix("CN"), CHINA_CAPTURE_LEGACY_PREFIX];
  return [paymentCodePrefix(workCountry)];
}

/** OrderSourceCountry לסינון DB (CHINA / TURKEY / UAE) */
export function orderSourceCountryForWorkCountry(workCountry: WorkCountryCode): OrderSourceCountry {
  return orderSourceCountryFromWorkCountry(workCountry);
}

export function formatNextPaymentCaptureCode(
  workCountry: WorkCountryCode,
  sequence: number,
): string {
  const prefix = paymentCodePrefix(workCountry);
  const width = workCountry === "CN" ? 4 : 6;
  return `${prefix}${String(Math.max(1, sequence)).padStart(width, "0")}`;
}

function paymentCodeSuffixPattern(prefix: string): RegExp {
  return new RegExp(`^${escapeRegExp(prefix)}(\\d{4,6})$`);
}

export function parsePaymentNumberFromCode(
  code: string | null | undefined,
  workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
): number | null {
  const c = code?.trim();
  if (!c) return null;
  const prefixes = paymentCodePrefixesForWorkCountry(workCountry);
  for (const p of prefixes) {
    const m = c.match(paymentCodeSuffixPattern(p));
    if (m?.[1]) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}
