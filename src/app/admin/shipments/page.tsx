import Link from "next/link";
import { requireRoutePermission } from "@/lib/route-access";
import {
  SHIPMENT_COUNTRY_SLUGS,
  shipmentCountryBasePath,
  workCountryFromShipmentSlug,
} from "@/lib/shipment-country-scope.shared";
import { workCountryLabel } from "@/lib/work-country";
import "@/app/admin/shipments/shipments.css";

export const dynamic = "force-dynamic";

export default async function ShipmentsCountryPickerPage() {
  await requireRoutePermission(["manage_shipments", "view_shipments"]);

  return (
    <div className="shp-country-picker">
      <header className="shp-country-picker__head">
        <h1 className="shp-country-picker__title">מערכת משלוחים</h1>
        <p className="shp-country-picker__sub">
          בחרו מדינה — כל מדינה היא מערכת משלוחים עצמאית (נתונים, יבוא, בקרה ודוחות נפרדים).
        </p>
      </header>
      <div className="shp-country-picker__grid">
        {SHIPMENT_COUNTRY_SLUGS.map((slug) => {
          const wc = workCountryFromShipmentSlug(slug)!;
          return (
            <Link
              key={slug}
              href={shipmentCountryBasePath(slug)}
              className="shp-country-picker__card"
            >
              <span className="shp-country-picker__card-label">{workCountryLabel(wc)}</span>
              <span className="shp-country-picker__card-hint">כניסה למערכת</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
