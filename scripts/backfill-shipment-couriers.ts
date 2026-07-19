import { prisma } from "@/lib/prisma";

async function main() {
  const rows = await prisma.shipmentRecord.findMany({
    where: {
      courierId: null,
      courierName: { not: null },
    },
    select: { courierName: true },
    distinct: ["courierName"],
  });

  let linked = 0;
  for (const row of rows) {
    const name = row.courierName?.trim();
    if (!name) continue;

    const courier = await prisma.shipmentCourier.upsert({
      where: { name },
      update: { isActive: true },
      create: {
        name,
        sortOrder: await prisma.shipmentCourier.count(),
      },
    });
    const result = await prisma.shipmentRecord.updateMany({
      where: { courierId: null, courierName: name },
      data: { courierId: courier.id },
    });
    linked += result.count;
  }

  console.log(JSON.stringify({ courierNames: rows.length, linkedRecords: linked }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
