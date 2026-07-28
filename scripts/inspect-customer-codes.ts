import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const codes = ["21932", "64862", "28237", "4178"];
  for (const code of codes) {
    const c = await p.customer.findFirst({
      where: { customerCode: { equals: code, mode: "insensitive" }, deletedAt: null },
      select: { id: true, customerCode: true, displayName: true, balanceUsd: true, countryCode: true },
    });
    console.log(code, c);
  }
  const total = await p.customer.count({ where: { deletedAt: null } });
  console.log("total customers", total);
  const any = await p.customer.findMany({
    where: { deletedAt: null, customerCode: { not: null } },
    take: 5,
    select: { customerCode: true, displayName: true, balanceUsd: true },
  });
  console.log("sample", any);

  // how many shipment codes match customers?
  const shipCodes = await p.shipmentRecord.findMany({
    where: { customerCode: { not: null } },
    select: { customerCode: true },
    distinct: ["customerCode"],
  });
  let matched = 0;
  let withSnap = 0;
  for (const s of shipCodes.slice(0, 100)) {
    const c = await p.customer.findFirst({
      where: {
        deletedAt: null,
        customerCode: { equals: s.customerCode!, mode: "insensitive" },
      },
      select: { balanceUsd: true },
    });
    if (c) {
      matched++;
      if (Number(c.balanceUsd) !== 0) withSnap++;
    }
  }
  console.log({
    distinctShipCodesSampled: Math.min(100, shipCodes.length),
    matchedCustomers: matched,
    withNonZeroBalanceUsd: withSnap,
    totalDistinctShipCodes: shipCodes.length,
  });
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
