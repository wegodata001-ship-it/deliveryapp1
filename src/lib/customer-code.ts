import { prisma } from "@/lib/prisma";
import { escapeRegExp } from "@/lib/order-number";

export const CUSTOMER_CODE_PREFIX = "WGP-C-";

/** מספר ראשון כשאין עדיין קודים בפורמט WGP-C- */
const DEFAULT_FIRST_CUSTOMER_NUMBER = 24001;

function customerCodePattern(): RegExp {
  return new RegExp(`^${escapeRegExp(CUSTOMER_CODE_PREFIX)}(\\d+)$`, "i");
}

export function parseCustomerNumberFromCode(code: string | null | undefined): number | null {
  const c = code?.trim();
  if (!c) return null;
  const m = c.match(customerCodePattern());
  if (!m?.[1]) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function formatCustomerCode(n: number): string {
  return `${CUSTOMER_CODE_PREFIX}${String(Math.max(0, Math.floor(n))).padStart(5, "0")}`;
}

export function normalizeCustomerCodeInput(raw: string): string {
  return raw.trim();
}

/**
 * הקוד הבא לפי המקסימום בין קודי WGP-C- הקיימים (לקוחות ישנים בלי קוד לא משפיעים).
 */
export async function suggestNextCustomerCode(): Promise<string> {
  const rows = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      customerCode: { startsWith: CUSTOMER_CODE_PREFIX, mode: "insensitive" },
    },
    select: { customerCode: true },
    take: 2000,
  });

  let maxN = DEFAULT_FIRST_CUSTOMER_NUMBER - 1;
  for (const r of rows) {
    const n = parseCustomerNumberFromCode(r.customerCode);
    if (n != null) maxN = Math.max(maxN, n);
  }

  for (let bump = 0; bump < 400; bump++) {
    const code = formatCustomerCode(maxN + 1 + bump);
    const dup = await prisma.customer.findFirst({
      where: { customerCode: { equals: code, mode: "insensitive" }, deletedAt: null },
      select: { id: true },
    });
    if (!dup) return code;
  }

  return formatCustomerCode(maxN + 401);
}

export async function isCustomerCodeTaken(code: string, excludeCustomerId?: string): Promise<boolean> {
  const normalized = normalizeCustomerCodeInput(code);
  if (!normalized) return false;
  const dup = await prisma.customer.findFirst({
    where: {
      customerCode: { equals: normalized, mode: "insensitive" },
      deletedAt: null,
      ...(excludeCustomerId ? { id: { not: excludeCustomerId } } : {}),
    },
    select: { id: true },
  });
  return !!dup;
}
