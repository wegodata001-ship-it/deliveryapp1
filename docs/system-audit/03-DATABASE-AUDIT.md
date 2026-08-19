# Database Audit

Generated: 2026-08-19T06:02:50.218Z

## Query Performance (from benchmarks)

| Query / Operation | Module | Avg ms/query | P95 total | Max cold | Calls | Problem |
| --- | --- | --- | --- | --- | --- | --- |
| cashflow.overview | Cash Flow | 32 | 8347.64 | 8365.35 | 262 | N× week load / fan-out |
| shipments.locations.turkey | Shipments | 56 | 1035.24 | 1107.66 | 16 | Multiple joins |
| shipments.control.uae | Shipments | 50 | 810.23 | 1095.35 | 16 | Multiple joins |
| shipments.control.china | Shipments | 49 | 799.05 | 1063.02 | 16 | Multiple joins |
| cash.pageLoad | Cash Control | 49 | 786.69 | 793.67 | 16 | Multiple joins |
| cash.weekBalance | Cash Control | 49 | 785.87 | 854.78 | 16 | Multiple joins |
| shipments.control.turkey | Shipments | 48 | 789.01 | 868.14 | 16 | Multiple joins |
| shipments.locationsCleanup.uae | Shipments | 96 | 776.06 | 770.73 | 8 | OK |
| shipments.locationsCleanup.china | Shipments | 96 | 806.76 | 776.1 | 8 | OK |
| shipments.locationsCleanup.turkey | Shipments | 95 | 765.61 | 758.29 | 8 | OK |
| shipments.manual.uae | Shipments | 99 | 440.67 | 388.38 | 4 | OK |
| dashboard.stats | Dashboard | 33 | 397.51 | 950.47 | 12 | OK |
| balances.list | Balances | 98 | 463.89 | 392.03 | 4 | OK |
| shipments.listBatches.turkey | Shipments | 98 | 397.64 | 389.76 | 4 | OK |
| cash.aggregates | Cash Control | 32 | 395.88 | 405.55 | 12 | OK |
| shipments.manual.china | Shipments | 97 | 393.94 | 389.11 | 4 | OK |
| cash.summary | Cash Control | 32 | 397.61 | 408.56 | 12 | OK |
| shipments.locations.china | Shipments | 32 | 391.21 | 451.65 | 12 | OK |
| documents.list | Documents | 96 | 387.58 | 388.65 | 4 | OK |
| shipments.locations.uae | Shipments | 32 | 462.06 | 384.62 | 12 | OK |

## N+1 Patterns (static analysis)

| Severity | Location | Pattern |
| -------- | -------- | ------- |
| High | `location-service.ts:1816+` | Per-record `resolveDeliveryLocation` in chunks |
| High | `import-turkey-ah125.ts` | Per-row customer lookup + order create |
| Medium | `flow-weeks-overview-service.ts:152+` | `loadFlowWeek` per week in parallel (262 queries for 8 weeks) |
| Medium | `capture/actions.ts:3205+` | Notification create per admin user |
| Medium | `payments-updated/actions.ts:1438+` | Breakdown update per balance row |

## Missing Indexes

| Model | Recommended | Used in |
| ----- | ----------- | ------- |
| CashExpense | `@@index([weekCode, status])` | 10+ week expense queries |
| OrderEditRequest | `@@index([orderId, status])` | Pending edit request lookups |

## Duplicate Queries (same request)

| File | Issue |
| ---- | ----- |
| `shipments/cash-control/service.ts` | Repeated `shipmentCashDay.findUnique` (5×) |
| `shipments/manual/service.ts` | Repeated `manualShipment.findFirst` (4×) |
| Week expense load | `cashExpense.findMany({ weekCode, status })` duplicated across modules |

## Connection Pool

- Provider: Supabase pooler (6543) + direct (5432)
- Config: `DATABASE_URL` with pgbouncer, `connect_timeout=15`
- Instrumentation: no saturation/timeout observed during audit run

## Recommendations (Impact × Frequency)

1. Batch flow weeks overview — single payment aggregate query per week range
2. Add composite indexes (CashExpense, OrderEditRequest)
3. Shared week expense loader with request-level cache
4. Batch notification creates (`createMany`)
