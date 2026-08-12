import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { shipmentCountrySlugFromWorkCountry } from "@/lib/shipment-country-scope.shared";

/** Legacy combined view — redirect to country-scoped route using first batch's country */
export default async function ShipmentCombinedPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const sp = await searchParams;
  const batchIds = (sp.ids ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (batchIds.length === 0) {
    redirect("/admin/shipments/turkey");
  }

  const batch = await prisma.shipmentBatch.findFirst({
    where: { id: { in: batchIds } },
    select: { countryCode: true },
    orderBy: { createdAt: "asc" },
  });

  const slug = shipmentCountrySlugFromWorkCountry(batch?.countryCode ?? "TR");
  redirect(`/admin/shipments/${slug}/combined?ids=${encodeURIComponent(sp.ids ?? "")}`);
}
