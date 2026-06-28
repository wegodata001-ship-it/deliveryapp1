import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

import { PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import {
  parseExternalReconFile,
  reconcile,
  type SystemOrderForRecon,
} from "../../src/lib/controls/reconciliation";

const prisma = new PrismaClient();

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const file = process.argv.find((a) => /\.(xlsx|xls|csv)$/i.test(a)) ?? "C:\\Users\\omer2\\Downloads\\collecting_excel_report (1).xlsx";
  const week = process.argv.find((a) => a.startsWith("--week="))?.split("=")[1] ?? "AH-125";

  const buffer = fs.readFileSync(file);
  const externalRows = parseExternalReconFile(buffer);
  console.log(`external rows parsed: ${externalRows.length}`);
  console.log("sample external:", externalRows.slice(0, 2));

  const orders = await prisma.order.findMany({
    where: { weekCode: week, isActive: true, deletedAt: null },
    select: {
      id: true,
      orderNumber: true,
      externalOrderId: true,
      customerCodeSnapshot: true,
      customerNameSnapshot: true,
      totalUsd: true,
      amountUsd: true,
      orderDate: true,
      customer: { select: { customerCode: true, displayName: true } },
    },
  });
  console.log(`system orders (${week}): ${orders.length}`);

  const systemOrders: SystemOrderForRecon[] = orders.map((o) => ({
    orderId: o.id,
    orderNumber: o.orderNumber,
    externalOrderId: o.externalOrderId,
    customerCode: o.customerCodeSnapshot ?? o.customer?.customerCode ?? null,
    customerName: o.customerNameSnapshot ?? o.customer?.displayName ?? null,
    amount: toNumber(o.totalUsd) ?? toNumber(o.amountUsd),
    dateIso: o.orderDate ? o.orderDate.toISOString() : null,
  }));

  const { kpis } = reconcile(systemOrders, externalRows);
  console.log("\n========== KPIs ==========");
  console.log(JSON.stringify(kpis, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
