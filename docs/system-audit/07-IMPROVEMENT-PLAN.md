# Improvement Plan

Generated: 2026-08-19T06:02:50.218Z

Priority = Impact × Frequency × Risk

## P0 — None identified in runtime audit

No data corruption or security bypass found in benchmarks.

## P1 — Fix before client handover

| # | Item | Impact | Effort | Action |
| - | ---- | ------ | ------ | ------ |
| 1 | PERF-001 Flow weeks overview 8.3s | All cash-flow screen loads | Medium | Refactor overview to batch queries |
| 2 | ORDER-001 Balances ILS legacy | Wrong balance display vs USD SoT | High | Migrate balances to USD ledger view |

## P2 — Performance & consistency

| # | Item | Action |
| - | ---- | ------ |
| 3 | DB-001 CashExpense composite index | Migration |
| 4 | DB-002 OrderEditRequest composite index | Migration |
| 5 | PERF-002 Orders cold 2.3s | Warm SSR cache or reduce cold queries |
| 6 | PAY-001 Reports ILS totals | Align report columns to USD |
| 7 | SHIP-001 Location N+1 | Batch resolveDeliveryLocation |
| 8 | TEST-001 QA shim | Add `npm run qa:all` with server-only shim |

## P3 — Polish

| # | Item |
| - | ---- |
| 9 | Locations cleanup 770ms empty runs |
| 10 | Document /api/debug/current-user production guard |

## Blocked / NOT MEASURED

- Browser E2E timings — needs Playwright suite
- PDF/Excel generation — needs HTTP benchmark against running server
- Write-path benchmarks — skipped on production DB for data safety
