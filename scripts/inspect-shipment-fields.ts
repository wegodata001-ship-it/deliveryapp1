import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const s = await p.shipmentRecord.findMany({
    take: 8,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      city: true,
      address: true,
      originalDeliveryLocation: true,
      customerName: true,
      customerCode: true,
      notes: true,
      boxes: true,
      deliveryFeeIls: true,
    },
  });
  console.log("sample", JSON.stringify(s, null, 2));

  const withCity = await p.shipmentRecord.count({ where: { city: { not: null } } });
  const withAddr = await p.shipmentRecord.count({
    where: { AND: [{ address: { not: null } }, { NOT: { address: "" } }] },
  });
  const withOrig = await p.shipmentRecord.count({
    where: { originalDeliveryLocation: { not: null } },
  });
  const nonemptyCity = await p.shipmentRecord.count({
    where: { AND: [{ city: { not: null } }, { NOT: { city: "" } }] },
  });

  console.log({ withCity, nonemptyCity, withAddr, withOrig });

  const addrSample = await p.shipmentRecord.findMany({
    where: { address: { not: null } },
    take: 10,
    select: { address: true, city: true, originalDeliveryLocation: true, customerCode: true },
  });
  console.log("addrSample", JSON.stringify(addrSample, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
