import { ReceiptControlClient } from "@/components/admin/ReceiptControlClient";
import { requireRoutePermission } from "@/lib/route-access";

export default async function ReceiptControlPage() {
  await requireRoutePermission(["view_payment_control"]);
  return <ReceiptControlClient />;
}
