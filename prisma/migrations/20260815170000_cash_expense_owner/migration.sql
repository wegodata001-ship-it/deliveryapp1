-- AlterTable
ALTER TABLE "CashExpense" ADD COLUMN "expenseOwnerUserId" TEXT;

-- Backfill: legacy rows — owner = creator
UPDATE "CashExpense"
SET "expenseOwnerUserId" = "createdById"
WHERE "expenseOwnerUserId" IS NULL AND "createdById" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "CashExpense" ADD CONSTRAINT "CashExpense_expenseOwnerUserId_fkey" FOREIGN KEY ("expenseOwnerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "CashExpense_expenseOwnerUserId_idx" ON "CashExpense"("expenseOwnerUserId");
