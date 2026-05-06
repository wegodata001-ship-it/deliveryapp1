# QA Summary

## Scope
- Orders
- Payments
- Weeks + Countries
- Reports
- Customers
- Console/Runtime
- DB/API validation

## Environment
- **Date:** 2026-05-06
- **OS:** Windows 10
- **Run mode:** `npm run dev` + Playwright (`npm run test:e2e`)
- **הערה:** `npm run db:seed` טוען `.env.local` (כולל `E2E_ADMIN_*`); Playwright טוען `.env.local` דרך `playwright.config.ts`.

## Results

### Passed
- E2E: Login (qa-admin) + Global week/date sync + critical screens open (orders/reports/receipt-control + modals)
- E2E: Payment flow (select customer → pay debt → save → cannot pay again)
- E2E: Reports: "יתרות לקוחות" report opens and renders table

### Failed
- —

### Blocked
- localStorage persistence on refresh (not automated yet)

## Bugs Found
- See `qa/bugs.md`

## Critical Issues
- None found in automated demo flow (no console errors captured).

## Suggested Fixes
- Add a stable `data-testid` on key controls (week inputs in modals, report table) to strengthen E2E assertions.
- אופציונלי: לאמת מפורשות שסכום עמודת "יתרה" בטבלה לא כולל שורות 0 (כרגע מכוסה ע״י היעדר שורת הלקוח).

