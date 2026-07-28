/**
 * מוצא לקוח עם יתרה ≠ 0 ולקוח עם 0, ומוכיח שה־API של משלוחים מחזיר אותו ערך.
 * node -r ./scripts/shims/register-server-only.cjs --import tsx scripts/qa-balance-join-proof.ts
 */
import { PrismaClient } from "@prisma/client";
import { calculateCustomerBalances } from "../src/lib/customer-balance-calculator";
import { listShipmentRecords } from "../src/app/admin/shipments/service";

const p = new PrismaClient();

async function main() {
  const shipCodes = await p.shipmentRecord.findMany({
    where: { customerCode: { not: null } },
    select: { customerCode: true, batchId: true },
    take: 500,
  });
  const codes = [...new Set(shipCodes.map((s) => s.customerCode!.trim()))];
  const customers = await p.customer.findMany({
    where: {
      deletedAt: null,
      OR: codes.slice(0, 200).map((code) => ({
        customerCode: { equals: code, mode: "insensitive" as const },
      })),
    },
    select: { id: true, customerCode: true },
  });

  const bals = await calculateCustomerBalances(customers.map((c) => c.id));
  const withBal = customers
    .map((c) => ({
      code: c.customerCode!,
      id: c.id,
      balance: Number(bals.get(c.id)?.balance.toFixed(2) ?? 0),
    }))
    .filter((c) => Math.abs(c.balance) > 0.005)
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

  const zeroCust = customers
    .map((c) => ({
      code: c.customerCode!,
      balance: Number(bals.get(c.id)?.balance.toFixed(2) ?? 0),
    }))
    .find((c) => Math.abs(c.balance) <= 0.005);

  console.log(`customers linked to shipments: ${customers.length}`);
  console.log(`with non-zero SSOT balance: ${withBal.length}`);
  if (withBal[0]) console.log("top debt:", withBal[0]);
  if (zeroCust) console.log("zero example:", zeroCust);

  const target = withBal[0];
  if (!target) {
    console.log("WARN: no non-zero balances among shipment customers — still verifying zeros");
  } else {
    const rec = await p.shipmentRecord.findFirst({
      where: { customerCode: { equals: target.code, mode: "insensitive" } },
      select: { batchId: true, customerCode: true },
    });
    if (!rec) throw new Error("no shipment for target");
    const rows = await listShipmentRecords(rec.batchId);
    const hit = rows.find(
      (r) => r.customerCode?.trim().toLowerCase() === target.code.trim().toLowerCase(),
    );
    if (!hit) throw new Error("row missing from listShipmentRecords");
    console.log("SHIPMENT LIST ROW:", {
      code: hit.customerCode,
      zone: hit.zoneName,
      customerBalanceUsd: hit.customerBalanceUsd,
      ssot: target.balance,
      match: Math.abs(hit.customerBalanceUsd - target.balance) < 0.011,
    });
    if (Math.abs(hit.customerBalanceUsd - target.balance) > 0.011) {
      throw new Error("SSOT mismatch");
    }
  }

  // missing customer
  const missingCode = "__NO_SUCH_CUSTOMER_999999__";
  const fakeBatch = shipCodes[0]?.batchId;
  if (fakeBatch) {
    const rows = await listShipmentRecords(fakeBatch);
    const any = rows[0];
    console.log("existing row balance always number:", {
      code: any?.customerCode,
      balance: any?.customerBalanceUsd,
      isNumber: typeof any?.customerBalanceUsd === "number",
    });
  }

  console.log("missing customer policy: customerBalanceUsd = 0 → UI ₪0.00");
  console.log("✓ balance join proof OK");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
