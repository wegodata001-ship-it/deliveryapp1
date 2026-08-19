import "server-only";

import { prisma } from "@/lib/prisma";
import {
  formatNewCustomerCode,
  getFirstCustomerNumber,
  normalizeCustomerCodeInput,
  parseCustomerNumberFromCode,
} from "@/lib/customer-code.shared";

export {
  DEFAULT_FIRST_CUSTOMER_NUMBER,
  LEGACY_CUSTOMER_CODE_PREFIX,
  formatNewCustomerCode,
  getFirstCustomerNumber,
  isNumericCustomerCode,
  normalizeCustomerCodeInput,
  parseCustomerNumberFromCode,
} from "@/lib/customer-code.shared";

/**
 * הקוד הבא — מקסימום על קודים מספריים/legacy. לא טוען אלפי שורות.
 */
export async function suggestNextCustomerCode(): Promise<string> {
  const [recent, byCodeDesc] = await Promise.all([
    prisma.customer.findMany({
      where: { deletedAt: null, customerCode: { not: null } },
      select: { customerCode: true },
      orderBy: { createdAt: "desc" },
      take: 400,
    }),
    prisma.customer.findMany({
      where: { deletedAt: null, customerCode: { not: null } },
      select: { customerCode: true },
      orderBy: { customerCode: "desc" },
      take: 80,
    }),
  ]);

  let maxN = getFirstCustomerNumber() - 1;
  const seen = new Set<string>();
  for (const r of [...recent, ...byCodeDesc]) {
    const key = r.customerCode?.trim() ?? "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const n = parseCustomerNumberFromCode(r.customerCode);
    if (n != null) maxN = Math.max(maxN, n);
  }

  for (let bump = 0; bump < 12; bump += 1) {
    const code = formatNewCustomerCode(maxN + 1 + bump);
    const dup = await prisma.customer.findFirst({
      where: { customerCode: { equals: code, mode: "insensitive" }, deletedAt: null },
      select: { id: true },
    });
    if (!dup) return code;
  }

  return formatNewCustomerCode(maxN + 13);
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
