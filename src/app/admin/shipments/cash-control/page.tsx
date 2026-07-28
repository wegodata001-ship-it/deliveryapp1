import { requireRoutePermission } from "@/lib/route-access";
import { ShipmentCashControlClient } from "@/components/admin/shipments/ShipmentCashControlClientV2";
import "@/app/admin/shipments/shipments.css";

export const dynamic = "force-dynamic";

export default async function ShipmentCashControlPage() {
  await requireRoutePermission(["manage_shipments", "view_shipments"]);
  return <ShipmentCashControlClient />;
}
