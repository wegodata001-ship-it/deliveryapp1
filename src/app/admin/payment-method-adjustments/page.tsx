import { PaymentMethodAdjustmentsClient } from "@/components/admin/PaymentMethodAdjustmentsClient";
import { requireRoutePermission } from "@/lib/route-access";

export default async function PaymentMethodAdjustmentsPage() {
  await requireRoutePermission(["manage_users"]);
  return <PaymentMethodAdjustmentsClient />;
}
