-- AddColumn
ALTER TABLE "CashDailyDrawerCount" ADD COLUMN IF NOT EXISTS "otherIls" DECIMAL(19,4);
