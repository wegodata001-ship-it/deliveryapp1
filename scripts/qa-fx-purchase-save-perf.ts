/**
 * Benchmark FX purchase save path — logs per-stage ms + Prisma query count.
 *
 * Usage: node -r ./scripts/shims/register-server-only.cjs --import tsx scripts/qa-fx-purchase-save-perf.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createTrackedPrisma } from "../src/lib/perf-audit/query-tracker";
import { ACTIVE_WORK_WEEK_CODE } from "../src/lib/active-work-week";

async function main() {
  const { prisma, run, disconnect } = createTrackedPrisma();
  (globalThis as { prisma?: PrismaClient }).prisma = prisma;

  const { executeFxPurchase } = await import("../src/lib/flow-control/fx-purchase/service");
  const week = ACTIVE_WORK_WEEK_CODE;

  for (const track of ["PS", "IL"] as const) {
    const { result, queryCount, durationMs } = await run(
      `executeFxPurchase:${track}`,
      async () => {
        const { getFxPurchaseContext } = await import("../src/lib/flow-control/fx-purchase/service");
        const ctx = await getFxPurchaseContext(week, track);
        const purchaseIls = Math.min(1, ctx.availableIls);
        const remainder = Math.max(0, ctx.availableIls - purchaseIls);
        return executeFxPurchase({
          weekCode: week,
          track,
          ilsAmount: purchaseIls,
          rate: 3.5,
          remainderCashIls: remainder,
          remainderBankIls: 0,
          updatedById: "qa-perf",
          createdByName: "QA Perf",
        });
      },
      { track },
    );

    console.log(
      JSON.stringify({
        track,
        ok: result.ok,
        error: result.error ?? null,
        durationMs,
        queryCount,
      }),
    );
  }

  await disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
