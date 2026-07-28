-- AlterTable: add paymentMethod to ShipmentCashExpense
ALTER TABLE "ShipmentCashExpense" ADD COLUMN "paymentMethod" TEXT NOT NULL DEFAULT 'CASH';
CREATE INDEX "ShipmentCashExpense_paymentMethod_idx" ON "ShipmentCashExpense"("paymentMethod");
