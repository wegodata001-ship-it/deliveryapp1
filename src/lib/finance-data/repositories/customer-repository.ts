import { prisma } from "@/lib/prisma";
import { toMoney, type FinanceCustomerRecord } from "@/lib/finance-data/types";

function mapCustomer(row: {
  id: string;
  customerCode: string | null;
  displayName: string;
  balanceUsd: unknown;
  countryCode: string;
  isActive: boolean;
}): FinanceCustomerRecord {
  return {
    id: row.id,
    customerCode: row.customerCode,
    displayName: row.displayName,
    balanceUsd: toMoney(row.balanceUsd as { toNumber(): number } | number | null),
    countryCode: row.countryCode,
    isActive: row.isActive,
  };
}

const customerSelect = {
  id: true,
  customerCode: true,
  displayName: true,
  balanceUsd: true,
  countryCode: true,
  isActive: true,
} as const;

export type CustomerRepository = {
  findById(customerId: string): Promise<FinanceCustomerRecord | null>;
  findByIds(customerIds: string[]): Promise<FinanceCustomerRecord[]>;
};

export const customerRepository: CustomerRepository = {
  async findById(customerId) {
    const row = await prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: customerSelect,
    });
    return row ? mapCustomer(row) : null;
  },

  async findByIds(customerIds) {
    if (customerIds.length === 0) return [];
    const rows = await prisma.customer.findMany({
      where: { id: { in: customerIds }, deletedAt: null },
      select: customerSelect,
    });
    return rows.map(mapCustomer);
  },
};
