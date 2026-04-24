import { ReceiptControlMock } from "@/components/workflows/business-mocks";
import { requireRoutePermission } from "@/lib/route-access";

export default async function ReceiptControlPage() {
  await requireRoutePermission(["view_payment_control"]);
  return <ReceiptControlMock />;
}
