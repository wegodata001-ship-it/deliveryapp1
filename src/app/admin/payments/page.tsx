import { PaymentsDeepLinkClient } from "@/app/admin/payments/PaymentsDeepLinkClient";
import { requireRoutePermission } from "@/lib/route-access";

export default async function AdminPaymentsDeepLinkPage() {
  await requireRoutePermission(["receive_payments"]);
  return <PaymentsDeepLinkClient />;
}
