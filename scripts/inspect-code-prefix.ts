import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const codes = ["21932", "64862", "28237", "4178", "37090"];
  for (const code of codes) {
    const byAts = await p.customer.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { customerCode: { equals: `ATS${code}`, mode: "insensitive" } },
          { oldCustomerCode: { equals: code, mode: "insensitive" } },
          { customerCode: { endsWith: code, mode: "insensitive" } },
        ],
      },
      select: {
        customerCode: true,
        oldCustomerCode: true,
        displayName: true,
        balanceUsd: true,
      },
    });
    console.log(code, byAts);
  }

  const withBal = await p.customer.findMany({
    where: { deletedAt: null, NOT: { balanceUsd: 0 } },
    take: 10,
    select: { customerCode: true, oldCustomerCode: true, displayName: true, balanceUsd: true },
    orderBy: { balanceUsd: "desc" },
  });
  console.log("customers with balanceUsd != 0", withBal);
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
