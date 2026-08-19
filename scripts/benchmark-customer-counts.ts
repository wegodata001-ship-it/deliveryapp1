import { performance } from "node:perf_hooks";
import { prisma } from "../src/lib/prisma";

async function main() {
  const t0 = performance.now();
  const [total, withCode] = await Promise.all([
    prisma.customer.count({ where: { deletedAt: null } }),
    prisma.customer.count({ where: { deletedAt: null, customerCode: { not: null } } }),
  ]);
  console.log("customers", { total, withCode, countMs: Math.round(performance.now() - t0) });

  const t1 = performance.now();
  const indexRows = await prisma.customer.findMany({
    where: { isActive: true, deletedAt: null, countryCode: "TR" },
    select: { id: true, customerCode: true, displayName: true },
    orderBy: [{ updatedAt: "desc" }],
    take: 12000,
  });
  console.log("capture-index-equivalent", {
    rows: indexRows.length,
    ms: Math.round(performance.now() - t1),
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
