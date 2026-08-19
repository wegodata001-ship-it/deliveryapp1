# System Map

Generated: 2026-08-19T06:02:50.218Z
Phase: baseline

## Summary

| Category | Count |
| -------- | ----: |
| App pages | 44 |
| API routes | 40 |
| Server action files | 79 |
| Server action exports | ~322 |
| Prisma models | 57 |
| Benchmarked operations | 27 |

## Pages (44)

| Route | Module | Notes |
| --- | --- | --- |
| / | Public | Landing redirect |
| /admin-login | Auth | Login |
| /admin | Dashboard | Admin home |
| /admin/activity | Activity | Audit activity |
| /admin/balances | Balances | Customer balances |
| /admin/cash-control | Cash Control | Weekly cash control |
| /admin/cash-expenses | Cash Expenses | Expense management |
| /admin/cash-flow | Cash Flow | Flow control + manager count |
| /admin/customer-card | Customers | Customer card |
| /admin/customers | Customers | Customer list |
| /admin/customers/[id] | Customers | Customer workspace |
| /admin/documents | Documents | Document archive |
| /admin/edit-requests | Orders | Edit requests (user) |
| /admin/import | Import | Excel import hub |
| /admin/invoice-cancel-requests | Payments | Invoice cancel approvals |
| /admin/my-requests | Orders | My edit requests |
| /admin/order-edit-requests | Orders | Edit request admin |
| /admin/orders | Orders | Orders list |
| /admin/orders/new | Orders | Order capture redirect |
| /admin/orders/[id] | Orders | Order detail / work panel |
| /admin/payments | Payments | Payments hub |
| /admin/payments/new | Payments | Payment capture redirect |
| /admin/payments-updated | Payments | Payment intake v2 |
| /admin/permissions | Admin | Permissions UI |
| /admin/receipt-control | Payments | Receipt control |
| /admin/reconciliation | Reconciliation | Wego reconciliation |
| /admin/reports | Reports | Reports dashboard |
| /admin/reports/profit-loss | Reports | P&L report |
| /admin/settings | Settings | System settings |
| /admin/shipments | Shipments | Shipments hub |
| /admin/shipments/[countrySlug] | Shipments | Country batches |
| /admin/shipments/[countrySlug]/[batchId] | Shipments | Batch packages |
| /admin/shipments/[countrySlug]/control | Shipments | Shipment control |
| /admin/shipments/[countrySlug]/import | Shipments | Shipment import |
| /admin/shipments/[countrySlug]/manual | Shipments | Manual entry |
| /admin/shipments/[countrySlug]/locations | Shipments | Locations admin |
| /admin/shipments/[countrySlug]/cash-control | Shipments | Shipment cash control |
| /admin/shipments/[countrySlug]/combined | Shipments | Combined view |
| /admin/source-tables | Master Data | Source tables hub |
| /admin/source-tables/[table] | Master Data | Source table CRUD |
| /admin/system/clear-demo-data | System | Demo data cleanup |
| /admin/users | Admin | User management |
| /admin/users/new | Admin | Create user |
| /admin/users/[id]/edit | Admin | Edit user |

## API Routes (40)

- `/api/auth/login`
- `/api/customers`
- `/api/customers/search-fast`
- `/api/customers/balance`
- `/api/customers/capture-index`
- `/api/customers/card-snapshot`
- `/api/customers/extras`
- `/api/customers/[customerId]/debt-breakdown`
- `/api/orders/boot`
- `/api/orders/capture`
- `/api/orders/next-number`
- `/api/orders/status`
- `/api/orders/payment-method`
- `/api/payments/entry`
- `/api/payment-intake/balances`
- `/api/payment-intake/customer-payments`
- `/api/payment-intake/orders`
- `/api/payment-checks`
- `/api/payment-intake/balances`
- `/api/excel/upload`
- `/api/excel/row`
- `/api/excel/history`
- `/api/excel/confirm`
- `/api/intake-locations`
- `/api/documents/upload`
- `/api/documents/[id]/download`
- `/api/customer-ledger/pdf`
- `/api/controls/reconciliation`
- `/api/controls/reconciliation/export/excel`
- `/api/controls/reconciliation/export/pdf`
- `/api/controls/cash-control/export/excel`
- `/api/controls/cash-control/export/pdf`
- `/api/admin/cash-expenses/export/excel`
- `/api/admin/shipments/courier-pdf`
- `/api/admin/shipments/courier-pdf/preview`
- `/api/admin/shipments/courier-pdf/save-names`
- `/api/admin/shipments/custom-pdf`
- `/api/statuses`
- `/api/order-edit-request`
- `/api/debug/current-user`

## Prisma Models (57)

- User
- FinancialSettings
- Permission
- UserPermission
- Customer
- Order
- OrderPaymentBreakdown
- PaymentPlan
- TurkeyTransferMovement
- OrderWeekCounter
- OrderEditRequest
- UserNotification
- ApprovalRequest
- Payment
- PaymentMethodAllocation
- CashExpense
- CashCount
- PaymentCashAuditReview
- CashDailyDrawerCount
- CashWeekFlow
- PaymentCheck
- ReceiptControl
- PaymentPoint
- IntakeLocation
- OrderLocation
- PaymentLocation
- AuditLog
- LegacyRawRow
- ExcelImportFile
- ExcelImportRow
- CustomerBalanceStatusOverride
- SourcePaymentMethod
- PaymentMethodRegistry
- SourceStatus
- AdminSystemSettings
- ManualImport
- ManualImportRow
- PaymentAdjustmentFee
- ShipmentBatch
- ShipmentBatchExpense
- ShipmentDeliveryZone
- DeliveryLocation
- DeliveryLocationAlias
- DeliveryLocationAudit
- ArabicDisplayNameCache
- ShipmentCourier
- ShipmentRecord
- ShipmentRecordExpense
- ShipmentPaymentLine
- ShipmentCashDay
- ShipmentCashCount
- ShipmentCashExpense
- Document
- InventoryItem
- InventoryCount
- InventoryCountLine
- ManualShipment

## Server Actions (by module)

See `docs/FULL-SYSTEM-MAP.md` for full server action catalog (79 files, 322 exports).

## Middleware

- `src/middleware.ts` — protects `/admin/*`, verifies JWT session cookie, redirects to `/admin-login`
- Light mode header for selected admin paths (`ADMIN_ROUTE_MODE_HEADER`)

## Authentication

- `src/lib/session.ts` — JWT session token
- `src/lib/admin-auth.ts` — `getSessionPayload`, `resolveSessionToAppUser`, permission keys for EMPLOYEE role
- ADMIN role = full access; EMPLOYEE = UserPermission keys

## Background / Scripts

- `scripts/perf-audit.ts` — server-side DB benchmarks
- `scripts/qa-flow-calculation.ts` — flow calculation QA
- `scripts/client-handover-clean.ts` — data cleanup (destructive, manual)
