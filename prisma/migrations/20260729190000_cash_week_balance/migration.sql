-- Week balance approval on CashWeekFlow (cash control)
ALTER TABLE "CashWeekFlow"
  ADD COLUMN IF NOT EXISTS "week_balance_status" TEXT NOT NULL DEFAULT 'OPEN',
  ADD COLUMN IF NOT EXISTS "week_balanced_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "week_balanced_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "week_balance_snapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "week_balance_data_hash" TEXT;

ALTER TABLE "CashWeekFlow"
  ADD CONSTRAINT "CashWeekFlow_week_balanced_by_id_fkey"
  FOREIGN KEY ("week_balanced_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "CashWeekFlow_week_balance_status_idx" ON "CashWeekFlow"("week_balance_status");
