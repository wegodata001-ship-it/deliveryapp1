import { resolveDeliveryLocation } from "../src/lib/delivery-location-match";
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const samples = [
    "RAHAT Rahat",
    "MAGD ALKRUM Majd Kroum",
    "khalil",
    "bir el maksur Bir El maksur",
    "كفر مندا kofr Manda",
    "Nasrah",
  ];
  for (const s of samples) {
    const m = await resolveDeliveryLocation({ city: s, address: s });
    console.log(
      JSON.stringify({
        input: s,
        status: m.status,
        city: m.city,
        zone: m.zoneName,
        zoneId: m.zoneId,
        suggestion: m.suggestionDisplayName,
      }),
    );
  }

  // alias hits for rahat
  const rahat = await p.deliveryLocationAlias.findMany({
    where: {
      OR: [
        { originalName: { contains: "Rahat", mode: "insensitive" } },
        { originalName: { contains: "רהט" } },
        { normalizedOriginalName: { contains: "rahat" } },
      ],
    },
    take: 10,
    include: {
      deliveryLocation: {
        select: { displayName: true, distributionArea: { select: { name: true } } },
      },
    },
  });
  console.log(
    "rahat aliases",
    rahat.map((a) => ({
      o: a.originalName,
      n: a.normalizedOriginalName,
      d: a.deliveryLocation.displayName,
      z: a.deliveryLocation.distributionArea?.name,
    })),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
