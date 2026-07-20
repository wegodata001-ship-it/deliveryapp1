-- Matching Engine SSOT: persist per-method paid/remaining on OrderPaymentBreakdown
ALTER TABLE "OrderPaymentBreakdown" ADD COLUMN IF NOT EXISTS "paidUsd" DECIMAL(19,4) NOT NULL DEFAULT 0;
ALTER TABLE "OrderPaymentBreakdown" ADD COLUMN IF NOT EXISTS "remainingUsd" DECIMAL(19,4);
ALTER TABLE "OrderPaymentBreakdown" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill remaining for legacy USD rows (ILS left null → load fallback)
UPDATE "OrderPaymentBreakdown"
SET "remainingUsd" = GREATEST(0, "amount" - COALESCE("paidUsd", 0)),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "remainingUsd" IS NULL AND UPPER("currency") = 'USD';
