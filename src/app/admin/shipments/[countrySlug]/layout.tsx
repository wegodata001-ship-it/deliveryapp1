import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  isShipmentCountrySlug,
  requireShipmentCountryFromSlug,
  shipmentCountrySlugFromWorkCountry,
} from "@/lib/shipment-country-scope";
import { ShipmentCountryProvider } from "@/components/admin/shipments/ShipmentCountryProvider";
import { ShipmentCountryShell } from "@/components/admin/shipments/ShipmentCountryShell";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ShipmentCountryLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ countrySlug: string }>;
}) {
  const { countrySlug } = await params;

  /** Legacy /admin/shipments/{batchUuid} → country-scoped batch URL */
  if (UUID_RE.test(countrySlug)) {
    const batch = await prisma.shipmentBatch.findUnique({
      where: { id: countrySlug },
      select: { countryCode: true },
    });
    if (!batch) notFound();
    redirect(
      `/admin/shipments/${shipmentCountrySlugFromWorkCountry(batch.countryCode)}/${countrySlug}`,
    );
  }

  if (!isShipmentCountrySlug(countrySlug)) notFound();
  const ctx = requireShipmentCountryFromSlug(countrySlug);

  return (
    <ShipmentCountryProvider workCountry={ctx.workCountry}>
      <ShipmentCountryShell country={ctx}>{children}</ShipmentCountryShell>
    </ShipmentCountryProvider>
  );
}
