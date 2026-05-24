import { CustomerCardPageClient } from "@/app/admin/customer-card/CustomerCardPageClient";
import { getCachedCustomerCardSnapshot } from "@/lib/customer-card-snapshot-cache";
import { requireRoutePermission } from "@/lib/route-access";

export default async function CustomerCardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoutePermission(["view_customer_card"]);
  const sp = await searchParams;
  const customerId = typeof sp.customerId === "string" ? sp.customerId.trim() || null : null;
  const customerName = typeof sp.name === "string" ? sp.name.trim() || null : null;
  const initialTab = sp.tab === "ledger" ? ("ledger" as const) : ("details" as const);

  const initialSnap = customerId ? await getCachedCustomerCardSnapshot(customerId) : null;

  return (
    <CustomerCardPageClient
      customerId={customerId}
      customerName={customerName}
      initialTab={initialTab}
      initialSnap={initialSnap}
    />
  );
}
