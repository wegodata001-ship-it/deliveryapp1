-- Explicit cash-movement direction for new rows only.
-- Existing CashExpense rows stay NULL (legacy). Do not backfill from sign.
ALTER TABLE "CashExpense" ADD COLUMN IF NOT EXISTS "direction" TEXT;
