import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const aliases = await p.deliveryLocationAlias.count({ where: { isActive: true } });
  const locs = await p.deliveryLocation.count({ where: { isActive: true } });
  const zones = await p.shipmentDeliveryZone.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    take: 30,
  });
  const total = await p.shipmentRecord.count();
  const withZone = await p.shipmentRecord.count({ where: { zoneId: { not: null } } });
  const sample = await p.shipmentRecord.findMany({
    take: 12,
    select: {
      city: true,
      originalDeliveryLocation: true,
      zoneId: true,
      customerCode: true,
      locationMatchStatus: true,
      zone: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const aliasSample = await p.deliveryLocationAlias.findMany({
    take: 15,
    where: { isActive: true },
    include: {
      deliveryLocation: {
        select: {
          displayName: true,
          distributionAreaId: true,
          distributionArea: { select: { name: true, isActive: true } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  console.log(
    JSON.stringify(
      {
        aliases,
        locs,
        zones: zones.map((z) => z.name),
        total,
        withZone,
        sample,
        aliasSample: aliasSample.map((a) => ({
          original: a.originalName,
          display: a.deliveryLocation.displayName,
          zone: a.deliveryLocation.distributionArea?.name ?? null,
          zoneActive: a.deliveryLocation.distributionArea?.isActive ?? false,
          areaId: a.deliveryLocation.distributionAreaId,
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
