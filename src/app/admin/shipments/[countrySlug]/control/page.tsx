import { requireRoutePermission } from "@/lib/route-access";
import { requireShipmentCountryFromSlug } from "@/lib/shipment-country-scope";
import { getShipmentControlDataAction } from "@/app/admin/shipments/control/actions";
import { ShipmentControlClient } from "@/components/admin/shipments/ShipmentControlClient";
import "@/app/admin/shipments/shipments.css";

export const dynamic = "force-dynamic";

export default async function ShipmentControlPage({
  params,
}: {
  params: Promise<{ countrySlug: string }>;
}) {
  const user = await requireRoutePermission(["manage_shipments", "view_shipments"]);
  const { countrySlug } = await params;
  const { workCountry } = requireShipmentCountryFromSlug(countrySlug);

  const res = await getShipmentControlDataAction({ workCountry });
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
