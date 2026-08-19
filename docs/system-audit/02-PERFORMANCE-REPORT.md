# Performance Report

**Measured at:** 2026-08-19T06:02:50.218Z  
**Environment:** development — Direct server/service benchmarks against live DB — not browser timing  
**Active week:** AH-136

## Methodology

- Tool: `npm run perf:audit` → `scripts/perf-audit.ts`
- Each operation: 1 cold run + 3 warm runs
- Prisma query events counted via `createTrackedPrisma()`
- **Not measured:** browser render, network waterfall, write operations (create/update/delete)

## Summary

| Metric | Value |
| ------ | ----: |
| Operations benchmarked | 27 |
| Median warm time (all ops) | 390.11ms |
| Slowest operation | Cash Flow / Weeks overview (8 weeks) |
| Slowest warm median | 8337.52ms |
| Operations > 1s | 1 |
| Operations > 2s | 1 |

## Master Performance Table

| Module | Operation | Cold (ms) | Warm median (ms) | P95 (ms) | Status | Issue |
| --- | --- | --- | --- | --- | --- | --- |
| Cash Flow | Weeks overview (8 weeks) | 8365.35 | 8337.52 | 8347.64 | 🟠 Needs Improvement | Critical latency |
| Shipments | Locations admin (turkey) | 1107.66 | 899.28 | 1035.24 | 🟠 Needs Improvement | — |
| Shipments | Control data load (uae) | 1095.35 | 806.32 | 810.23 | 🟠 Needs Improvement | — |
| Shipments | Control data load (china) | 1063.02 | 787.8 | 799.05 | 🟠 Needs Improvement | — |
| Cash Control | Summary + balance (combined) | 793.67 | 785.87 | 786.69 | 🟠 Needs Improvement | — |
| Cash Control | Week balance state | 854.78 | 777.72 | 785.87 | 🟠 Needs Improvement | — |
| Shipments | Control data load (turkey) | 868.14 | 775.03 | 789.01 | 🟠 Needs Improvement | — |
| Shipments | Locations cleanup (uae) | 770.73 | 770.4 | 776.06 | 🟠 Needs Improvement | — |
| Shipments | Locations cleanup (china) | 776.1 | 770.19 | 806.76 | 🟠 Needs Improvement | — |
| Shipments | Locations cleanup (turkey) | 758.29 | 757.03 | 765.61 | 🟠 Needs Improvement | — |
| Shipments | Manual entry list (uae) | 388.38 | 395.84 | 440.67 | 🟡 Good | — |
| Dashboard | Stats core (month range) | 950.47 | 393.65 | 397.51 | 🟡 Good | — |
| Balances | Customer balance calc (100) | 392.03 | 391.21 | 463.89 | 🟡 Good | — |
| Shipments | List batches (turkey) | 389.76 | 390.11 | 397.64 | 🟡 Good | — |
| Cash Control | Week aggregates | 405.55 | 389.43 | 395.88 | 🟡 Good | — |
| Shipments | Manual entry list (china) | 389.11 | 388.52 | 393.94 | 🟡 Good | — |
| Cash Control | Week summary | 408.56 | 387.88 | 397.61 | 🟡 Good | — |
| Shipments | Locations admin (china) | 451.65 | 387.86 | 391.21 | 🟡 Good | — |
| Documents | Archive list (50) | 388.65 | 385.59 | 387.58 | 🟡 Good | — |
| Shipments | Locations admin (uae) | 384.62 | 384.48 | 462.06 | 🟡 Good | — |
| Customers | Search 'ats' | 384.07 | 380.42 | 381.29 | 🟡 Good | — |
| Shipments | Manual entry list (turkey) | 393.39 | 377.39 | 380.86 | 🟡 Good | — |
| Customers | List page (50) | 377.5 | 375.9 | 378.98 | 🟡 Good | — |
| Shipments | List batches (china) | 374.53 | 374.36 | 444.76 | 🟡 Good | — |
| Cash Expenses | List active expenses | 374.87 | 373.79 | 374.74 | 🟡 Good | — |
| Shipments | List batches (uae) | 378.18 | 372.08 | 377.97 | 🟡 Good | — |
| Orders | SSR list page data | 2332.21 | 8.84 | 9.52 | 🟢 Excellent | — |

## Load Tests (safe read concurrency)

| Operation | Concurrency | Avg (ms) | P95 (ms) | Max (ms) | Success % |
| --- | --- | --- | --- | --- | --- |
| customers.list@1 | 1 | 587.8 | 1021.07 | 1021.07 | 100 |
| customers.list@5 | 5 | 628.8 | 1116.43 | 1116.43 | 100 |
| customers.list@10 | 10 | 842.34 | 1498.74 | 1499.14 | 100 |
| cashflow.overview4w@1 | 1 | 4915.78 | 4943.43 | 4943.43 | 100 |
| cashflow.overview4w@5 | 5 | 15115.35 | 15228.72 | 15228.72 | 0 |

## Performance Targets

| Band | Threshold |
| ---- | --------- |
| 🟢 Excellent | < 300ms |
| 🟡 Good | 300–700ms |
| 🟠 Needs Improvement | 700–1000ms |
| 🔴 Slow | > 1000ms |
| 🚨 Critical | > 2000ms |

Heavy operations (multi-week aggregation, PDF, Excel): use 3s/7s/15s bands.

## Top Bottlenecks

1. **Cash Flow weeks overview** — 8337ms, 262 queries (8 weeks × ~33 queries/week)
2. **Orders list cold** — 2332ms, 40 queries (7 cache stores cold miss)
3. **Shipments locations admin (TR)** — 899ms, 16 queries, 1281 rows
4. **Cash control combined page** — 786ms, 16 queries
5. **Shipments control load** — 775–806ms per country

## NOT MEASURED (requires browser E2E or running dev server)

- Order capture form interactive ready time
- Payment intake UI save round-trip
- PDF/Excel download end-to-end
- Excel import upload+parse+commit
- Playwright E2E (no e2e specs in repo root)
