/**
 * Safe read load tests — concurrency 1, 5, 10 on idempotent service calls.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { createTrackedPrisma, median, p95 } from "../src/lib/perf-audit/query-tracker";

type LoadRow = {
  id: string;
  concurrency: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  successRate: number;
};

function installPrisma(client: PrismaClient) {
  (globalThis as { prisma?: PrismaClient }).prisma = client;
}

async function loadTest(
  id: string,
  concurrency: number,
  fn: () => Promise<void>,
): Promise<LoadRow> {
  const times: number[] = [];
  let ok = 0;
  for (let round = 0; round < 3; round++) {
    const batch = await Promise.all(
      Array.from({ length: concurrency }, async () => {
        const t0 = performance.now();
        try {
          await fn();
          ok += 1;
          return performance.now() - t0;
        } catch {
          return performance.now() - t0;
        }
      }),
    );
    times.push(...batch);
  }
  const avg = Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 100) / 100;
  return {
    id,
    concurrency,
    avgMs: avg,
    p95Ms: p95(times),
    maxMs: Math.round(Math.max(...times) * 100) / 100,
    successRate: Math.round((ok / (3 * concurrency)) * 1000) / 10,
  };
}

async function main() {
  const { prisma, disconnect } = createTrackedPrisma();
  installPrisma(prisma);

  const { listCustomersModule } = await import("../src/lib/customers-module");
  const { loadFlowWeeksOverview } = await import(
    "../src/lib/flow-control/services/flow-weeks-overview-service"
  );
  const { listAhWeekCodesAround } = await import("../src/lib/weeks/ah-week");
  const { ACTIVE_WORK_WEEK_CODE } = await import("../src/lib/active-work-week");

  const weeks = listAhWeekCodesAround(ACTIVE_WORK_WEEK_CODE, 2, 2);
  const results: LoadRow[] = [];

  for (const c of [1, 5, 10]) {
    results.push(
      await loadTest(`customers.list@${c}`, c, async () => {
        await listCustomersModule({ page: 1, limit: 20 });
      }),
    );
  }

  for (const c of [1, 5]) {
    results.push(
      await loadTest(`cashflow.overview4w@${c}`, c, async () => {
        await loadFlowWeeksOverview(weeks, "TR");
      }),
    );
  }

  await disconnect();

  const out = join(process.cwd(), "docs", "audit-load.json");
  writeFileSync(out, JSON.stringify(results, null, 2), "utf8");
  console.log(`Wrote ${out}`);
  for (const r of results) {
    console.log(`${r.id}: avg=${r.avgMs}ms p95=${r.p95Ms}ms max=${r.maxMs}ms ok=${r.successRate}%`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
