-- AlterTable
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "orderExecutionDate" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "intakeDateTime" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Order_orderExecutionDate_idx" ON "Order"("orderExecutionDate");
CREATE INDEX IF NOT EXISTS "Order_intakeDateTime_idx" ON "Order"("intakeDateTime");
