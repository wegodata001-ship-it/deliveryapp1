import { PrismaClient } from "@prisma/client";
import {
  loadAliasLookupMap,
  resolveUpdatedDeliveryLocationDisplay,
} from "@/lib/delivery-location-match";
import { getEffectiveDeliveryAddress } from "@/lib/shipment-delivery-place";

const prisma = new PrismaClient();

async function main() {
  const maps = await loadAliasLookupMap();

  const records = await prisma.shipmentRecord.findMany({
    where: {
      OR: [
        { locationMatchStatus: "MATCHED" },
        { locationMatchStatus: "MANUALLY_FIXED" },
        { deliveryLocationId: { not: null } },
      ],
    },
    take: 30,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      originalDeliveryLocation: true,
      city: true,
      address: true,
      locationMatchStatus: true,
      deliveryLocationId: true,
      deliveryLocation: { select: { displayName: true } },
      zone: { select: { name: true } },
    },
  });

  console.log("Original Address | Updated Address | Displayed Address | Distribution Area | OK?");
  console.log("-".repeat(100));

  let badgeCount = 0;
  for (const r of records) {
    const locationInput = {
      originalDeliveryLocation: r.originalDeliveryLocation,
      city: r.city,
      address: r.address,
      deliveryLocationId: r.deliveryLocationId,
      deliveryLocation: r.deliveryLocation,
    };
    const updatedSSOT = resolveUpdatedDeliveryLocationDisplay(locationInput, maps);
    const addr = getEffectiveDeliveryAddress({
      address: r.address,
      originalDeliveryLocation: r.originalDeliveryLocation,
      updatedDeliveryLocation: updatedSSOT,
      city: r.city,
      locationMatchStatus: r.locationMatchStatus as "MATCHED" | "MANUALLY_FIXED" | "UNMATCHED" | null,
    });

    if (!addr.isPlaceUpdated) continue;
    badgeCount += 1;
    if (badgeCount > 8) continue;

    const ok =
      !addr.isPlaceUpdated || (updatedSSOT != null && addr.display === updatedSSOT);
    console.log(
      [
        r.originalDeliveryLocation ?? "—",
        updatedSSOT ?? "—",
        addr.display,
        r.zone?.name ?? "—",
        ok ? "OK" : "MISMATCH",
      ].join(" | "),
    );
  }

  const noUpdate = await prisma.shipmentRecord.findFirst({
    where: {
      locationMatchStatus: "UNMATCHED",
      deliveryLocationId: null,
      originalDeliveryLocation: { not: null },
    },
    select: {
      originalDeliveryLocation: true,
      city: true,
      address: true,
      locationMatchStatus: true,
    },
  });

  const messy = await prisma.shipmentRecord.findMany({
    where: { city: { contains: "," } },
    take: 5,
    select: {
      originalDeliveryLocation: true,
      city: true,
      address: true,
      locationMatchStatus: true,
      deliveryLocationId: true,
      deliveryLocation: { select: { displayName: true } },
      zone: { select: { name: true } },
    },
  });

  if (messy.length > 0) {
    console.log("-".repeat(100));
    console.log("MESSY CITY ROWS:");
    for (const r of messy) {
      const locationInput = {
        originalDeliveryLocation: r.originalDeliveryLocation,
        city: r.city,
        address: r.address,
        deliveryLocationId: r.deliveryLocationId,
        deliveryLocation: r.deliveryLocation,
      };
      const updatedSSOT = resolveUpdatedDeliveryLocationDisplay(locationInput, maps);
      const addr = getEffectiveDeliveryAddress({
        address: r.address,
        originalDeliveryLocation: r.originalDeliveryLocation,
        updatedDeliveryLocation: updatedSSOT,
        city: r.city,
        locationMatchStatus: r.locationMatchStatus as "MATCHED" | "MANUALLY_FIXED" | "UNMATCHED" | null,
      });
      const ok =
        !addr.isPlaceUpdated || (updatedSSOT != null && addr.display === updatedSSOT);
      console.log(
        [
          r.originalDeliveryLocation ?? "—",
          updatedSSOT ?? "—",
          addr.display,
          r.zone?.name ?? "—",
          ok ? "OK" : "MISMATCH",
        ].join(" | "),
      );
    }
  }

  if (noUpdate) {
    const updatedSSOT = resolveUpdatedDeliveryLocationDisplay(
      { ...noUpdate, deliveryLocationId: null, deliveryLocation: null },
      maps,
    );
    const addr = getEffectiveDeliveryAddress({
      ...noUpdate,
      updatedDeliveryLocation: updatedSSOT,
    });
    console.log("-".repeat(100));
    console.log("NO-UPDATE ROW:");
    console.log(
      [
        noUpdate.originalDeliveryLocation ?? "—",
        updatedSSOT ?? "—",
        addr.display,
        "—",
        !addr.isPlaceUpdated ? "OK" : "UNEXPECTED BADGE",
      ].join(" | "),
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
