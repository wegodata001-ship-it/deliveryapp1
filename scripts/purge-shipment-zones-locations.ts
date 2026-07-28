/**
 * ניקוי בטוח: מוחק אזורים=יישובים ויישובים=אזורים מהייבוא השגוי.
 * הרצה: npx tsx scripts/purge-shipment-zones-locations.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const AREA_PREFIX =
  /^(צפון|דרום|מרכז|משולש|שרון|גולן|ירושלים|חיפה|נגב|עמק|גליל|north|south|center|triangle)\s*[-_]?\s*\d+/i;

function looksLikeDistributionArea(name: string) {
  const t = name.trim();
  if (!t) return false;
  if (AREA_PREFIX.test(t)) return true;
  return /^(צפון|דרום|מרכז|משולש)\d+$/i.test(t);
}

async function main() {
  const zones = await prisma.shipmentDeliveryZone.findMany({ select: { id: true, name: true } });
  const fakeZones = zones.filter((z) => !looksLikeDistributionArea(z.name));
  const realZones = zones.filter((z) => looksLikeDistributionArea(z.name));
  console.log({ totalZones: zones.length, fakeZones: fakeZones.length, realZones: realZones.length });
  console.log(
    "sample fake:",
    fakeZones.slice(0, 8).map((z) => z.name),
  );
  console.log(
    "sample real:",
    realZones.slice(0, 8).map((z) => z.name),
  );

  const fakeIds = fakeZones.map((z) => z.id);
  if (fakeIds.length) {
    await prisma.shipmentRecord.updateMany({
      where: { zoneId: { in: fakeIds } },
      data: { zoneId: null },
    });
    await prisma.deliveryLocation.updateMany({
      where: { distributionAreaId: { in: fakeIds } },
      data: { distributionAreaId: null },
    });
    await prisma.shipmentDeliveryZone.deleteMany({ where: { id: { in: fakeIds } } });
  }

  const locs = await prisma.deliveryLocation.findMany({ select: { id: true, displayName: true } });
  const zoneNamed = locs.filter((l) => looksLikeDistributionArea(l.displayName));
  console.log({ zoneNamedLocations: zoneNamed.length, sample: zoneNamed.slice(0, 8).map((l) => l.displayName) });
  const zoneNamedIds = zoneNamed.map((l) => l.id);
  if (zoneNamedIds.length) {
    await prisma.shipmentRecord.updateMany({
      where: { deliveryLocationId: { in: zoneNamedIds } },
      data: { deliveryLocationId: null, locationMatchStatus: "UNMATCHED" },
    });
    await prisma.deliveryLocationAlias.deleteMany({
      where: { deliveryLocationId: { in: zoneNamedIds } },
    });
    await prisma.deliveryLocationAudit.deleteMany({
      where: { deliveryLocationId: { in: zoneNamedIds } },
    });
    await prisma.deliveryLocation.deleteMany({ where: { id: { in: zoneNamedIds } } });
  }

  console.log("done", {
    deletedFakeZones: fakeIds.length,
    deletedZoneNamedLocations: zoneNamedIds.length,
    keptRealZones: realZones.length,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
