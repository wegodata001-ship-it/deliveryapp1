/**
 * Benchmark suggestNextCustomerCode — old vs new query pattern.
 * node --import tsx scripts/benchmark-customer-code-suggest.ts
 */
import { performance } from "node:perf_hooks";
import { prisma } from "../src/lib/prisma";
import { suggestNextCustomerCode } from "../src/lib/customer-code";
import {
  formatNewCustomerCode,
  getFirstCustomerNumber,
  parseCustomerNumberFromCode,
} from "../src/lib/customer-code.shared";

async function suggestNextCustomerCodeLegacy(): Promise<string> {
  const rows = await prisma.customer.findMany({
    where: { deletedAt: null, customerCode: { not: null } },
    select: { customerCode: true },
    take: 5000,
  });

  let maxN = getFirstCustomerNumber() - 1;
  for (const r of rows) {
    const n = parseCustomerNumberFromCode(r.customerCode);
    if (n != null) maxN = Math.max(maxN, n);
  }

  for (let bump = 0; bump < 400; bump += 1) {
    const code = formatNewCustomerCode(maxN + 1 + bump);
    const dup = await prisma.customer.findFirst({
      where: { customerCode: { equals: code, mode: "insensitive" }, deletedAt: null },
      select: { id: true },
    });
    if (!dup) return code;
  }

  return formatNewCustomerCode(maxN + 401);
}

async function time(label: string, fn: () => Promise<unknown>) {
  const t0 = performance.now();
  const result = await fn();
  const ms = Math.round(performance.now() - t0);
  console.log(`${label}: ${ms}ms`, typeof result === "string" ? `(→ ${result})` : "");
  return ms;
}

async function main() {
  const legacyMs = await time("Legacy suggestNextCustomerCode", () => suggestNextCustomerCodeLegacy());
  const optimizedMs = await time("Optimized suggestNextCustomerCode", () => suggestNextCustomerCode());

  console.log("\nCUSTOMER CODE SUGGEST BENCHMARK");
  console.log(`Legacy:    ${legacyMs}ms`);
  console.log(`Optimized: ${optimizedMs}ms`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
