import { CustomerLedgerMock } from "@/components/workflows/business-mocks";
import { requireRoutePermission } from "@/lib/route-access";

export default async function CustomerCardPage() {
  await requireRoutePermission(["view_customer_card"]);
  return <CustomerLedgerMock />;
}
