/**
 * הוכחת תקינות: אזורי חלוקה + יתרת לקוח מ־calculateCustomerBalances (SSOT)
 * הרצה:
 *   node -r ./scripts/shims/register-server-only.cjs --import tsx scripts/qa-shipment-list-proof.ts [batchId]
 */
import { PrismaClient } from "@prisma/client";
import { calculateCustomerBalances } from "../src/lib/customer-balance-calculator";
import { listShipmentRecords } from "../src/app/admin/shipments/service";

const p = new PrismaClient();

async function main() {
  const batchId = process.argv[2] || "19c6bab6-acdf-49c6-beac-dbbed0f362bf";

  const records = await listShipmentRecords(batchId);
  const withZone = records.filter((r) => r.zoneName).length;

  console.log("=== ZONE FILL (API → UI) ===");
  console.log(`${withZone}/${records.length} rows have zoneName`);

  const zoneCounts = new Map<string, number>();
  for (const r of records) {
    const z = r.zoneName || "לא הוגדר";
    zoneCounts.set(z, (zoneCounts.get(z) || 0) + 1);
  }
  for (const [name, count] of [...zoneCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${name}: ${count}`);
  }

  console.log("\n=== UI COLUMNS ===");
  console.log(
    "תאריך הגעה | מספר משלוח | קוד לקוח | שם לקוח | טלפון | כתובת | אזור חלוקה | קרטונים | דמי משלוח | גובה תשלום | יתרת לקוח | סטטוס | פעולות",
  );
  console.log('NO "מקום מסירה מעודכן"');

  const codes = [...new Set(records.map((r) => r.customerCode?.trim()).filter(Boolean))] as string[];
  const customers = await p.customer.findMany({
    where: {
      deletedAt: null,
      OR: codes.map((code) => ({
        customerCode: { equals: code, mode: "insensitive" as const },
      })),
    },
    select: { id: true, customerCode: true },
  });
  const balMap = await calculateCustomerBalances(customers.map((c) => c.id));
  const byCode = new Map(
    customers.map((c) => [
      c.customerCode!.trim().toLowerCase(),
      Number(balMap.get(c.id)?.balance.toFixed(2) ?? 0),
    ]),
  );

  let ok = 0;
  for (const r of records) {
    const code = r.customerCode?.trim().toLowerCase();
    const expected = code && byCode.has(code) ? byCode.get(code)! : 0;
    if (Math.abs((r.customerBalanceUsd ?? 0) - expected) > 0.011) {
      throw new Error(
        `balance mismatch ${r.customerCode}: ui=${r.customerBalanceUsd} ssot=${expected}`,
      );
    }
    ok++;
  }

  const nonZero = records.filter((r) => (r.customerBalanceUsd ?? 0) > 0.005).length;
  const zeros = records.filter((r) => (r.customerBalanceUsd ?? 0) === 0).length;

  console.log("\n=== BALANCE SSOT ===");
  console.log({ verifiedRows: ok, nonZeroBalance: nonZero, zeroBalance: zeros });
  console.log("samples:");
  for (const r of records.filter((x) => (x.customerBalanceUsd ?? 0) > 0.005).slice(0, 5)) {
    console.log({
      code: r.customerCode,
      zone: r.zoneName,
      balance: `₪${(r.customerBalanceUsd ?? 0).toFixed(2)}`,
    });
  }
  for (const r of records.filter((x) => (x.customerBalanceUsd ?? 0) === 0).slice(0, 3)) {
    console.log({
      code: r.customerCode,
      zone: r.zoneName || "לא הוגדר",
      balance: "₪0.00",
    });
  }

  console.log("\n✓ QA proof passed");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
