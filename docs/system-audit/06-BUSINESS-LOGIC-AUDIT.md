# Business Logic Audit

Generated: 2026-08-19T06:02:50.218Z

## Dollar-Only Order Model

### Verified (QA passing)

| Test | Result |
| ---- | ------ |
| Full payment USD | ✅ order-usd-payment-model |
| Full payment ILS → USD credit | ✅ |
| Partial ILS payment | ✅ |
| Mixed USD + ILS | ✅ |
| Historical rate immutable | ✅ |
| Manager count from captured payments | ✅ manager-count-expected-service |
| FX PS/IL separation | ✅ available-ils-sot |

### Not aligned (ILS legacy paths remain)

| Area | File | Issue |
| ---- | ---- | ----- |
| Customer balances | `customer-balance-order-status.ts` | `orderExpectedIlsValue`, ILS phase classification |
| Balances UI | `balances/actions.ts` | `totalBalanceILS`, expectedIls - receivedIls |
| Reports | `reports/actions.ts` | Order total from totalIlsWithVat |
| Source tables | `source-tables/actions.ts` | ILS order expected display |

## Reconciliation Checks

| Rule | Status | Notes |
| ---- | ------ | ----- |
| Order Total = Paid + Remaining (USD) | ✅ in capture/ledger | Balances screen uses ILS hybrid |
| Payment USD credits = Paid USD | ✅ payment model tests | |
| Manager count expected = payment intake | ✅ SSOT shared | |
| Flow week intake = payment records | ✅ week-flow-service | |
| Shipment totals = line sums | NOT MEASURED | Manual verification needed |

## Payment Intake SSOT

- Actual captured: `methodAllocations` + `getFlowPaymentContributions`
- Not planned: order payment method fields ignored when allocations exist
