import { PrismaClient } from "@prisma/client";
import { listShipmentRecords } from "../src/app/admin/shipments/service";
import { calculateCustomerBalances } from "../src/lib/customer-balance-calculator";

const p = new PrismaClient();

async function main() {
  const batchId = "19c6bab6-acdf-49c6-beac-dbbed0f362bf";
  const rows = await listShipmentRecords(batchId);

  // prove ATS join found customers (even if balance 0)
  const codes = rows.map((r) => r.customerCode).filter(Boolean) as string[];
  let found = 0;
  for (const code of codes) {
    const digits = code.replace(/\D/g, "");
    const c = await p.customer.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { customerCode: { equals: code, mode: "insensitive" } },
          { customerCode: { equals: `ATS${digits}`, mode: "insensitive" } },
        ],
      },
      select: { id: true, customerCode: true, balanceUsd: true },
    });
    if (c) found++;
  }
  console.log(`ATS/exact customer matches for batch rows: ${found}/${codes.length}`);

  // customer with snapshot balance
  const rich = await p.customer.findFirst({
    where: { deletedAt: null, balanceUsd: { not: 0 } },
    select: { id: true, customerCode: true, balanceUsd: true, displayName: true },
  });
  console.log("customer with balanceUsd snapshot:", rich);

  if (rich) {
    const live = await calculateCustomerBalances([rich.id]);
    console.log("live calculateCustomerBalances:", live.get(rich.id)?.balance.toString());
  }

  console.log(
    "sample API balances after ATS join:",
    rows.slice(0, 8).map((r) => ({
      code: r.customerCode,
      zone: r.zoneName || "לא הוגדר",
      balance: `₪${(r.customerBalanceUsd ?? 0).toFixed(2)}`,
    })),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
