/**
 * Backfill אזורי חלוקה למשלוחים קיימים לפי טבלת ההתאמות.
 * הרצה: npx tsx scripts/backfill-shipment-zones.ts
 */
import { PrismaClient } from "@prisma/client";
import { backfillShipmentDistributionZones } from "../src/app/admin/shipments/location-service";

async function main() {
  const p = new PrismaClient();
  const total = await p.shipmentRecord.count();
  const withZoneBefore = await p.shipmentRecord.count({
    where: { zoneId: { not: null } },
  });
  console.log(`Before: ${withZoneBefore}/${total} with zone`);

  const result = await backfillShipmentDistributionZones({ onlyMissingZone: true });
  console.log("Backfill result:", result);

  const withZoneAfter = await p.shipmentRecord.count({
    where: { zoneId: { not: null } },
  });
  const sample = await p.shipmentRecord.findMany({
    where: { zoneId: { not: null } },
    take: 12,
    select: {
      customerCode: true,
      address: true,
      originalDeliveryLocation: true,
      city: true,
      zone: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  console.log(`After: ${withZoneAfter}/${total} with zone`);
  console.log("sample", JSON.stringify(sample, null, 2));
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
