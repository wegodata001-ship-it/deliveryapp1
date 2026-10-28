/**
 * Read-only regression — AH-139, AH-141, AH-145, AH-146 + business reconciliation counters
 *
 * Usage:
 *   node -r ./scripts/shims/register-server-only.cjs --import tsx scripts/cashflow-regression.qa.ts
 */
import "dotenv/config";
import { loadFlowWeek } from "../src/app/admin/cash-flow/week-flow-service";
import { loadFlowWeekContext } from "../src/lib/flow-control/flow-week-context-service";
import {
  buildFlowBusinessReconciliation,
  countVerifiedFlowExceptions,
} from "../src/lib/flow-control/flow-week-business-reconciliation";
import { loadFlowWeekDrill } from "../src/lib/flow-control/services/flow-week-drill-service";
import { resolveCountryScopeFromCode } from "../src/lib/country-data-scope";
import { DEFAULT_WORK_COUNTRY } from "../src/lib/work-country";
import { prisma } from "../src/lib/prisma";

async function check(week: string) {
  const scope = resolveCountryScopeFromCode(DEFAULT_WORK_COUNTRY);
  const [ctx, flow] = await Promise.all([
    loadFlowWeekContext(week, scope),
    loadFlowWeek(week, DEFAULT_WORK_COUNTRY),
  ]);
  return { week, ctx, flow };
}

async function main() {
  const weeks = ["AH-139", "AH-141", "AH-145", "AH-146"];
  let failed = 0;
  for (const w of weeks) {
    const { ctx, flow } = await check(w);
    const drill = await loadFlowWeekDrill(w, DEFAULT_WORK_COUNTRY);
    const verified = drill ? countVerifiedFlowExceptions(drill) : 0;
    const recon = buildFlowBusinessReconciliation({ drill, overview: null, week: w });
    console.log("\n===", w, "===");
    console.log(
      JSON.stringify(
        {
          ctx,
          managerCountState: flow?.managerCountState,
          drawerIls: flow?.drawerRemainingIls,
          verifiedExceptions: verified,
          reconSummary: {
            verified: recon.verifiedExceptionCount,
            pending: recon.pendingVerificationCount,
            openOb: recon.openObligationCount,
            tableRows: recon.rows.length,
          },
        },
        null,
        2,
      ),
    );
    if (flow?.managerCountState !== "COMPLETE" && verified > 0) {
      console.error(`FAIL ${w}: verified exceptions only when manager count is COMPLETE`);
      failed++;
    }
    if (w === "AH-145") {
      if (ctx.ordersInOrderWeek !== 8 || ctx.paymentsReceivedInWeek !== 0) {
        console.error("FAIL AH-145 context (orders=8, intake payments=0)");
        failed++;
      }
      if (ctx.paymentsByWeekCodeOnly < 1) {
        console.error("FAIL AH-145 expected weekCode payments for mismatch demo");
        failed++;
      }
      if (flow?.drawerRemainingIls != null) {
        console.error("FAIL AH-145 drawer should be null without count");
        failed++;
      }
    }
    if (w === "AH-139") {
      if (flow?.managerCountState !== "NONE" || flow?.drawerRemainingIls != null) {
        console.error("FAIL AH-139 no count");
        failed++;
      }
    }
    if (w === "AH-141") {
      if (flow?.managerCountState === "NONE") {
        console.error("FAIL AH-141 expected manager count");
        failed++;
      }
    }
  }
  await prisma.$disconnect();
  if (failed) process.exit(1);
  console.log("\nAll cashflow regression checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
