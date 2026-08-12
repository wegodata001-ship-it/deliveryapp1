import {
  DEFAULT_WORK_COUNTRY,
  normalizeWorkCountryCode,
  workCountryLabel,
  workEnvironmentLabelHe,
  type WorkCountryCode,
} from "@/lib/work-country";

/** Slugs ב-URL — /admin/shipments/turkey */
export const SHIPMENT_COUNTRY_SLUGS = ["turkey", "china", "uae"] as const;

export type ShipmentCountrySlug = (typeof SHIPMENT_COUNTRY_SLUGS)[number];

const SLUG_TO_WORK: Record<ShipmentCountrySlug, WorkCountryCode> = {
  turkey: "TR",
  china: "CN",
  uae: "AE",
};

const WORK_TO_SLUG: Record<WorkCountryCode, ShipmentCountrySlug> = {
  TR: "turkey",
  CN: "china",
  AE: "uae",
};

export type ShipmentCountryContext = {
  workCountry: WorkCountryCode;
  slug: ShipmentCountrySlug;
  label: string;
  environmentLabel: string;
  basePath: string;
};

export function isShipmentCountrySlug(raw: string | null | undefined): raw is ShipmentCountrySlug {
  return SHIPMENT_COUNTRY_SLUGS.includes(raw as ShipmentCountrySlug);
}

export function workCountryFromShipmentSlug(
  slug: string | null | undefined,
): WorkCountryCode | null {
  if (!isShipmentCountrySlug(slug)) return null;
  return SLUG_TO_WORK[slug];
}

export function shipmentCountrySlugFromWorkCountry(
  workCountry: WorkCountryCode | string | null | undefined,
): ShipmentCountrySlug {
  const wc = normalizeWorkCountryCode(workCountry) ?? DEFAULT_WORK_COUNTRY;
  return WORK_TO_SLUG[wc];
}

export function shipmentCountryBasePath(slug: ShipmentCountrySlug): string {
  return `/admin/shipments/${slug}`;
}

export function buildShipmentCountryContext(workCountry: WorkCountryCode): ShipmentCountryContext {
  const slug = shipmentCountrySlugFromWorkCountry(workCountry);
  return {
    workCountry,
    slug,
    label: workCountryLabel(workCountry),
    environmentLabel: workEnvironmentLabelHe(workCountry),
    basePath: shipmentCountryBasePath(slug),
  };
}

/** מזהה slug מה-path — /admin/shipments/turkey/... */
export function shipmentCountrySlugFromPathname(pathname: string | null | undefined): ShipmentCountrySlug | null {
  const m = /^\/admin\/shipments\/([^/]+)/.exec(pathname ?? "");
  if (!m?.[1]) return null;
  return isShipmentCountrySlug(m[1]) ? m[1] : null;
}

export function resolveShipmentNavHref(
  href: string,
  pathname: string | null | undefined,
): string {
  if (!href.startsWith("/admin/shipments/") || href === "/admin/shipments") {
    return href;
  }
  const slug = shipmentCountrySlugFromPathname(pathname);
  if (!slug) return "/admin/shipments";
  const suffix = href.replace(/^\/admin\/shipments\/?/, "");
  if (!suffix || suffix === slug) {
    return shipmentCountryBasePath(slug);
  }
  return `${shipmentCountryBasePath(slug)}/${suffix}`;
}

export function shipmentBatchNumberKey(workCountry: WorkCountryCode): string {
  return `${workCountry}|SHP`;
}
