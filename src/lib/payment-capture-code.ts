import { prisma } from "@/lib/prisma";
import type { WorkCountryCode as PrismaWorkCountryCode } from "@prisma/client";
import { escapeRegExp } from "@/lib/order-number";
import {
  formatNextPaymentCaptureCode,
  maxPaymentSequenceForWorkCountry,
  paymentCodePrefixesForWorkCountry,
} from "@/lib/country-document-numbering";
import {
  DEFAULT_WORK_COUNTRY,
  normalizeWorkCountryCode,
  paymentCodePrefix,
  workCountryFromOrderSourceCountry,
  type WorkCountryCode as WorkCountryCodeLib,
} from "@/lib/work-country";

/** מדינת עבודה לקליטת תשלום — לקוח / הזמנה / מדינה מפורשת */
export async function resolvePaymentWorkCountry(opts: {
  orderId?: string | null;
  customerId?: string | null;
  workCountry?: string | null;
}): Promise<WorkCountryCodeLib> {
  const explicit = normalizeWorkCountryCode(opts.workCountry);
  if (explicit) return explicit;

  const oid = opts.orderId?.trim();
  if (oid) {
    const o = await prisma.order.findFirst({
      where: { id: oid, deletedAt: null },
      select: { countryCode: true, sourceCountry: true },
    });
    if (o?.countryCode) return o.countryCode as WorkCountryCodeLib;
    if (o?.sourceCountry) return workCountryFromOrderSourceCountry(o.sourceCountry);
  }
  const cid = opts.customerId?.trim();
  if (cid) {
    const c = await prisma.customer.findFirst({
      where: { id: cid, deletedAt: null },
      select: { countryCode: true },
    });
    if (c?.countryCode) return c.countryCode as WorkCountryCodeLib;
  }
  return DEFAULT_WORK_COUNTRY;
}

/** תאימות לאחור — תשלומי טורקיה ישנים */
export const PAYMENT_CODE_PREFIX = "WGP-P-";

/** תאימות לאחור — קודי סין (CH-P-) */
export const CHINA_CAPTURE_LEGACY_PREFIX = "CH-P-";

function paymentCodeSuffixPattern(prefix: string): RegExp {
  return new RegExp(`^${escapeRegExp(prefix)}(\\d{4,6})$`);
}

export function parsePaymentNumberFromCode(
  code: string | null | undefined,
  workCountry: WorkCountryCodeLib = DEFAULT_WORK_COUNTRY,
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

/**
 * הקצאת קוד קליטה הבא — מונה נפרד לכל מדינה (TR-P-… / CH-P-… / AE-P-…).
 * סריקה לפי countryCode + קידומת המדינה בלבד.
 */
export async function allocateNextPaymentCapture(
  workCountry: WorkCountryCodeLib = DEFAULT_WORK_COUNTRY,
): Promise<{ code: string; paymentNumber: number }> {
  const maxN = await maxPaymentSequenceForWorkCountry(workCountry);

  for (let bump = 0; bump < 400; bump++) {
    const n = maxN + 1 + bump;
    const code = formatNextPaymentCaptureCode(workCountry, n);
    const dup = await prisma.payment.findFirst({
      where: { paymentCode: code },
      select: { id: true },
    });
    if (!dup) return { code, paymentNumber: n };
  }

  const n = maxN + 401;
  const code = `${paymentCodePrefix(workCountry)}${Date.now().toString(36).toUpperCase()}`;
  return { code, paymentNumber: n };
}
