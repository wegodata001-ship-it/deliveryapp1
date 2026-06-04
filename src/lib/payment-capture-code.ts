import { prisma } from "@/lib/prisma";
import type { WorkCountryCode as PrismaWorkCountryCode } from "@prisma/client";
import { escapeRegExp } from "@/lib/order-number";
import {
  DEFAULT_WORK_COUNTRY,
  paymentCodePrefix,
  workCountryFromOrderSourceCountry,
  type WorkCountryCode as WorkCountryCodeLib,
} from "@/lib/work-country";

/** מדינת עבודה לקליטת תשלום — מהזמנה, הלקוח, או TR */
export async function resolvePaymentWorkCountry(opts: {
  orderId?: string | null;
  customerId?: string | null;
}): Promise<WorkCountryCodeLib> {
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

/** תאימות לאחור — קודי סין ישנים (CH-P- במקום CN-P-) */
export const CHINA_CAPTURE_LEGACY_PREFIX = "CH-P-";

function paymentCodeSuffixPattern(prefix: string): RegExp {
  return new RegExp(`^${escapeRegExp(prefix)}(\\d{6})$`);
}

export function parsePaymentNumberFromCode(
  code: string | null | undefined,
  workCountry: WorkCountryCodeLib = DEFAULT_WORK_COUNTRY,
): number | null {
  const c = code?.trim();
  if (!c) return null;
  const prefixes =
    workCountry === "TR"
      ? [paymentCodePrefix("TR"), PAYMENT_CODE_PREFIX]
      : workCountry === "CN"
        ? [paymentCodePrefix("CN"), CHINA_CAPTURE_LEGACY_PREFIX]
        : [paymentCodePrefix(workCountry)];
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
 * הקצאת קוד קליטה הבא — מונה נפרד לכל מדינה (TR-P-000006, CN-P-000001, …).
 */
export async function allocateNextPaymentCapture(
  workCountry: WorkCountryCodeLib = DEFAULT_WORK_COUNTRY,
): Promise<{ code: string; paymentNumber: number }> {
  const prefix = paymentCodePrefix(workCountry);
  const legacyPrefixes =
    workCountry === "TR"
      ? [prefix, PAYMENT_CODE_PREFIX]
      : workCountry === "CN"
        ? [prefix, CHINA_CAPTURE_LEGACY_PREFIX]
        : [prefix];

  const startsWithOr = legacyPrefixes.map((p) => ({ paymentCode: { startsWith: p } }));

  const [rows, scopedAgg] = await Promise.all([
    prisma.payment.findMany({
      where: {
        countryCode: workCountry as PrismaWorkCountryCode,
        OR: startsWithOr,
      },
      select: { paymentCode: true },
      take: 500,
      orderBy: { paymentNumber: "desc" },
    }),
    prisma.payment.aggregate({
      where: { countryCode: workCountry as PrismaWorkCountryCode },
      _max: { paymentNumber: true },
    }),
  ]);

  let maxN = scopedAgg._max.paymentNumber ?? 0;
  for (const r of rows) {
    const n = parsePaymentNumberFromCode(r.paymentCode, workCountry);
    if (n != null) maxN = Math.max(maxN, n);
  }

  for (let bump = 0; bump < 400; bump++) {
    const n = maxN + 1 + bump;
    const code = `${prefix}${String(n).padStart(6, "0")}`;
    const dup = await prisma.payment.findFirst({ where: { paymentCode: code }, select: { id: true } });
    if (!dup) return { code, paymentNumber: n };
  }

  const n = maxN + 401;
  const code = `${prefix}${Date.now().toString(36).toUpperCase()}`;
  return { code, paymentNumber: n };
}
