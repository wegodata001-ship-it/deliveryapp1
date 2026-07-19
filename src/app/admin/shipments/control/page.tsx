import { requireRoutePermission } from "@/lib/route-access";
import { getShipmentControlDataAction } from "@/app/admin/shipments/control/actions";
import { ShipmentControlClient } from "@/components/admin/shipments/ShipmentControlClient";
import "@/app/admin/shipments/shipments.css";

export const dynamic = "force-dynamic";

export default async function ShipmentControlPage() {
  const user = await requireRoutePermission(["manage_shipments", "view_shipments"]);

  const res = await getShipmentControlDataAction({});
  if (!res.ok) {
    return (
      <div style={{ padding: 32, color: "#dc2626" }}>
        שגיאה בטעינת נתונים: {res.error}
      </div>
    );
  }

  return (
    <ShipmentControlClient
      initialData={res.data}
      generatedBy={user.fullName}
    />
  );
}
