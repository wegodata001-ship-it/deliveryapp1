-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "paymentNumber" INTEGER;

-- CreateIndex
CREATE INDEX "Payment_paymentNumber_idx" ON "Payment"("paymentNumber");

-- Backfill from WGP-P-000092 style codes (PostgreSQL)
UPDATE "Payment"
SET "paymentNumber" = CAST(RIGHT("paymentCode", 6) AS INTEGER)
WHERE "paymentCode" LIKE 'WGP-P-%'
  AND LENGTH(TRIM("paymentCode")) >= 11
  AND "paymentCode" ~ '^WGP-P-[0-9]{6}$';
