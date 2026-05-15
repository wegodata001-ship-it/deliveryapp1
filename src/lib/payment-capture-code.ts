import { prisma } from "@/lib/prisma";
import { escapeRegExp } from "@/lib/order-number";

export const PAYMENT_CODE_PREFIX = "WGP-P-";

function paymentCodeSuffixPattern(): RegExp {
  return new RegExp(`^${escapeRegExp(PAYMENT_CODE_PREFIX)}(\\d{6})$`);
}

/** מספר רציף מתוך קוד WGP-P-000092 → 92 */
export function parsePaymentNumberFromCode(code: string | null | undefined): number | null {
  const c = code?.trim();
  if (!c) return null;
  const m = c.match(paymentCodeSuffixPattern());
  if (!m?.[1]) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * הקצאת קוד קליטה הבא + מספר רציף ל־DB (לא להסתמך בעתיד על parsing מהקוד בלבד).
 */
export async function allocateNextPaymentCapture(): Promise<{ code: string; paymentNumber: number }> {
  const re = paymentCodeSuffixPattern();
  const [rows, agg] = await Promise.all([
    prisma.payment.findMany({
      where: { paymentCode: { startsWith: PAYMENT_CODE_PREFIX } },
      select: { paymentCode: true },
      take: 500,
    }),
    prisma.payment.aggregate({ _max: { paymentNumber: true } }),
  ]);

  let maxN = agg._max.paymentNumber ?? 0;
  for (const r of rows) {
    const n = parsePaymentNumberFromCode(r.paymentCode);
    if (n != null) maxN = Math.max(maxN, n);
  }

  for (let bump = 0; bump < 400; bump++) {
    const n = maxN + 1 + bump;
    const code = `${PAYMENT_CODE_PREFIX}${String(n).padStart(6, "0")}`;
    const dup = await prisma.payment.findFirst({ where: { paymentCode: code }, select: { id: true } });
    if (!dup) return { code, paymentNumber: n };
  }

  const n = maxN + 401;
  const code = `${PAYMENT_CODE_PREFIX}${Date.now().toString(36).toUpperCase()}`;
  return { code, paymentNumber: n };
}
