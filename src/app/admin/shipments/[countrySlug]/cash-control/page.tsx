import { requireRoutePermission } from "@/lib/route-access";
import { isAdminUser } from "@/lib/admin-auth";
import { requireShipmentCountryFromSlug } from "@/lib/shipment-country-scope";
import { CashControlClient } from "@/components/admin/CashControlDailyClient";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";

export const dynamic = "force-dynamic";

export default async function ShipmentCashControlPage({
  params,
}: {
  params: Promise<{ countrySlug: string }>;
}) {
  const me = await requireRoutePermission(["manage_shipments", "view_shipments"]);
  const { countrySlug } = await params;
  const { workCountry } = requireShipmentCountryFromSlug(countrySlug);

  return (
    <CashControlClient
      mode="shipping"
      isAdmin={isAdminUser(me)}
      initialWeek={ACTIVE_WORK_WEEK_CODE}
      currentUserName={me.fullName?.trim() || me.email || ""}
      shipmentWorkCountry={workCountry}
    />
  );
}
