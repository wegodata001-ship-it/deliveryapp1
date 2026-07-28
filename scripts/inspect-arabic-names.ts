import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const withAr = await p.customer.count({
    where: { deletedAt: null, NOT: { nameAr: null }, nameAr: { not: "" } },
  });
  const total = await p.customer.count({ where: { deletedAt: null } });
  const sample = await p.customer.findMany({
    where: { deletedAt: null, NOT: { nameAr: null }, nameAr: { not: "" } },
    take: 8,
    select: { customerCode: true, nameAr: true, displayName: true, nameHe: true },
  });
  const locs = await p.deliveryLocation.findMany({
    take: 15,
    select: {
      displayName: true,
      aliases: { take: 3, select: { originalName: true } },
    },
  });
  console.log(JSON.stringify({ withAr, total, sample, locs }, null, 2));
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
