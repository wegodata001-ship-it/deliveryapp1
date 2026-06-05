import type { OrderSourceCountry, WorkCountryCode as PrismaWorkCountryCode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  CHINA_CAPTURE_LEGACY_PREFIX,
  parsePaymentNumberFromCode,
  PAYMENT_CODE_PREFIX,
} from "@/lib/payment-capture-code";
import {
  orderSourceCountryFromWorkCountry,
  paymentCodePrefix,
  type WorkCountryCode,
} from "@/lib/work-country";

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

export function formatNextPaymentCaptureCode(
  workCountry: WorkCountryCode,
  sequence: number,
): string {
  const prefix = paymentCodePrefix(workCountry);
  const width = workCountry === "CN" ? 4 : 6;
  return `${prefix}${String(Math.max(1, sequence)).padStart(width, "0")}`;
}
