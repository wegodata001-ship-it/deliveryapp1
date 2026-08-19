/**
 * Benchmark cash flow control load — AH-136 default.
 *
 * Usage: CASH_FLOW_PERF=1 node -r ./scripts/shims/register-server-only.cjs --import tsx scripts/benchmark-cashflow-control.ts [AH-136] [runs=10]
 */
import "dotenv/config";
import { performance } from "node:perf_hooks";
import { loadFlowWeekDrill } from "../src/lib/flow-control/services/flow-week-drill-service";
import { loadFlowWeeksOverview } from "../src/lib/flow-control/services/flow-weeks-overview-service";
import { getCurrentFinancialBalances } from "../src/lib/flow-control/services/current-financial-balances-service";
import { DEFAULT_WORK_COUNTRY } from "../src/lib/work-country";
import { parseAhWeekNumber, toAhWeekCode } from "../src/lib/weeks/ah-week-nav";

const week = process.argv[2]?.trim() || "AH-136";
const runs = Math.max(1, Number(process.argv[3] ?? 10) || 10);

function weekCodesFromActive(count: number, activeCode: string): string[] {
  const active = parseAhWeekNumber(activeCode) ?? 1;
  const out: string[] = [];
  for (let n = active; n >= 1 && out.length < count; n -= 1) {
    out.push(toAhWeekCode(n));
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]!;
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<{ ms: number; result: T }> {
  const t0 = performance.now();
  const result = await fn();
  const ms = Math.round(performance.now() - t0);
  console.log(`  ${label}: ${ms} ms`);
  return { ms, result };
}

async function runOnce(overviewWeeks: string[]) {
  console.log("\n--- run ---");
  const balances = await timed("KPI / current balances", () =>
    getCurrentFinancialBalances({ workCountry: DEFAULT_WORK_COUNTRY, asOfWeek: week }),
  );
  const overview = await timed("Overview (3 weeks)", () =>
    loadFlowWeeksOverview(overviewWeeks, DEFAULT_WORK_COUNTRY),
  );
  const drill = await timed("Weekly movements + receipts", () =>
    loadFlowWeekDrill(week, DEFAULT_WORK_COUNTRY),
  );
  const totalMs =
    balances.ms +
    overview.ms +
    drill.ms;
  console.log(`  Sequential total (3 calls): ${totalMs} ms`);
  return { balances: balances.ms, overview: overview.ms, drill: drill.ms, total: totalMs };
}

async function runParallelOnce(overviewWeeks: string[]) {
  const t0 = performance.now();
  await Promise.all([
    getCurrentFinancialBalances({ workCountry: DEFAULT_WORK_COUNTRY, asOfWeek: week }),
    loadFlowWeeksOverview(overviewWeeks, DEFAULT_WORK_COUNTRY),
    loadFlowWeekDrill(week, DEFAULT_WORK_COUNTRY),
  ]);
  return Math.round(performance.now() - t0);
}

function summarize(label: string, values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  console.log(
    `${label.padEnd(28)} p50=${percentile(sorted, 50)}ms  p95=${percentile(sorted, 95)}ms  min=${sorted[0]}ms  max=${sorted[sorted.length - 1]}ms`,
  );
}

async function main() {
  const overviewWeeks = weekCodesFromActive(3, week);
  console.log(`Benchmark week=${week} runs=${runs} overviewWeeks=${overviewWeeks.join(", ")}`);

  // warm-up
  await runParallelOnce(overviewWeeks);

  const parallelTotals: number[] = [];
  const kpiMs: number[] = [];
  const overviewMs: number[] = [];
  const drillMs: number[] = [];

  for (let i = 0; i < runs; i += 1) {
    const row = await runOnce(overviewWeeks);
    kpiMs.push(row.balances);
    overviewMs.push(row.overview);
    drillMs.push(row.drill);
    parallelTotals.push(await runParallelOnce(overviewWeeks));
  }

  console.log("\n=== Summary (after warm-up, cache hot) ===");
  summarize("KPI / current balances", kpiMs);
  summarize("Overview (3 weeks)", overviewMs);
  summarize("Drill (journal+receipts)", drillMs);
  summarize("Parallel bootstrap equiv.", parallelTotals);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
