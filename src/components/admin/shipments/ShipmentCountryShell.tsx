"use client";

import Link from "next/link";
import type { ShipmentCountryContext } from "@/lib/shipment-country-scope.shared";
import type { ReactNode } from "react";

const SUB_NAV = [
  { suffix: "", label: "משלוחים" },
  { suffix: "import", label: "ייבוא" },
  { suffix: "manual", label: "הזנה ידנית" },
  { suffix: "control", label: "בקרת משלוחים" },
  { suffix: "locations", label: "אזורי חלוקה" },
  { suffix: "cash-control", label: "בקרת קופה" },
] as const;

export function ShipmentCountryShell({
  country,
  children,
}: {
  country: ShipmentCountryContext;
  children: ReactNode;
}) {
  return (
    <div className="shp-country-shell">
      <div className="shp-country-shell__bar">
        <div className="shp-country-shell__crumb">
          <Link href="/admin/shipments" className="shp-country-shell__back">
            מערכת משלוחים
          </Link>
          <span aria-hidden>/</span>
          <span className="shp-country-shell__active">{country.environmentLabel}</span>
        </div>
        <nav className="shp-country-shell__nav" aria-label="ניווט משלוחים">
          {SUB_NAV.map((item) => {
            const href = item.suffix
              ? `${country.basePath}/${item.suffix}`
              : country.basePath;
            return (
              <Link key={item.suffix || "list"} href={href} className="shp-country-shell__link">
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {children}
    </div>
  );
}
