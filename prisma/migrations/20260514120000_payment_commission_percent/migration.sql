-- AlterTable
ALTER TABLE "Payment"
  ADD COLUMN "commissionPercent" DECIMAL(7,4) NOT NULL DEFAULT 0;
