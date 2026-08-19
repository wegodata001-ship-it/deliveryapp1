/**
 * Full-system performance audit — server-side benchmarks with real DB query counts.
 *
 * Usage:
 *   npm run perf:audit
 *   npm run perf:audit:after
 *
 * Requires DATABASE_URL (.env / .env.local).
 */
import "dotenv/config";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import type { WorkCountryCode } from "../src/lib/work-country";
import {
  benchmarkOperation,
  createTrackedPrisma,
  median,
  type BenchmarkResult,
} from "../src/lib/perf-audit/query-tracker";

const COUNTRIES: WorkCountryCode[] = ["TR", "CN", "AE"];
const phase = process.argv.find((a) => a.startsWith("--phase="))?.split("=")[1] ?? "baseline";

function installInstrumentedPrisma(client: PrismaClient): void {
  const g = globalThis as unknown as { prisma?: PrismaClient };
  g.prisma = client;
}

async function loadServices() {
  const [
    shipments,
    daily,
    weekBalance,
    locations,
    manual,
    customers,
    dashboard,
    flow,
    documents,
    orders,
    weekFlow,
    reports,
  ] = await Promise.all([
    import("../src/app/admin/shipments/service"),
    import("../src/app/admin/cash-control/daily-service"),
    import("../src/lib/cash-control/week-balance-service"),
    import("../src/app/admin/shipments/location-service"),
    import("../src/app/admin/shipments/manual/service"),
    import("../src/lib/customers-module"),
    import("../src/lib/dashboard-stats"),
    import("../src/lib/flow-control/services/flow-weeks-overview-service"),
    import("../src/lib/documents/service"),
    import("../src/lib/orders-list-data"),
    import("../src/app/admin/cash-flow/week-flow-service"),
    import("../src/app/admin/reports/actions"),
  ]);
  return { shipments, daily, weekBalance, locations, manual, customers, dashboard, flow, documents, orders, weekFlow, reports };
}

async function main() {
  const { prisma, run, disconnect } = createTrackedPrisma();
  installInstrumentedPrisma(prisma);
  const services = await loadServices();
  const { ACTIVE_WORK_WEEK_CODE } = await import("../src/lib/active-work-week");
  const { listAhWeekCodesAround } = await import("../src/lib/weeks/ah-week");

  const batchByCountry = new Map<WorkCountryCode, string>();
  for (const wc of COUNTRIES) {
    const batch = await prisma.shipmentBatch.findFirst({
      where: { countryCode: wc },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (batch) batchByCountry.set(wc, batch.id);
  }

  const flowWeeks = listAhWeekCodesAround(ACTIVE_WORK_WEEK_CODE, 4, 4);
  const mockAdminUser = {
    id: "perf-audit",
    email: "perf@audit.local",
    fullName: "Perf Audit",
    role: "ADMIN" as const,
    permissions: [] as string[],
  };

  const results: BenchmarkResult[] = [];

  async function bench(
    id: string,
    module: string,
    operation: string,
    fn: () => Promise<{ rowCount?: number } | void>,
  ) {
    try {
      results.push(
        await benchmarkOperation({
          id,
          module,
          operation,
          fn: async () => fn(),
          run: async (_label, inner) => run(_label, () => inner(prisma)),
        }),
      );
    } catch (error) {
      console.error(`[perf-audit] FAILED ${id}:`, error instanceof Error ? error.message : error);
      results.push({
        id,
        module,
        operation,
        coldMs: -1,
        warmMedianMs: -1,
        warmP95Ms: -1,
        coldQueries: -1,
        warmMedianQueries: -1,
      });
    }
  }

  // Dashboard
  await bench("dashboard.stats", "Dashboard", "Stats core (month range)", async () => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const { resolveCountryScopeFromCode } = await import("../src/lib/country-data-scope");
    const stats = await services.dashboard.loadDashboardStatsCore(
      { fromStart: from, toEnd: to },
      true,
      resolveCountryScopeFromCode("TR"),
    );
    return { rowCount: stats.ordersInRange };
  });

  // Shipments — per country
  for (const wc of COUNTRIES) {
    const slug = wc === "TR" ? "turkey" : wc === "CN" ? "china" : "uae";
    await bench(`shipments.listBatches.${slug}`, "Shipments", `List batches (${slug})`, async () => {
      const rows = await services.shipments.listShipmentBatches(wc);
      return { rowCount: rows.length };
    });

    const batchId = batchByCountry.get(wc);
    if (batchId) {
      await bench(`shipments.listRecords.${slug}`, "Shipments", `List packages (${slug})`, async () => {
        const rows = await services.shipments.listShipmentRecords(batchId, wc);
        return { rowCount: rows.length };
      });

      await bench(`shipments.batchDetail.${slug}`, "Shipments", `Batch detail SSR (${slug})`, async () => {
        const [batch, records, zones, couriers] = await Promise.all([
          services.shipments.getShipmentBatch(batchId, wc),
          services.shipments.listShipmentRecords(batchId, wc),
          services.shipments.listZones(wc),
          services.shipments.listCouriers(wc),
        ]);
        return { rowCount: (batch ? 1 : 0) + records.length + zones.length + couriers.length };
      });
    }

    await bench(`shipments.locations.${slug}`, "Shipments", `Locations admin (${slug})`, async () => {
      const [mappings, zones, locs] = await Promise.all([
        services.locations.listAliasMappingRows(wc, { includeInactive: true }),
        services.shipments.listZones(wc),
        services.locations.listDeliveryLocations(wc, { includeInactive: true }),
      ]);
      return { rowCount: mappings.length + zones.length + locs.length };
    });

    await bench(`shipments.locationsCleanup.${slug}`, "Shipments", `Locations cleanup (${slug})`, async () => {
      const result = await services.locations.cleanupMisimportedAreasAndLocations(wc);
      return { rowCount: result.deletedFakeZones + result.deletedZoneNamedLocations };
    });

    await bench(`shipments.manual.${slug}`, "Shipments", `Manual entry list (${slug})`, async () => {
      const rows = await services.manual.listManualShipments(wc);
      return { rowCount: rows.length };
    });

    await bench(`shipments.control.${slug}`, "Shipments", `Control data load (${slug})`, async () => {
      const { shipmentRecordWhere, shipmentBatchWhere, shipmentZoneWhere, shipmentCourierWhere } =
        await import("../src/lib/shipment-country-scope");
      const { loadAliasLookupMap } = await import("../src/lib/delivery-location-match");
      const [rawRecords, aliasByKey, allBatches, allZones, allCouriers] = await Promise.all([
        prisma.shipmentRecord.findMany({
          where: shipmentRecordWhere(wc),
          take: 500,
          select: { id: true, batchId: true },
        }),
        loadAliasLookupMap(),
        prisma.shipmentBatch.findMany({
          where: shipmentBatchWhere(wc),
          select: { id: true },
        }),
        prisma.shipmentDeliveryZone.findMany({
          where: shipmentZoneWhere(wc),
          select: { id: true },
        }),
        prisma.shipmentCourier.findMany({
          where: shipmentCourierWhere(wc),
          select: { id: true },
        }),
      ]);
      void aliasByKey;
      return {
        rowCount: rawRecords.length + allBatches.length + allZones.length + allCouriers.length,
      };
    });
  }

  // Cash control
  await bench("cash.aggregates", "Cash Control", "Week aggregates", async () => {
    const agg = await services.daily.loadCashControlWeekAggregates(ACTIVE_WORK_WEEK_CODE);
    return { rowCount: agg ? 1 : 0 };
  });

  await bench("cash.summary", "Cash Control", "Week summary", async () => {
    const summary = await services.daily.loadCashControlWeekSummary(ACTIVE_WORK_WEEK_CODE);
    return { rowCount: summary?.rows.length ?? 0 };
  });

  await bench("cash.pageLoad", "Cash Control", "Summary + balance (combined)", async () => {
    const page = await services.daily.loadCashControlWeekPageData(ACTIVE_WORK_WEEK_CODE);
    const state = page.aggregates
      ? await services.weekBalance.loadWeekBalanceState(ACTIVE_WORK_WEEK_CODE, page.aggregates)
      : null;
    return { rowCount: (page.summary?.rows.length ?? 0) + (state ? 1 : 0) };
  });

  await bench("cash.weekBalance", "Cash Control", "Week balance state", async () => {
    const state = await services.weekBalance.loadWeekBalanceState(ACTIVE_WORK_WEEK_CODE);
    return { rowCount: state ? 1 : 0 };
  });

  // Cash flow
  await bench("cashflow.overview", "Cash Flow", "Weeks overview (8 weeks)", async () => {
    const rows = await services.flow.loadFlowWeeksOverview(flowWeeks, "TR");
    return { rowCount: rows.length };
  });

  // Cash expenses (raw query — avoids schema drift in service layer)
  await bench("cashExpenses.list", "Cash Expenses", "List active expenses", async () => {
    const rows = await prisma.cashExpense.findMany({
      where: { weekCode: ACTIVE_WORK_WEEK_CODE, status: "ACTIVE" },
      select: { id: true },
    });
    return { rowCount: rows.length };
  });

  // Customers
  await bench("customers.list", "Customers", "List page (50)", async () => {
    const res = await services.customers.listCustomersModule({ page: 1, limit: 50 });
    return { rowCount: res.rows.length };
  });

  await bench("customers.search", "Customers", "Search 'ats'", async () => {
    const res = await services.customers.listCustomersModule({ page: 1, limit: 50, search: "ats" });
    return { rowCount: res.rows.length };
  });

  // Orders
  await bench("orders.list", "Orders", "SSR list page data", async () => {
    const data = await services.orders.fetchOrdersListPageData({}, mockAdminUser);
    return { rowCount: data.orders.length };
  });

  // Documents
  await bench("documents.list", "Documents", "Archive list (50)", async () => {
    const res = await services.documents.listDocuments({ limit: 50 });
    return { rowCount: res.length };
  });

  // Balances proxy
  await bench("balances.list", "Balances", "Customer balance calc (100)", async () => {
    const customers = await prisma.customer.findMany({
      where: { deletedAt: null },
      take: 100,
      select: { id: true },
    });
    const { calculateCustomerBalances } = await import("../src/lib/customer-balance-calculator");
    const balances = await calculateCustomerBalances(customers.map((c) => c.id));
    return { rowCount: balances.size };
  });

  // Cash flow — single week drill (manager count source)
  await bench("cashflow.week", "Cash Flow", "Single week loadFlowWeek", async () => {
    const data = await services.weekFlow.loadFlowWeek(ACTIVE_WORK_WEEK_CODE, "TR");
    return { rowCount: data ? 1 : 0 };
  });

  // Reports dashboard
  await bench("reports.dashboard", "Reports", "Dashboard KPIs", async () => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const pad = (d: Date) => d.toISOString().slice(0, 10);
    const res = await services.reports.getReportsDashboardAction({
      dateFrom: pad(from),
      dateTo: pad(to),
    });
    return { rowCount: res.reports.length };
  });

  await disconnect();

  const outDir = join(process.cwd(), "docs");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const payload = {
    phase,
    measuredAt: new Date().toISOString(),
    environment: {
      nodeEnv: process.env.NODE_ENV ?? "development",
      note: "Direct server/service benchmarks against live DB — not browser timing",
    },
    dataset: {
      batches: Object.fromEntries([...batchByCountry.entries()]),
      activeWeek: ACTIVE_WORK_WEEK_CODE,
      flowWeeks,
    },
    results,
    summary: {
      operations: results.length,
      medianWarmMs: median(results.map((r) => r.warmMedianMs)),
      slowest: [...results].sort((a, b) => b.warmMedianMs - a.warmMedianMs)[0],
      over1s: results.filter((r) => r.warmMedianMs > 1000).length,
      over2s: results.filter((r) => r.warmMedianMs > 2000).length,
    },
  };

  const jsonPath = join(outDir, `perf-${phase}.json`);
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`\nWrote ${jsonPath}`);
  console.log("\n=== TOP 10 SLOWEST (warm median) ===");
  for (const r of [...results].sort((a, b) => b.warmMedianMs - a.warmMedianMs).slice(0, 10)) {
    console.log(
      `${r.module} | ${r.operation}: ${r.warmMedianMs}ms (queries ${r.warmMedianQueries}, cold ${r.coldMs}ms)`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
