import "server-only";

import type { WorkCountryCode as PrismaWorkCountryCode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  formatNextPaymentCaptureCode,
  parsePaymentNumberFromCode,
  paymentCodePrefixesForWorkCountry,
} from "@/lib/country-document-numbering.shared";

export {
  CHINA_CAPTURE_LEGACY_PREFIX,
  PAYMENT_CODE_PREFIX,
  formatNextPaymentCaptureCode,
  orderSourceCountryForWorkCountry,
  paymentCodePrefixesForWorkCountry,
  parsePaymentNumberFromCode,
} from "@/lib/country-document-numbering.shared";

import type { WorkCountryCode } from "@/lib/work-country";

/**
 * המספר הסידורי האחרון של קודי תשלום במדינה — רק קידומת המדינה (CH-P / TR-P / AE-P).
 * לא משתמש ב-paymentNumber הגלובלי — מניעת דליפה בין מדינות.
 */
export async function maxPaymentSequenceForWorkCountry(
  workCountry: WorkCountryCode,
): Promise<number> {
  const prefixes = paymentCodePrefixesForWorkCountry(workCountry);

  const rows = await prisma.payment.findMany({
    where: {
      countryCode: workCountry as PrismaWorkCountryCode,
      paymentCode: { not: null },
      OR: prefixes.map((p) => ({ paymentCode: { startsWith: p } })),
    },
    select: { paymentCode: true },
    orderBy: { paymentCode: "desc" },
    take: 2_000,
  });

  let maxN = 0;
  for (const r of rows) {
    const n = parsePaymentNumberFromCode(r.paymentCode, workCountry);
    if (n != null) maxN = Math.max(maxN, n);
  }
  return maxN;
}
