import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const cnt = await p.deliveryLocation.count();
  const ac = await p.deliveryLocationAlias.count();
  const zc = await p.shipmentDeliveryZone.count();
  console.log({ locations: cnt, aliases: ac, zones: zc });

  const aliases = await p.deliveryLocationAlias.findMany({
    take: 20,
    orderBy: { updatedAt: "desc" },
    include: {
      deliveryLocation: {
        select: {
          displayName: true,
          distributionArea: { select: { name: true } },
        },
      },
    },
  });
  for (const a of aliases) {
    console.log(
      `${a.originalName} => ${a.deliveryLocation.displayName} | zone=${a.deliveryLocation.distributionArea?.name ?? "NULL"}`,
    );
  }

  const zoneLike = await p.deliveryLocation.findMany({
    where: {
      OR: [
        { displayName: { startsWith: "צפון" } },
        { displayName: { startsWith: "דרום" } },
        { displayName: { startsWith: "מרכז" } },
        { displayName: { startsWith: "משולש" } },
      ],
    },
    select: { displayName: true },
  });
  console.log("zone-like locations", zoneLike.length, zoneLike.slice(0, 15));
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
