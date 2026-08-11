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
 * הקוד הבא — מקסימום על כל הקודים (WGP-C- ומספריים נקיים). לקוחות חדשים מקבלים מספר בלבד.
 */
export async function suggestNextCustomerCode(): Promise<string> {
  const rows = await prisma.customer.findMany({
    where: { deletedAt: null, customerCode: { not: null } },
    select: { customerCode: true },
    take: 5000,
  });

  let maxN = getFirstCustomerNumber() - 1;
  for (const r of rows) {
    const n = parseCustomerNumberFromCode(r.customerCode);
    if (n != null) maxN = Math.max(maxN, n);
  }

  for (let bump = 0; bump < 400; bump++) {
    const code = formatNewCustomerCode(maxN + 1 + bump);
    const dup = await prisma.customer.findFirst({
      where: { customerCode: { equals: code, mode: "insensitive" }, deletedAt: null },
      select: { id: true },
    });
    if (!dup) return code;
  }

  return formatNewCustomerCode(maxN + 401);
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
