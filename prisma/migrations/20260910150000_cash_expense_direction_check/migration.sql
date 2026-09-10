-- Allow only NULL (legacy), EXPENSE, or INCOME.
-- Does not backfill and does not set a default.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CashExpense_direction_check'
  ) THEN
    ALTER TABLE "CashExpense"
      ADD CONSTRAINT "CashExpense_direction_check"
      CHECK ("direction" IS NULL OR "direction" IN ('EXPENSE', 'INCOME'));
  END IF;
END $$;
