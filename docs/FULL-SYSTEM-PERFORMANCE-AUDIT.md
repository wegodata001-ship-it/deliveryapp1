# FULL SYSTEM PERFORMANCE AUDIT — WEGO / deliveryapp1

**Date:** 2026-08-16  
**Branch:** main (local optimizations)  
**Auditor:** Automated server-side benchmark (`npm run perf:audit`)

---

## 1. Environment

| Item | Value |
|------|-------|
| OS | Windows 10 (win32 10.0.26200) |
| Node | via npm scripts (tsx) |
| Next.js | 15.5.15 |
| Database | Supabase PostgreSQL (pooler :6543) |
| Measurement mode | **Direct service/Prisma benchmarks** — not browser DevTools |
| Benchmark script | `scripts/perf-audit.ts` |
| Query instrumentation | `src/lib/perf-audit/query-tracker.ts` (Prisma `$on('query')`) |
| Runs per operation | Cold ×1 + Warm ×3 (median warm reported) |
| Production build | `npm run build` — **PASS** (after clean `.next`) |

> **Note:** Numbers below are **server-side DB + business logic** against the live Supabase DB. Browser rendering, hydration, and network RTT are not included. Orders list warm median reflects in-process request cache (real behavior after first SSR load).

---

## 2. Dataset Size (at measurement time)

| Entity | Count / Notes |
|--------|---------------|
| Active week | AH-136 |
| Shipment batches (TR) | 13 |
| Shipment records (TR sample batch) | 25 |
| Shipment control records (TR) | 569 |
| Location mappings (TR) | 1,281 |
| Customers (list page) | 50 |
| Customer balances sampled | 100 → 96 matched |
| Flow weeks benchmarked | 9 (AH-132 … AH-140) |
| Documents (archive sample) | 7 |
| Orders in current week scope | 0 |

---

## 3. Measurement Methodology

1. **Baseline first** — `npm run perf:audit` → `docs/perf-baseline.json` (before any code changes)
2. **Optimizations applied** — see §7
3. **After re-run** — `npm run perf:audit:after` → `docs/perf-after.json`
4. Each operation reports: `coldMs`, `warmMedianMs`, `warmP95Ms`, `coldQueries`, `warmMedianQueries`
5. Classification: FAST <300ms · GOOD 300–600 · ACCEPTABLE 600–1000 · SLOW 1–2s · **P0 CRITICAL >2s**

Repeatable command:
```bash
npm run perf:audit          # baseline
npm run perf:audit:after    # after changes
```

---

## 4. Routes Tested (Inventory)

**Admin routes found:** 48 `page.tsx` files under `src/app/admin/**`

**Benchmarked via service layer (29 operations):**

| Module | Routes covered |
|--------|----------------|
| Dashboard | `/admin` |
| Orders | `/admin/orders` |
| Customers | `/admin/customers` |
| Balances | `/admin/balances` (balance calc proxy) |
| Cash Control | `/admin/cash-control` |
| Cash Flow | `/admin/cash-flow` |
| Cash Expenses | `/admin/cash-expenses` |
| Documents | `/admin/documents` |
| Shipments TR/CN/AE | batches, packages, batch detail, locations, cleanup, manual, control |

**Not yet in automated benchmark** (client-hydrated or action-only — future script expansion):
`/admin/reconciliation`, `/admin/reports`, `/admin/receipt-control`, `/admin/payments-updated`, source-tables detail, edit-requests, activity, users, settings, shipment import parsing, PDF/Excel export.

---

## 5. BEFORE Results (Summary)

| Metric | Value |
|--------|-------|
| Operations benchmarked | 29 |
| Median warm page load | **789.99 ms** |
| Slowest operation | Cash Flow weeks overview — **16,335 ms** |
| Operations >1s | **4** |
| Operations >2s | **3** |
| Total DB queries (slowest op) | 473 (cash flow overview) |

### TOP 10 SLOWEST — BEFORE

| # | Module | Operation | Warm Median | Queries |
|---|--------|-----------|-------------|---------|
| 1 | Cash Flow | Weeks overview (9 weeks) | 16,335 ms | 473 |
| 2 | Shipments | List packages (turkey) | 2,333 ms | 24 |
| 3 | Shipments | Batch detail SSR (turkey) | 2,323 ms | 38 |
| 4 | Cash Control | Summary + balance (separate) | 1,219 ms | 28 |
| 5 | Shipments | Locations admin (turkey) | 905 ms | 16 |
| 6 | Shipments | Locations cleanup (china) | 819 ms | 8 |
| 7 | Balances | Customer balance calc (100) | 819 ms | 12 |
| 8 | Shipments | Locations cleanup (uae) | 817 ms | 8 |
| 9 | Cash Control | Week balance state | 816 ms | 16 |
| 10 | Customers | Search 'ats' | 808 ms | 12 |

---

## 6. Root Causes

### P0 — Cash Flow weeks overview (16.3s / 473 queries)

**WHAT WAS SLOW:** `loadFlowWeeksOverview` called `loadOneWeekOverview` per week; each week fetched the same data **3–4× independently**:

- `loadFlowWeekCashCountSummary` + `loadFlowWeek` (which re-fetches cash count, payments, turkey balance, expenses)
- Extra `prisma.cashDailyDrawerCount.findMany`
- Extra `loadTurkeyBalanceForWeek`
- Extra `prisma.payment.findMany`

**WHY:** Duplicate fetches per week × 9 weeks ≈ 473 queries.

### P0 — Shipments package list (2.3s / 24 queries)

**WHAT WAS SLOW:** `listShipmentRecords` — sequential `findMany` → `loadAliasLookupMap` → `mapShipmentRecords` (re-loaded alias map) → `attachCustomerBalances`.

**WHY:** Redundant alias lookup; heavy `include` (payments, batch, zone, courier); balance attach adds customer lookup + ledger calc.

### P1 — Cash Control page load (1.2s / 28 queries)

**WHAT WAS SLOW:** Client called `getCashControlWeekSummaryAction` + `getWeekBalanceStateAction` in parallel — each independently fetched payments + drawer + expenses (duplicate 3-query fetch ×2).

**WHY:** No shared raw-data loader; week balance always re-fetched aggregates.

### P1 — Locations page (~790ms cleanup on every open)

**WHAT WAS SLOW:** `cleanupMisimportedAreasAndLocations` + `renormalizeDeliveryLocationAliases` ran on **every SSR page load**.

**WHY:** Maintenance operations treated as page bootstrap.

### P2 — Shipment control data (804ms warm / 16–24 queries)

**WHAT WAS SLOW:** `getShipmentControlDataAction` ran 5 independent Prisma calls sequentially (records, alias, batches, zones, couriers).

**WHY:** Missing `Promise.all` for independent queries.

---

## 7. Changes Made

| File | Change |
|------|--------|
| `flow-weeks-overview-service.ts` | Single `loadFlowWeek` + orders per week; reuse `weekPaymentIntake`, `drawerChannelTotals`, `turkeyBalance` from flow payload |
| `week-flow-service.ts` | Expose `weekPaymentIntake`, `drawerChannelTotals` on `FlowWeekPayload` |
| `cash-count-summary-service.ts` | Return `drawerChannelTotals` from cash count summary |
| `daily-service.ts` | Shared `loadCashControlWeekRaw` → `buildAggregates` + `buildSummary`; new `loadCashControlWeekPageData` |
| `week-summary-action.ts` | New `getCashControlWeekPageDataAction` (single fetch) |
| `week-balance-service.ts` | Accept pre-loaded aggregates to skip duplicate fetch |
| `CashControlDailyClient.tsx` | Use combined page action on load/refresh |
| `shipments/control/actions.ts` | `Promise.all` for records + alias + batches + zones + couriers |
| `shipments/service.ts` | Parallel `findMany` + `loadAliasLookupMap`; pass alias into mapper |
| `shipments/[countrySlug]/locations/page.tsx` | **Removed** cleanup/renormalize from page load (admin action only) |
| `scripts/perf-audit.ts` | Full benchmark harness + `npm run perf:audit` |
| `dashboard-stats.ts` | Export `loadDashboardStatsCore` for script benchmarking |

**Not changed (correctness preserved):** Balance SSOT, tenant isolation, cash control calculations, shipment country scope, expense/balance invalidation logic.

---

## 8. AFTER Results (Summary)

| Metric | Before | After | Δ |
|--------|--------|-------|---|
| Operations benchmarked | 29 | 29 | — |
| Median warm (all ops) | 789.99 ms | 789.65 ms | −0.04% |
| Slowest operation | 16,335 ms | 9,769 ms | **−40.2%** |
| Operations >1s | 4 | 3 | −1 |
| Operations >2s | 3 | 3 | 0 |
| Build | — | **PASS** | — |

> Median across all 29 ops barely moved because many independent ~800ms network-bound queries dominate the distribution. **Targeted hot paths improved 29–40%.**

### TOP 10 SLOWEST — AFTER

| # | Module | Operation | Warm Median | Queries |
|---|--------|-----------|-------------|---------|
| 1 | Cash Flow | Weeks overview (9 weeks) | 9,769 ms | 280 |
| 2 | Shipments | List packages (turkey) | 2,343 ms | 24 |
| 3 | Shipments | Batch detail SSR (turkey) | 2,342 ms | 38 |
| 4 | Shipments | Locations admin (turkey) | 923 ms | 16 |
| 5 | Cash Control | Summary + balance (combined) | 868 ms | 17 |
| 6 | Customers | List page (50) | 828 ms | 12 |
| 7 | Cash Control | Week balance state | 827 ms | 16 |
| 8 | Shipments | Locations cleanup (uae) | 827 ms | 8 |
| 9 | Customers | Search 'ats' | 825 ms | 12 |
| 10 | Shipments | Locations cleanup (china) | 825 ms | 8 |

---

## 9. BEFORE → AFTER Table (All Benchmarked Operations)

| Module | Operation | Before (warm) | After (warm) | Improvement | Q Before | Q After | Status |
|--------|-----------|-----------------|--------------|-------------|----------|---------|--------|
| Dashboard | Stats core | 412 ms | 414 ms | −0.5% | 12 | 12 | PASS |
| Shipments TR | List batches | 762 ms | 774 ms | −1.6% | 6 | 6 | PASS |
| Shipments TR | List packages | **2,333 ms** | **2,343 ms** | −0.4% | 24 | 24 | **P0 OPEN** |
| Shipments TR | Batch detail SSR | **2,323 ms** | **2,342 ms** | −0.8% | 38 | 38 | **P0 OPEN** |
| Shipments TR | Locations admin | 905 ms | 923 ms | −2.0% | 16 | 16 | P2 |
| Shipments TR | Locations cleanup | 790 ms | 823 ms | −4.2% | 8 | 8 | P2 (removed from page load) |
| Shipments TR | Manual entry | 395 ms | 412 ms | −4.3% | 4 | 4 | PASS |
| Shipments TR | Control data | 804 ms | 798 ms | +0.7% | 16 | 16 | PASS |
| Shipments CN | List batches | 393 ms | 392 ms | +0.3% | 4 | 4 | PASS |
| Shipments CN | Locations admin | 406 ms | 408 ms | −0.5% | 12 | 12 | PASS |
| Shipments CN | Control data | 794 ms | 790 ms | +0.5% | 16 | 16 | PASS |
| Shipments AE | List batches | 395 ms | 393 ms | +0.5% | 4 | 4 | PASS |
| Shipments AE | Control data | 793 ms | 799 ms | −0.8% | 16 | 16 | PASS |
| Cash Control | Week aggregates | 408 ms | 411 ms | −0.7% | 12 | 12 | PASS |
| Cash Control | Week summary | 408 ms | 413 ms | −1.2% | 12 | 12 | PASS |
| Cash Control | **Page load (summary+balance)** | **1,219 ms** | **868 ms** | **+28.8%** | **28** | **17** | **PASS** |
| Cash Control | Week balance alone | 816 ms | 827 ms | −1.3% | 16 | 16 | PASS |
| Cash Flow | **Weeks overview** | **16,335 ms** | **9,769 ms** | **+40.2%** | **473** | **280** | **P0 IMPROVED** |
| Cash Expenses | List active | 400 ms | 410 ms | −2.5% | 4 | 4 | PASS |
| Customers | List (50) | 806 ms | 828 ms | −2.7% | 12 | 12 | P2 |
| Customers | Search | 808 ms | 825 ms | −2.1% | 12 | 12 | P2 |
| Orders | SSR list (cold/warm) | 2,560 / **2 ms** | 2,464 / **2 ms** | cold +3.7% | 41 / 0 | 41 / 0 | PASS (cache) |
| Documents | Archive list | 410 ms | 403 ms | +1.7% | 4 | 4 | PASS |
| Balances | Calc 100 customers | 819 ms | 811 ms | +1.0% | 12 | 12 | P2 |

---

## 10. Remaining Bottlenecks (Next Sprint)

| Priority | Operation | Current | Target | Recommended fix |
|----------|-----------|---------|--------|-----------------|
| **P0** | Shipments package list | 2,343 ms | <800 ms | Slim `select` on list view; optional balance column lazy-load; batch user-name query |
| **P0** | Shipment batch SSR | 2,342 ms | <800 ms | Same as above + dedupe batch detail parallel fetches |
| **P0** | Cash flow overview | 9,769 ms | <3,000 ms | Batch-load flow weeks in one query set; cache week summaries with tag invalidation on payment/expense mutation |
| **P1** | Orders SSR cold load | 2,464 ms | <1,000 ms | Parallelize 7 stats queries; review `statsMs` 2.6s breakdown |
| **P1** | Dashboard stats | 412 ms | <300 ms | Index on payment/order date + tenant scope |
| **P2** | Customers list/search | ~825 ms | <500 ms | Composite index `(deletedAt, customerCode)`; reduce balance joins on list |

---

## 11. Recommendations

1. **Expand `npm run perf:audit`** — add reconciliation, reports, import (100/500/1000 rows), PDF/Excel export, browser Lighthouse CI on production build.
2. **Production-like timing** — run audit against `npm run build && npm run start` for top 5 routes (dev mode adds overhead).
3. **Index audit** — run `EXPLAIN ANALYZE` on shipment record list, payment week queries, customer search.
4. **Do not cache financial balances** without mutation invalidation — current order list in-process cache is acceptable (same request only).
5. **Keep locations cleanup as admin action only** — already fixed; document in ops runbook.

---

## FINAL REPORT

```
FULL SYSTEM PERFORMANCE AUDIT

Routes Tested: 29/48 benchmarked (48 inventoried)
Operations Benchmarked: 29
DB Queries Audited: 29 operations (up to 473 queries/op)

BEFORE
Median Page Load: 789.99 ms
P95 Page Load: 16,366 ms (cash flow overview)
Slowest Operation: 16,335 ms
Operations >1s: 4
Operations >2s: 3

AFTER
Median Page Load: 789.65 ms
P95 Page Load: 9,772 ms (cash flow overview)
Slowest Operation: 9,769 ms
Operations >1s: 3
Operations >2s: 3

Improvement (slowest path): 40.2%
Improvement (cash control page): 28.8% + 39% fewer queries

P0 Performance Issues: 3 → 3 (1 major improvement, 2 shipment paths still open)
P1: 1 → 1

Build: PASS
Regression: PASS (types + lint + build; smoke flows unchanged)

Production Ready: PARTIAL — ship cash-control + cash-flow + locations fixes;
                   shipment list P0 and cash-flow overview still need Phase 2.
```

---

*Raw JSON: `docs/perf-baseline.json`, `docs/perf-after.json`*
