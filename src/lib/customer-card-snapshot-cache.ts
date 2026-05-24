import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { CustomerCardSnapshot } from "@/app/admin/capture/actions";

const CUSTOMER_CARD_SELECT = {
  id: true,
  displayName: true,
  nameAr: true,
  nameHe: true,
  nameEn: true,
  customerCode: true,
  phone: true,
  phone2: true,
  country: true,
  email: true,
  city: true,
  address: true,
  customerType: true,
} as const;

async function loadCustomerCardSnapshot(customerId: string): Promise<CustomerCardSnapshot | null> {
  const id = customerId.trim();
  if (!id) return null;

  const cust = await prisma.customer.findFirst({
    where: { id, deletedAt: null, isActive: true },
    select: CUSTOMER_CARD_SELECT,
  });
  if (!cust) return null;

  return {
    id: cust.id,
    displayName: cust.displayName,
    nameAr: cust.nameAr,
    nameHe: cust.nameHe,
    nameEn: cust.nameEn,
    customerCode: cust.customerCode,
    phone: cust.phone,
    phone2: cust.phone2,
    country: cust.country,
    email: cust.email,
    city: cust.city,
    address: cust.address,
    customerType: cust.customerType,
    orderCount: 0,
    ordersUsdSum: "0.00",
    recentOrders: [],
  };
}

export function getCachedCustomerCardSnapshot(customerId: string) {
  const id = customerId.trim();
  return unstable_cache(() => loadCustomerCardSnapshot(id), ["customer-card-snapshot", id], {
    revalidate: 45,
    tags: [`customer-card-snapshot-${id}`],
  })();
}

export function customerCardSnapshotTag(customerId: string): string {
  return `customer-card-snapshot-${customerId.trim()}`;
}

export { loadCustomerCardSnapshot };
