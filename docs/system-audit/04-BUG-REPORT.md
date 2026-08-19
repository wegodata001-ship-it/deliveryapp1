# Bug Report

Generated: 2026-08-19T06:02:50.218Z

## Master Bug Table

| ID | Module | Problem | Severity | Root Cause | Fixed | Retest |
| --- | --- | --- | --- | --- | --- | --- |
| PERF-001 | Cash Flow | Weeks overview (8 weeks) takes ~8.3s warm median, 262 DB queries | P1 | flow-weeks-overview-service runs loadFlowWeek per week sequentially (N× full week load) | No | Pending optimization |
| PERF-002 | Orders | Orders list cold SSR load ~2.3s (40 queries); warm cache ~9ms | P2 | 7 parallel cache stores on cold miss (stats, KPI, count, creators, country options, orders) | No | Cache hit path OK (9ms warm) |
| ORDER-001 | Balances | Customer balance still uses ILS expected/received in core paths | P1 | customer-balance-order-status.ts + balances/actions.ts use totalIlsWithVat as order expected | No | order-usd-payment-model QA passes; balances screen NOT aligned |
| PAY-001 | Reports | Week reports use ILS order totals (totalIlsWithVat) alongside USD model | P2 | reports/actions.ts, open-orders-modal-actions.ts legacy fields | No | Partial — payment capture USD SoT OK |
| DB-001 | Database | CashExpense queries filter weekCode+status without composite index | P2 | Separate indexes on weekCode and status only | No | Add @@index([weekCode, status]) |
| DB-002 | Database | OrderEditRequest pending lookups lack composite index | P2 | Queries use { orderId, status: PENDING } | No | Add @@index([orderId, status]) |
| SHIP-001 | Shipments | Location backfill runs resolveDeliveryLocation per record (N+1 writes) | P2 | location-service.ts chunk loop with per-row resolution | No | Batch prefetch needed |
| AUTH-001 | Security | Middleware only checks ADMIN/EMPLOYEE role — fine-grained perms enforced per-action | P3 | By design: UserPermission keys checked in server actions, not middleware | N/A | Manual API probe recommended per role |
| LOAD-001 | Cash Flow | Flow overview 4 weeks @ concurrency 5: avg 15.1s, 0% success (DB pool/contention) | P1 | Parallel loadFlowWeek × N weeks × concurrency exhausts pooler or causes timeouts | No | Serialize overview queries or batch SQL |
| TEST-001 | Tests | allocation.qa.test.ts fails without server-only shim | P2 | Direct tsx --test imports prisma.ts without register-server-only shim | Yes — npm run qa:all uses shim | 67/67 pass |
| PERF-003 | Shipments | Locations cleanup ~770ms with 8 queries even when 0 rows deleted | P2 | cleanupMisimportedAreas runs full scan per country | No | Pending |

## QA Test Failures

- Total: 67, Pass: 67, Fail: 0


## Severity Legend

- **P0** — Data loss, security, payment corruption, wrong balance
- **P1** — Core flow broken or >2s consistently on critical screen
- **P2** — Performance, filters, export, workflow
- **P3** — Cosmetic, minor UX
