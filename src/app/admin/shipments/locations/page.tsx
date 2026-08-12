import { redirect } from "next/navigation";
import { DEFAULT_WORK_COUNTRY } from "@/lib/work-country";
import { shipmentCountrySlugFromWorkCountry } from "@/lib/shipment-country-scope.shared";

export default function LegacyShipmentLocationsRedirect() {
  redirect(`/admin/shipments/${shipmentCountrySlugFromWorkCountry(DEFAULT_WORK_COUNTRY)}/locations`);
}
