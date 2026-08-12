import "server-only";

import type { Prisma } from "@prisma/client";
import { notFound } from "next/navigation";
import {
  SHIPMENT_COUNTRY_SLUGS,
  buildShipmentCountryContext,
  isShipmentCountrySlug,
  resolveShipmentNavHref,
  shipmentBatchNumberKey,
  shipmentCountryBasePath,
  shipmentCountrySlugFromPathname,
  shipmentCountrySlugFromWorkCountry,
  workCountryFromShipmentSlug,
  type ShipmentCountryContext,
  type ShipmentCountrySlug,
} from "@/lib/shipment-country-scope.shared";
import { resolveWorkCountryParam } from "@/lib/country-data-scope";
import type { WorkCountryCode } from "@/lib/work-country";

export {
  SHIPMENT_COUNTRY_SLUGS,
  buildShipmentCountryContext,
  isShipmentCountrySlug,
  shipmentBatchNumberKey,
  shipmentCountryBasePath,
  shipmentCountrySlugFromPathname,
  shipmentCountrySlugFromWorkCountry,
  workCountryFromShipmentSlug,
  resolveShipmentNavHref,
  type ShipmentCountryContext,
  type ShipmentCountrySlug,
};

/** Resolve country from route slug — throws notFound() if invalid */
export function requireShipmentCountryFromSlug(slug: string): ShipmentCountryContext {
  const workCountry = workCountryFromShipmentSlug(slug);
  if (!workCountry) notFound();
  return buildShipmentCountryContext(workCountry);
}

export function requireShipmentCountryScope(
  workCountry: WorkCountryCode | string | null | undefined,
): ShipmentCountryContext {
  return buildShipmentCountryContext(resolveWorkCountryParam(workCountry));
}

export function shipmentBatchWhere(workCountry: WorkCountryCode): Prisma.ShipmentBatchWhereInput {
  return { countryCode: workCountry };
}

export function shipmentRecordWhere(workCountry: WorkCountryCode): Prisma.ShipmentRecordWhereInput {
  return { batch: { countryCode: workCountry } };
}

export function shipmentCashDayWhere(workCountry: WorkCountryCode): Prisma.ShipmentCashDayWhereInput {
  return { countryCode: workCountry };
}

export function shipmentZoneWhere(workCountry: WorkCountryCode): Prisma.ShipmentDeliveryZoneWhereInput {
  return { countryCode: workCountry };
}

export function shipmentCourierWhere(workCountry: WorkCountryCode): Prisma.ShipmentCourierWhereInput {
  return { countryCode: workCountry };
}

export function deliveryLocationWhere(workCountry: WorkCountryCode): Prisma.DeliveryLocationWhereInput {
  return { countryCode: workCountry };
}

export function manualShipmentWhere(workCountry: WorkCountryCode): Prisma.ManualShipmentWhereInput {
  return { countryCode: workCountry };
}

/** Guard — batch must belong to active country or 404 */
export async function assertShipmentBatchCountry(
  batchId: string,
  workCountry: WorkCountryCode,
  findBatch: (id: string) => Promise<{ countryCode: WorkCountryCode } | null>,
): Promise<void> {
  const batch = await findBatch(batchId);
  if (!batch || batch.countryCode !== workCountry) {
    notFound();
  }
}
