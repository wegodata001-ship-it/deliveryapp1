import { requireRoutePermission } from "@/lib/route-access";
import { isAdminUser } from "@/lib/admin-auth";
import { requireShipmentCountryFromSlug } from "@/lib/shipment-country-scope";
import { listCouriers, listShipmentBatches, listZones } from "@/app/admin/shipments/service";
import { loadShipmentCashControl } from "@/app/admin/shipments/cash-control/service";
import { ShipmentListClient } from "@/components/admin/shipments/ShipmentListClient";
import "@/app/admin/shipments/shipments.css";

export const dynamic = "force-dynamic";

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

export default async function ShipmentsCountryListPage({
  params,
  searchParams,
}: {
  params: Promise<{ countrySlug: string }>;
  searchParams?: Promise<{ view?: string }>;
}) {
  const user = await requireRoutePermission(["manage_shipments", "view_shipments"]);
  const { countrySlug } = await params;
  const { workCountry } = requireShipmentCountryFromSlug(countrySlug);
  const sp = (await searchParams) ?? {};
  const initialView = sp.view === "cash-control" ? "cash-control" : "list";
  const dayDate = todayYmd();

  const [batches, zones, couriers, cashControl] = await Promise.all([
    listShipmentBatches(workCountry),
    listZones(workCountry),
    listCouriers(workCountry),
    loadShipmentCashControl({ dayDate, workCountry }),
  ]);

  return (
    <ShipmentListClient
      initialBatches={batches}
      initialZones={zones}
      initialCouriers={couriers}
      initialView={initialView}
      cashControlInitialData={cashControl}
      cashControlDayDate={dayDate}
      viewerIsAdmin={isAdminUser(user)}
    />
  );
}
