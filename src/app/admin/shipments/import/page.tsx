import { redirect } from "next/navigation";
import { DEFAULT_WORK_COUNTRY } from "@/lib/work-country";
import { shipmentCountrySlugFromWorkCountry } from "@/lib/shipment-country-scope.shared";

/** Redirect legacy flat routes → Turkey (historical default) */
export default function LegacyShipmentImportRedirect() {
  redirect(`/admin/shipments/${shipmentCountrySlugFromWorkCountry(DEFAULT_WORK_COUNTRY)}/import`);
}
