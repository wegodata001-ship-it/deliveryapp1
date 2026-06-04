-- CreateEnum
CREATE TYPE "WorkCountryCode" AS ENUM ('TR', 'CN', 'AE', 'JO');

-- AlterEnum
ALTER TYPE "OrderSourceCountry" ADD VALUE IF NOT EXISTS 'JORDAN';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "countryCode" "WorkCountryCode" NOT NULL DEFAULT 'TR';
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "countryCode" "WorkCountryCode" NOT NULL DEFAULT 'TR';
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "countryCode" "WorkCountryCode" NOT NULL DEFAULT 'TR';
ALTER TABLE "PaymentCheck" ADD COLUMN IF NOT EXISTS "countryCode" "WorkCountryCode" NOT NULL DEFAULT 'TR';
ALTER TABLE "ReceiptControl" ADD COLUMN IF NOT EXISTS "countryCode" "WorkCountryCode" NOT NULL DEFAULT 'TR';

-- Backfill Order from sourceCountry
UPDATE "Order"
SET "countryCode" = CASE "sourceCountry"::text
  WHEN 'CHINA' THEN 'CN'::"WorkCountryCode"
  WHEN 'UAE' THEN 'AE'::"WorkCountryCode"
  WHEN 'JORDAN' THEN 'JO'::"WorkCountryCode"
  ELSE 'TR'::"WorkCountryCode"
END
WHERE "countryCode" IS NULL OR "countryCode" = 'TR';

-- Backfill Payment from linked order
UPDATE "Payment" p
SET "countryCode" = o."countryCode"
FROM "Order" o
WHERE p."orderId" = o."id" AND o."countryCode" IS NOT NULL;

UPDATE "PaymentCheck" pc
SET "countryCode" = p."countryCode"
FROM "Payment" p
WHERE pc."paymentId" = p."id";

-- Customers & receipts — historical = Turkey
UPDATE "Customer" SET "countryCode" = 'TR' WHERE "countryCode" IS NULL;
UPDATE "ReceiptControl" SET "countryCode" = 'TR' WHERE "countryCode" IS NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS "Customer_countryCode_idx" ON "Customer"("countryCode");
CREATE INDEX IF NOT EXISTS "Order_countryCode_idx" ON "Order"("countryCode");
CREATE INDEX IF NOT EXISTS "Order_countryCode_weekCode_idx" ON "Order"("countryCode", "weekCode");
CREATE INDEX IF NOT EXISTS "Payment_countryCode_idx" ON "Payment"("countryCode");
CREATE INDEX IF NOT EXISTS "PaymentCheck_countryCode_idx" ON "PaymentCheck"("countryCode");
CREATE INDEX IF NOT EXISTS "ReceiptControl_countryCode_idx" ON "ReceiptControl"("countryCode");
