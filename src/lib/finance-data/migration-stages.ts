/**
 * Migration roadmap — Finance Data Layer V2.
 * Screens are NOT wired yet. Legacy code stays until each stage passes parity.
 *
 * Stage 1 — Payment Intake
 * Stage 2 — Planned Payment Methods (PMC)
 * Stage 3 — Cashflow
 * Stage 4 — KPI
 * Stage 5 — Reports
 *
 * After each stage: parity vs legacy → then delete that stage's legacy loaders only.
 */

export const FINANCE_DATA_MIGRATION_STAGES = [
  "payment-intake",
  "planned-payment-methods",
  "cashflow",
  "kpi",
  "reports",
] as const;

export type FinanceDataMigrationStage = (typeof FINANCE_DATA_MIGRATION_STAGES)[number];
